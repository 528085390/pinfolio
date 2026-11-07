import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { initMonitorTables, MonitorStore } from '../../server/monitor/store.ts'
import { MonitorEngine } from '../../server/monitor/engine.ts'
import type { HeartbeatRow, MonitorRow } from '../../server/monitor/types.ts'

function createTestDb(): { db: DatabaseSync; store: MonitorStore } {
  const db = new DatabaseSync(':memory:')
  initMonitorTables(db)
  const store = new MonitorStore(db)
  return { db, store }
}

test('MonitorEngine: concurrency pool limits active probe count', async () => {
  const { db, store } = createTestDb()
  const engine = new MonitorEngine({
    db,
    store,
    maxConcurrency: 2,
  })

  let activeCount = 0
  let maxObservedActive = 0

  const task = async () => {
    activeCount++
    if (activeCount > maxObservedActive) {
      maxObservedActive = activeCount
    }
    await new Promise((r) => setTimeout(r, 30))
    activeCount--
    return 1
  }

  // Run 6 tasks via the concurrency runner
  const promises = Array.from({ length: 6 }, () =>
    (engine as any).runWithConcurrencyLimit(task)
  )

  await Promise.all(promises)
  assert.equal(maxObservedActive <= 2, true, `Expected max concurrency <= 2, got ${maxObservedActive}`)
})

test('MonitorEngine: probeNow immediately executes probe and records heartbeat', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as any).port

  try {
    const { db, store } = createTestDb()
    let beatLogged: HeartbeatRow | null = null

    const engine = new MonitorEngine({
      db,
      store,
      onBeat: (_id, beat) => {
        beatLogged = beat
      },
    })

    const monitorId = store.insertMonitor({
      name: 'Local Test HTTP',
      type: 'http',
      url: `http://127.0.0.1:${port}/`,
      interval: 60,
      active: 1,
    })

    const result = await engine.probeNow(monitorId)
    assert.equal(result.status, 1)

    // Check DB record
    const latest = store.getLatestHeartbeat(monitorId)
    assert.ok(latest)
    assert.equal(latest.status, 1)
    assert.equal(latest.monitor_id, monitorId)

    // Check onBeat callback
    assert.ok(beatLogged)
    assert.equal((beatLogged as HeartbeatRow).monitor_id, monitorId)
    assert.equal((beatLogged as HeartbeatRow).status, 1)
  } finally {
    await new Promise<void>((r) => server.close(() => r()))
  }
})

test('MonitorEngine: retry logic on failure before exhausting maxretries', async () => {
  const { db, store } = createTestDb()
  const engine = new MonitorEngine({
    db,
    store,
  })

  // Target an unavailable port
  const monitorId = store.insertMonitor({
    name: 'Unreachable Port',
    type: 'port',
    hostname: '127.0.0.1',
    port: 59999,
    timeout: 1,
    maxretries: 2,
    active: 1,
  })

  // First execution: should fail and schedule retry (counter = 1, status = PENDING)
  await (engine as any).executeSingleProbe(monitorId)
  assert.equal((engine as any).retryCounters.get(monitorId), 1)
  const beat1 = store.getLatestHeartbeat(monitorId)
  assert.ok(beat1)
  assert.equal(beat1.status, 2) // PENDING

  // Second execution: still retrying (counter = 2, status = PENDING)
  await (engine as any).executeSingleProbe(monitorId)
  assert.equal((engine as any).retryCounters.get(monitorId), 2)
  const beat2 = store.getLatestHeartbeat(monitorId)
  assert.ok(beat2)
  assert.equal(beat2.status, 2) // PENDING

  // Third execution: maxretries (2) exhausted -> DOWN (0), retry count reset to 0
  await (engine as any).executeSingleProbe(monitorId)
  assert.equal((engine as any).retryCounters.get(monitorId), 0)
  const beat3 = store.getLatestHeartbeat(monitorId)
  assert.ok(beat3)
  assert.equal(beat3.status, 0) // DOWN
})

test('MonitorEngine: start and stop lifecycle manages timers and schedules', async () => {
  const { db, store } = createTestDb()
  const engine = new MonitorEngine({
    db,
    store,
  })

  const m1 = store.insertMonitor({ name: 'M1', type: 'port', hostname: '127.0.0.1', port: 80, active: 1 })
  const m2 = store.insertMonitor({ name: 'M2', type: 'port', hostname: '127.0.0.1', port: 81, active: 1 })
  const mInactive = store.insertMonitor({ name: 'M3', type: 'port', hostname: '127.0.0.1', port: 82, active: 0 })

  engine.start()
  assert.equal(engine.isRunning(), true)

  const timers = (engine as any).scheduleTimers as Map<number, any>
  assert.equal(timers.has(m1), true)
  assert.equal(timers.has(m2), true)
  assert.equal(timers.has(mInactive), false)

  // Pause m1 and refreshSchedule
  store.updateMonitor(m1, { active: 0 })
  engine.refreshSchedule()
  assert.equal(timers.has(m1), false)
  assert.equal(timers.has(m2), true)

  engine.stop()
  assert.equal(engine.isRunning(), false)
  assert.equal(timers.size, 0)
})

test('MonitorEngine: probeNow returns error result for non-existent monitor', async () => {
  const { db, store } = createTestDb()
  const engine = new MonitorEngine({ db, store })

  const res = await engine.probeNow(99999)
  assert.equal(res.status, 0)
  assert.match(res.msg, /not found/)
})

test('MonitorEngine: scheduled execution skips probe and records MAINTENANCE when policy gate is closed', async () => {
  const { db, store } = createTestDb()
  const engine = new MonitorEngine({ db, store })

  // Monitor with gate depending on monitor #99 which doesn't exist
  const gatePolicy = {
    v: 1,
    gate: {
      when: {
        monitorStatus: { id: 99, is: 'UP' },
      },
      recheck: 60,
    },
  }

  const monitorId = store.insertMonitor({
    name: 'Gated Monitor',
    type: 'http',
    url: 'http://127.0.0.1:1234/test',
    policy_json: JSON.stringify(gatePolicy),
    active: 1,
  })

  await (engine as any).executeSingleProbe(monitorId)

  const latest = store.getLatestHeartbeat(monitorId)
  assert.ok(latest)
  assert.equal(latest.status, 3) // MAINTENANCE
  assert.match(latest.msg, /依赖 #99 = UP/)
})

