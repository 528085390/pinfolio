import type { DatabaseSync } from 'node:sqlite'
import type {
  HeartbeatRow,
  MonitorRow,
  OutboundConfig,
  ProbeResult,
} from './types.ts'
import { MonitorStore } from './store.ts'
import { resolveOutbound } from './outbound.ts'
import { probeHttp } from './probes/http.ts'
import { probePort } from './probes/port.ts'
import { probeSsh } from './probes/ssh.ts'
import { evaluatePolicy, type PolicyContext } from './policy.ts'

export interface MonitorEngineOptions {
  db: DatabaseSync
  store: MonitorStore
  getGlobalOutbound?: () => OutboundConfig
  onBeat?: (monitorId: number, beat: HeartbeatRow) => void
  maxConcurrency?: number
}

let globalEngineInstance: MonitorEngine | null = null

export function setGlobalEngine(engine: MonitorEngine | null): void {
  globalEngineInstance = engine
}

export function getGlobalEngine(): MonitorEngine | null {
  return globalEngineInstance
}

export class MonitorEngine {
  private db: DatabaseSync
  private store: MonitorStore
  private getGlobalOutbound: () => OutboundConfig
  private onBeat?: (monitorId: number, beat: HeartbeatRow) => void
  private maxConcurrency: number

  private running = false
  private activeProbes = 0
  private queue: Array<() => void> = []
  private scheduleTimers = new Map<number, NodeJS.Timeout>()
  private retryCounters = new Map<number, number>()
  private pruneTimer: NodeJS.Timeout | null = null

  constructor(options: MonitorEngineOptions) {
    this.db = options.db
    this.store = options.store
    this.getGlobalOutbound =
      options.getGlobalOutbound ?? (() => ({ mode: 'direct', proxy: null }))
    this.onBeat = options.onBeat
    this.maxConcurrency = options.maxConcurrency ?? 6
    setGlobalEngine(this)
  }

  isRunning(): boolean {
    return this.running
  }

  /**
   * Concurrency runner that restricts active concurrent probe execution.
   * Hands over execution slots directly to queued tasks without decrementing
   * activeProbes to prevent queue jumping.
   */
  private async runWithConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
    if (this.activeProbes < this.maxConcurrency && this.queue.length === 0) {
      this.activeProbes++
    } else {
      await new Promise<void>((resolve) => this.queue.push(resolve))
    }

    try {
      return await fn()
    } finally {
      const next = this.queue.shift()
      if (next) {
        next() // Hand over execution slot directly
      } else {
        this.activeProbes--
      }
    }
  }

  /**
   * Safely notify beat subscriber without letting subscriber errors crash the engine.
   */
  notifyBeat(monitorId: number, beat: HeartbeatRow): void {
    if (this.onBeat) {
      try {
        this.onBeat(monitorId, beat)
      } catch (err) {
        console.error(`[MonitorEngine] onBeat subscriber error for #${monitorId}:`, err)
      }
    }
  }

  /**
   * Start scheduling and background probing.
   */
  /**
   * Schedule daily 7-day heartbeat pruning: runs initial check after 5s, then every 24h.
   */
  private schedulePruning(): void {
    if (this.pruneTimer) return

    const schedule = (delayMs: number) => {
      this.pruneTimer = setTimeout(() => {
        try {
          const deleted = this.store.pruneHeartbeats(7)
          if (deleted > 0) {
            console.log(`[MonitorEngine] Pruned ${deleted} expired heartbeats (>7 days)`)
          }
        } catch (err) {
          console.error('[MonitorEngine] Heartbeat pruning error:', err)
        }
        schedule(24 * 60 * 60 * 1000)
      }, delayMs)
      this.pruneTimer.unref?.()
    }

    schedule(5000)
  }

  start(): void {
    this.schedulePruning()
    if (this.running) return
    this.running = true

    const monitors = this.store.getAllMonitors(true)
    for (const monitor of monitors) {
      if (monitor.type === 'push') {
        // Push monitors are passive, not actively polled
        continue
      }

      // Stagger initial execution between 1-5 seconds to prevent thundering herd
      const initialDelayMs = Math.floor(Math.random() * 4000) + 1000
      this.scheduleNext(monitor.id, initialDelayMs)
    }
  }

  /**
   * Stop all active schedules and reset timers.
   */
  stop(): void {
    if (this.pruneTimer) {
      clearTimeout(this.pruneTimer)
      this.pruneTimer = null
    }
    this.running = false
    for (const timer of this.scheduleTimers.values()) {
      clearTimeout(timer)
    }
    this.scheduleTimers.clear()
    this.retryCounters.clear()
  }

  /**
   * Refresh schedule to align with current monitor states in DB.
   */
  refreshSchedule(): void {
    if (!this.running) return

    const monitors = this.store.getAllMonitors(false)
    const activeMap = new Map<number, MonitorRow>()

    for (const m of monitors) {
      if (m.active && m.type !== 'push') {
        activeMap.set(m.id, m)
        if (!this.scheduleTimers.has(m.id)) {
          // Schedule newly activated monitor
          this.scheduleNext(m.id, 1000)
        }
      }
    }

    // Cancel deleted or paused monitors
    for (const [id, timer] of this.scheduleTimers.entries()) {
      if (!activeMap.has(id)) {
        clearTimeout(timer)
        this.scheduleTimers.delete(id)
        this.retryCounters.delete(id)
      }
    }
  }

  /**
   * Cancel schedule timer for a specific monitor (e.g. when paused or deleted).
   */
  cancelSchedule(monitorId: number): void {
    const timer = this.scheduleTimers.get(monitorId)
    if (timer) {
      clearTimeout(timer)
      this.scheduleTimers.delete(monitorId)
      this.retryCounters.delete(monitorId)
    }
  }

  /**
   * Schedule immediate or delayed probe for an active non-push monitor (e.g. when resumed).
   */
  scheduleMonitor(monitorId: number, delayMs = 1000): void {
    const monitor = this.store.getMonitorById(monitorId)
    if (!monitor || !monitor.active || monitor.type === 'push') return
    this.scheduleNext(monitorId, delayMs)
  }

  /**
   * Internal helper to schedule next execution for a monitor.
   */
  private scheduleNext(monitorId: number, delayMs: number): void {
    const existing = this.scheduleTimers.get(monitorId)
    if (existing) {
      clearTimeout(existing)
    }

    const timer = setTimeout(async () => {
      if (!this.running) return
      await this.executeSingleProbe(monitorId)
    }, delayMs)

    this.scheduleTimers.set(monitorId, timer)
  }

  /**
   * Execute low-level probe dispatch for a monitor.
   */
  private async executeProbe(monitor: MonitorRow): Promise<ProbeResult> {
    const globalOutbound = this.getGlobalOutbound()
    const outbound = resolveOutbound(monitor.outbound_mode, globalOutbound)

    switch (monitor.type) {
      case 'http':
        return await probeHttp(monitor, outbound)
      case 'port':
        return await probePort(monitor, outbound)
      case 'ssh':
        return await probeSsh(monitor, outbound)
      case 'push':
        return {
          status: 0,
          ping: null,
          msg: 'Push monitors cannot be probed actively',
        }
      default:
        return {
          status: 0,
          ping: null,
          msg: `Unknown monitor type: ${(monitor as any).type}`,
        }
    }
  }

  /**
   * Immediately probe a monitor, bypassing schedule timers.
   */
  async probeNow(monitorId: number): Promise<ProbeResult> {
    const monitor = this.store.getMonitorById(monitorId)
    if (!monitor) {
      return {
        status: 0,
        ping: null,
        msg: `Monitor #${monitorId} not found`,
      }
    }

    const result = await this.runWithConcurrencyLimit(() => this.executeProbe(monitor))

    const prevBeat = this.store.getLatestHeartbeat(monitorId)
    const downCount =
      result.status === 1
        ? 0
        : (prevBeat && (prevBeat.status === 0 || prevBeat.status === 2)
            ? prevBeat.down_count
            : 0) + 1

    const beat: Omit<HeartbeatRow, 'id'> = {
      monitor_id: monitorId,
      status: result.status,
      ping: result.ping,
      msg: result.msg,
      time: new Date().toISOString(),
      duration: result.ping ?? 0,
      down_count: downCount,
    }

    const beatId = this.store.recordHeartbeat(beat)
    this.notifyBeat(monitorId, { id: beatId, ...beat })

    return result
  }

  /**
   * Execute a single scheduled probe cycle with policy checking, error resilience, and retries.
   */
  private async executeSingleProbe(monitorId: number): Promise<void> {
    try {
      const monitor = this.store.getMonitorById(monitorId)
      if (!monitor || !monitor.active) {
        const existing = this.scheduleTimers.get(monitorId)
        if (existing) {
          clearTimeout(existing)
          this.scheduleTimers.delete(monitorId)
        }
        this.retryCounters.delete(monitorId)
        return
      }

      // Build policy evaluation context
      const prevBeat = this.store.getLatestHeartbeat(monitorId)
      const allMonitors = this.store.getAllMonitors(false)
      const monitorsStatus: Record<number, number> = {}

      for (const m of allMonitors) {
        if (m.id !== monitorId) {
          const hb = this.store.getLatestHeartbeat(m.id)
          if (hb) {
            monitorsStatus[m.id] = hb.status
          }
        }
      }

      const ctx: PolicyContext = {
        now: new Date(),
        selfStatus: prevBeat?.status,
        selfDownCount: prevBeat?.down_count,
        selfPingMs: prevBeat?.ping,
        monitorsStatus,
      }

      const policyEval = evaluatePolicy(monitor.policy_json, monitor.interval, ctx)

      // Gate check
      if (!policyEval.gate) {
        const beat: Omit<HeartbeatRow, 'id'> = {
          monitor_id: monitorId,
          status: policyEval.status ?? 3,
          ping: null,
          msg: policyEval.reason || 'MAINTENANCE',
          time: new Date().toISOString(),
          duration: 0,
          down_count: prevBeat?.down_count ?? 0,
        }
        const beatId = this.store.recordHeartbeat(beat)
        this.notifyBeat(monitorId, { id: beatId, ...beat })

        // Check if monitor is still active before rescheduling
        const current = this.store.getMonitorById(monitorId)
        if (this.running && current?.active) {
          this.scheduleNext(monitorId, policyEval.interval * 1000)
        }
        return
      }

      // Execute probe under concurrency limit
      const result = await this.runWithConcurrencyLimit(() => this.executeProbe(monitor))

      if (result.status === 1) {
        // Success: reset retry counter and down_count
        this.retryCounters.set(monitorId, 0)

        const beat: Omit<HeartbeatRow, 'id'> = {
          monitor_id: monitorId,
          status: 1,
          ping: result.ping,
          msg: result.msg,
          time: new Date().toISOString(),
          duration: result.ping ?? 0,
          down_count: 0,
        }
        const beatId = this.store.recordHeartbeat(beat)
        this.notifyBeat(monitorId, { id: beatId, ...beat })

        const current = this.store.getMonitorById(monitorId)
        if (this.running && current?.active) {
          this.scheduleNext(monitorId, policyEval.interval * 1000)
        }
      } else {
        // Probe failed (status = 0)
        const retries = this.retryCounters.get(monitorId) ?? 0
        const maxRetries = monitor.maxretries ?? 0

        // Carry over failure streak from PENDING or DOWN
        const downCount =
          (prevBeat && (prevBeat.status === 0 || prevBeat.status === 2)
            ? prevBeat.down_count
            : 0) + 1

        if (maxRetries > 0 && retries < maxRetries) {
          // Increment retry counter and record PENDING (2)
          this.retryCounters.set(monitorId, retries + 1)

          const beat: Omit<HeartbeatRow, 'id'> = {
            monitor_id: monitorId,
            status: 2, // PENDING
            ping: result.ping,
            msg: result.msg,
            time: new Date().toISOString(),
            duration: result.ping ?? 0,
            down_count: downCount,
          }
          const beatId = this.store.recordHeartbeat(beat)
          this.notifyBeat(monitorId, { id: beatId, ...beat })

          const current = this.store.getMonitorById(monitorId)
          if (this.running && current?.active) {
            // Schedule fast retry in 5000ms
            this.scheduleNext(monitorId, 5000)
          }
        } else {
          // Max retries reached or already DOWN -> keep retry counter >= maxRetries
          // so subsequent failures stay DOWN without oscillating back to PENDING
          this.retryCounters.set(monitorId, Math.max(retries, maxRetries))

          const beat: Omit<HeartbeatRow, 'id'> = {
            monitor_id: monitorId,
            status: 0, // DOWN
            ping: result.ping,
            msg: result.msg,
            time: new Date().toISOString(),
            duration: result.ping ?? 0,
            down_count: downCount,
          }
          const beatId = this.store.recordHeartbeat(beat)
          this.notifyBeat(monitorId, { id: beatId, ...beat })

          const current = this.store.getMonitorById(monitorId)
          if (this.running && current?.active) {
            this.scheduleNext(monitorId, policyEval.interval * 1000)
          }
        }
      }
    } catch (err) {
      console.error(`[MonitorEngine] Error executing probe for #${monitorId}:`, err)
      const current = this.store.getMonitorById(monitorId)
      if (this.running && current?.active) {
        this.scheduleNext(monitorId, (current.interval || 60) * 1000)
      }
    }
  }
}
