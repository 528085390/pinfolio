import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import {
  initMonitorTables,
  MonitorStore,
} from '../../server/monitor/store.ts'
import { MonitorStatus } from '../../server/monitor/types.ts'

function createMemoryDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  initMonitorTables(db)
  return db
}

test('Monitor tables initialization is idempotent', () => {
  const db = new DatabaseSync(':memory:')
  initMonitorTables(db)
  // Calling second time should not throw
  initMonitorTables(db)

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r: any) => r.name)
  assert.ok(tables.includes('monitors'))
  assert.ok(tables.includes('heartbeats'))

  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
    .all()
    .map((r: any) => r.name)
  assert.ok(indexes.includes('idx_heartbeats_monitor_time'))
  assert.ok(indexes.includes('idx_heartbeats_time'))
})

test('MonitorStore: insert and getMonitorById with default values', () => {
  const db = createMemoryDb()
  const store = new MonitorStore(db)

  const id = store.insertMonitor({
    name: 'Test HTTP Monitor',
    type: 'http',
    url: 'https://example.com/health',
  })

  assert.ok(id > 0)
  const monitor = store.getMonitorById(id)
  assert.ok(monitor)
  assert.equal(monitor.id, id)
  assert.equal(monitor.name, 'Test HTTP Monitor')
  assert.equal(monitor.type, 'http')
  assert.equal(monitor.url, 'https://example.com/health')
  assert.equal(monitor.active, 1)
  assert.equal(monitor.interval, 60)
  assert.equal(monitor.timeout, 20)
  assert.equal(monitor.maxretries, 1)
  assert.equal(monitor.group_name, '')
  assert.equal(monitor.invert_keyword, 0)
  assert.equal(monitor.accepted_statuscodes, '200-299')
  assert.equal(monitor.description, '')
  assert.ok(monitor.created_at)
  assert.ok(monitor.updated_at)
})

test('MonitorStore: insert with explicit ID preserves ID', () => {
  const db = createMemoryDb()
  const store = new MonitorStore(db)

  const explicitId = 127
  const id = store.insertMonitor({
    id: explicitId,
    name: 'Explicit ID Monitor',
    type: 'ssh',
    hostname: '10.0.0.5',
    port: 22,
    ssh_username: 'ubuntu',
    ssh_command: 'uptime',
  })

  assert.equal(id, explicitId)
  const monitor = store.getMonitorById(explicitId)
  assert.ok(monitor)
  assert.equal(monitor.id, explicitId)
  assert.equal(monitor.hostname, '10.0.0.5')
  assert.equal(monitor.ssh_username, 'ubuntu')
})

test('MonitorStore: getAllMonitors and activeOnly filter', () => {
  const db = createMemoryDb()
  const store = new MonitorStore(db)

  store.insertMonitor({ name: 'Active 1', type: 'http', active: 1 })
  store.insertMonitor({ name: 'Inactive 1', type: 'http', active: 0 })
  store.insertMonitor({ name: 'Active 2', type: 'port', active: 1 })

  const allMonitors = store.getAllMonitors()
  assert.equal(allMonitors.length, 3)

  const activeOnly = store.getAllMonitors(true)
  assert.equal(activeOnly.length, 2)
  assert.ok(activeOnly.every((m) => m.active === 1))
})

test('MonitorStore: getMonitorsByGroup and deleteMonitorsByGroup', () => {
  const db = createMemoryDb()
  const store = new MonitorStore(db)

  store.insertMonitor({ name: 'm1', type: 'http', group_name: 'Alpha' })
  store.insertMonitor({ name: 'm2', type: 'port', group_name: 'Alpha' })
  store.insertMonitor({ name: 'm3', type: 'ssh', group_name: 'Beta' })

  const alpha = store.getMonitorsByGroup('Alpha')
  assert.equal(alpha.length, 2)
  const beta = store.getMonitorsByGroup('Beta')
  assert.equal(beta.length, 1)

  const deleted = store.deleteMonitorsByGroup('Alpha')
  assert.equal(deleted, 2)
  assert.equal(store.getMonitorsByGroup('Alpha').length, 0)
  assert.equal(store.getMonitorsByGroup('Beta').length, 1)
})

test('MonitorStore: updateMonitor modifies fields and updated_at', () => {
  const db = createMemoryDb()
  const store = new MonitorStore(db)

  const id = store.insertMonitor({
    name: 'Old Name',
    type: 'http',
    interval: 60,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  })

  const ok = store.updateMonitor(id, {
    name: 'New Name',
    interval: 120,
    outbound_mode: 'proxy',
  })

  assert.equal(ok, true)
  const updated = store.getMonitorById(id)
  assert.ok(updated)
  assert.equal(updated.name, 'New Name')
  assert.equal(updated.interval, 120)
  assert.equal(updated.outbound_mode, 'proxy')
  assert.notEqual(updated.updated_at, '2026-01-01T00:00:00.000Z')

  // Update non-existing monitor returns false
  assert.equal(store.updateMonitor(999999, { name: 'Ghost' }), false)
})

test('MonitorStore: deleteMonitor cascades to heartbeats', () => {
  const db = createMemoryDb()
  const store = new MonitorStore(db)

  const id = store.insertMonitor({ name: 'To Delete', type: 'http' })
  store.recordHeartbeat({
    monitor_id: id,
    status: MonitorStatus.UP,
    ping: 50,
    msg: 'OK',
    time: new Date().toISOString(),
    duration: 0,
    down_count: 0,
  })

  const beforeBeats = store.getRecentHeartbeats(id)
  assert.equal(beforeBeats.length, 1)

  const ok = store.deleteMonitor(id)
  assert.equal(ok, true)
  assert.equal(store.getMonitorById(id), null)

  // Verify heartbeats cascaded away
  const afterBeats = store.getRecentHeartbeats(id)
  assert.equal(afterBeats.length, 0)

  // Deleting again returns false
  assert.equal(store.deleteMonitor(id), false)
})

test('MonitorStore: recordHeartbeat, getRecentHeartbeats, getLatestHeartbeat', () => {
  const db = createMemoryDb()
  const store = new MonitorStore(db)

  const id = store.insertMonitor({ name: 'HB Test', type: 'http' })

  // Initially no heartbeat
  assert.equal(store.getLatestHeartbeat(id), null)
  assert.deepEqual(store.getRecentHeartbeats(id), [])

  const t1 = '2026-11-06T07:00:00.000Z'
  const t2 = '2026-11-06T07:01:00.000Z'
  const t3 = '2026-11-06T07:02:00.000Z'

  store.recordHeartbeat({
    monitor_id: id,
    status: MonitorStatus.UP,
    ping: 20,
    msg: '200 OK',
    time: t1,
    duration: 0,
    down_count: 0,
  })

  store.recordHeartbeat({
    monitor_id: id,
    status: MonitorStatus.DOWN,
    ping: null,
    msg: '503 Service Unavailable',
    time: t2,
    duration: 0,
    down_count: 1,
  })

  store.recordHeartbeat({
    monitor_id: id,
    status: MonitorStatus.UP,
    ping: 15,
    msg: '200 OK',
    time: t3,
    duration: 0,
    down_count: 0,
  })

  const latest = store.getLatestHeartbeat(id)
  assert.ok(latest)
  assert.equal(latest.status, MonitorStatus.UP)
  assert.equal(latest.time, t3)
  assert.equal(latest.ping, 15)

  const recent = store.getRecentHeartbeats(id, 2)
  assert.equal(recent.length, 2)
  // Ordered newest first (time DESC)
  assert.equal(recent[0].time, t3)
  assert.equal(recent[1].time, t2)
})

test('MonitorStore: pruneHeartbeats removes only expired records', () => {
  const db = createMemoryDb()
  const store = new MonitorStore(db)

  const id = store.insertMonitor({ name: 'Prune Test', type: 'http' })

  const now = Date.now()
  const oldTime = new Date(now - 10 * 86400 * 1000).toISOString() // 10 days ago
  const freshTime = new Date(now - 2 * 86400 * 1000).toISOString() // 2 days ago

  store.recordHeartbeat({
    monitor_id: id,
    status: MonitorStatus.UP,
    ping: 10,
    msg: 'old',
    time: oldTime,
    duration: 0,
    down_count: 0,
  })

  store.recordHeartbeat({
    monitor_id: id,
    status: MonitorStatus.UP,
    ping: 10,
    msg: 'fresh',
    time: freshTime,
    duration: 0,
    down_count: 0,
  })

  assert.equal(store.getRecentHeartbeats(id).length, 2)

  // Prune older than 7 days (default)
  const pruned = store.pruneHeartbeats(7)
  assert.equal(pruned, 1)

  const remaining = store.getRecentHeartbeats(id)
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].msg, 'fresh')
})
