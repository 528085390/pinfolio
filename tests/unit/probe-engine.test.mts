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

test('MonitorEngine: concurrency pool limits active probe count and hands over slot directly', async () => {
  const { db, store } = createTestDb()
  const engine = new MonitorEngine({
    db,
    store,
    maxConcurrency: 2,
  })

  let activeCount = 0
  let maxObservedActive = 0
  const executionOrder: number[] = []

  const makeTask = (id: number, delayMs: number) => async () => {
    activeCount++
    if (activeCount > maxObservedActive) {
      maxObservedActive = activeCount
    }
    await new Promise((r) => setTimeout(r, delayMs))
    executionOrder.push(id)
    activeCount--
    return id
  }

  // Run 6 tasks via the concurrency runner
  const promises = [
    (engine as any).runWithConcurrencyLimit(makeTask(1, 30)),
    (engine as any).runWithConcurrencyLimit(makeTask(2, 30)),
    (engine as any).runWithConcurrencyLimit(makeTask(3, 10)),
    (engine as any).runWithConcurrencyLimit(makeTask(4, 10)),
    (engine as any).runWithConcurrencyLimit(makeTask(5, 10)),
    (engine as any).runWithConcurrencyLimit(makeTask(6, 10)),
  ]

  await Promise.all(promises)
  assert.equal(maxObservedActive <= 2, true, `Expected max concurrency <= 2, got ${maxObservedActive}`)
  assert.equal(executionOrder.length, 6)
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

test('MonitorEngine: retry logic on failure before exhausting maxretries and persistent DOWN without oscillation', async () => {
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

  // First execution: should fail and schedule retry (counter = 1, status = PENDING, down_count = 1)
  await (engine as any).executeSingleProbe(monitorId)
  assert.equal((engine as any).retryCounters.get(monitorId), 1)
  const beat1 = store.getLatestHeartbeat(monitorId)
  assert.ok(beat1)
  assert.equal(beat1.status, 2) // PENDING
  assert.equal(beat1.down_count, 1)

  // Second execution: still retrying (counter = 2, status = PENDING, down_count = 2)
  await (engine as any).executeSingleProbe(monitorId)
  assert.equal((engine as any).retryCounters.get(monitorId), 2)
  const beat2 = store.getLatestHeartbeat(monitorId)
  assert.ok(beat2)
  assert.equal(beat2.status, 2) // PENDING
  assert.equal(beat2.down_count, 2)

  // Third execution: maxretries (2) exhausted -> DOWN (0), down_count = 3
  await (engine as any).executeSingleProbe(monitorId)
  assert.equal((engine as any).retryCounters.get(monitorId) >= 2, true)
  const beat3 = store.getLatestHeartbeat(monitorId)
  assert.ok(beat3)
  assert.equal(beat3.status, 0) // DOWN
  assert.equal(beat3.down_count, 3)

  // Fourth execution: already DOWN -> remains DOWN, does NOT oscillate to PENDING, down_count = 4
  await (engine as any).executeSingleProbe(monitorId)
  assert.equal((engine as any).retryCounters.get(monitorId) >= 2, true)
  const beat4 = store.getLatestHeartbeat(monitorId)
  assert.ok(beat4)
  assert.equal(beat4.status, 0) // Still DOWN (not PENDING)
  assert.equal(beat4.down_count, 4)
})

test('MonitorEngine: subscriber errors in onBeat do not crash probeNow or scheduled probe', async () => {
  const { db, store } = createTestDb()
  const engine = new MonitorEngine({
    db,
    store,
    onBeat: () => {
      throw new Error('Subscriber exploded!')
    },
  })

  const monitorId = store.insertMonitor({
    name: 'Push test',
    type: 'push',
    active: 1,
  })

  // probeNow should succeed despite onBeat throwing
  const res = await engine.probeNow(monitorId)
  assert.equal(res.status, 0)
  assert.match(res.msg, /Push monitors cannot be probed actively/)

  // executeSingleProbe should not throw
  await (engine as any).executeSingleProbe(monitorId)
})

test('MonitorEngine: handles unexpected errors in executeSingleProbe and reschedules', async () => {
  const { db, store } = createTestDb()
  const engine = new MonitorEngine({
    db,
    store,
  })

  const monitorId = store.insertMonitor({
    name: 'Throwing probe test',
    type: 'http',
    url: 'http://127.0.0.1:8080',
    interval: 42,
    active: 1,
  })

  engine.start()

  // Force store.getLatestHeartbeat or executeProbe to throw
  const originalGet = store.getLatestHeartbeat
  store.getLatestHeartbeat = () => {
    throw new Error('Database disk I/O error')
  }

  try {
    // Should catch the error without throwing
    await (engine as any).executeSingleProbe(monitorId)
    // Should have rescheduled with interval = 42s
    assert.equal((engine as any).scheduleTimers.has(monitorId), true)
  } finally {
    store.getLatestHeartbeat = originalGet
    engine.stop()
  }
})

test('MonitorEngine: does not reschedule deactivated monitor during in-flight probe', async () => {
  const { db, store } = createTestDb()
  const engine = new MonitorEngine({ db, store })

  const monitorId = store.insertMonitor({
    name: 'Deactivated while probing',
    type: 'http',
    url: 'http://127.0.0.1:54321', // Unreachable
    timeout: 1,
    interval: 30,
    active: 1,
  })

  engine.start()

  // Deactivate monitor while probe is executing or before rescheduling
  store.updateMonitor(monitorId, { active: 0 })

  await (engine as any).executeSingleProbe(monitorId)
  assert.equal((engine as any).scheduleTimers.has(monitorId), false)

  engine.stop()
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

test('MonitorEngine: start schedules heartbeat pruning, and stop clears timer', () => {
  const { db, store } = createTestDb()
  const engine = new MonitorEngine({ db, store })

  assert.equal((engine as any).pruneTimer, null)
  engine.start()
  assert.ok((engine as any).pruneTimer)
  assert.ok((engine as any).initialPruneTimer)

  engine.stop()
  assert.equal((engine as any).pruneTimer, null)
  assert.equal((engine as any).initialPruneTimer, null)
  assert.equal(engine.isRunning(), false)
})
