import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { migrateKumaDb } from '../../server/monitor/migrate.ts'
import { MonitorStore, initMonitorTables } from '../../server/monitor/store.ts'

function createTargetDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  initMonitorTables(db)
  return db
}

test('migrateKumaDb returns zero if database path does not exist', () => {
  const targetDb = createTargetDb()
  const result = migrateKumaDb('/non/existent/kuma.db', targetDb)
  assert.deepEqual(result, { migrated: 0, beats: 0 })
})

test('migrateKumaDb correctly imports monitors and heartbeats from mock Kuma DB', () => {
  const mockPath = join(tmpdir(), `mock-kuma-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  const mockDb = new DatabaseSync(mockPath)

  try {
    // 1. Setup mock Kuma tables
    mockDb.exec(`
      CREATE TABLE monitor (
        id INTEGER PRIMARY KEY,
        name TEXT,
        type TEXT,
        active INTEGER DEFAULT 1,
        interval INTEGER DEFAULT 60,
        timeout INTEGER DEFAULT 10,
        maxretries INTEGER DEFAULT 1,
        url TEXT,
        keyword TEXT,
        invert_keyword INTEGER DEFAULT 0,
        accepted_statuscodes_json TEXT,
        hostname TEXT,
        port INTEGER,
        ssh_username TEXT,
        ssh_password TEXT,
        ssh_private_key TEXT,
        ssh_passphrase TEXT,
        ssh_auth_method TEXT,
        ssh_command TEXT,
        push_token TEXT,
        outbound_mode TEXT,
        policy_json TEXT,
        description TEXT,
        created_date TEXT
      );

      CREATE TABLE "group" (
        id INTEGER PRIMARY KEY,
        name TEXT
      );

      CREATE TABLE monitor_group (
        monitor_id INTEGER,
        group_id INTEGER
      );

      CREATE TABLE heartbeat (
        id INTEGER PRIMARY KEY,
        monitor_id INTEGER,
        status INTEGER,
        ping INTEGER,
        msg TEXT,
        time TEXT,
        duration INTEGER DEFAULT 0,
        down_count INTEGER DEFAULT 0
      );
    `)

    // 2. Populate mock data
    mockDb.exec(`
      INSERT INTO "group" (id, name) VALUES (10, 'Group Alpha');

      INSERT INTO monitor (
        id, name, type, active, interval, timeout, maxretries, url, keyword, accepted_statuscodes_json, created_date
      ) VALUES (
        1, 'Web API', 'http', 1, 30, 5, 2, 'https://api.test/health', 'ok', '["200-299"]', '2026-10-18 15:00:00'
      );
      INSERT INTO monitor_group (monitor_id, group_id) VALUES (1, 10);

      INSERT INTO monitor (
        id, name, type, active, hostname, port
      ) VALUES (
        2, 'Database Port', 'port', 1, '127.0.0.1', 5432
      );
      INSERT INTO monitor_group (monitor_id, group_id) VALUES (2, 10);

      INSERT INTO monitor (
        id, name, type, active, hostname, port, ssh_username, ssh_private_key, ssh_command, ssh_auth_method
      ) VALUES (
        3, 'Remote Service', 'ssh', 1, '192.168.1.10', 22, 'root', 'PRIVATE_KEY_DATA', 'systemctl status app', 'privateKey'
      );

      INSERT INTO monitor (
        id, name, type, active, push_token
      ) VALUES (
        4, 'Backup Cron Push', 'push', 1, 'secret-token-abc'
      );

      INSERT INTO monitor (
        id, name, type, active, policy_json, outbound_mode
      ) VALUES (
        5, 'FallbackGroup / SubService', 'http', 0, '{"v":1}', 'proxy'
      );
    `)

    // Insert 120 heartbeats for monitor 1 (to test 100 limit)
    const stmt = mockDb.prepare(
      'INSERT INTO heartbeat (id, monitor_id, status, ping, msg, time, duration, down_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    for (let i = 1; i <= 120; i++) {
      stmt.run(
        i,
        1,
        1,
        10 + (i % 20),
        '200 OK',
        `2026-11-06 06:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000`,
        0,
        0
      )
    }

    mockDb.close()

    // 3. Migrate into target DB
    const targetDb = createTargetDb()
    const result = migrateKumaDb(mockPath, targetDb)

    assert.equal(result.migrated, 5)
    // Monitor 1 has 120 heartbeats, capped at 100 recent
    assert.equal(result.beats, 100)

    const store = new MonitorStore(targetDb)
    const m1 = store.getMonitorById(1)
    assert.ok(m1)
    assert.equal(m1.name, 'Web API')
    assert.equal(m1.group_name, 'Group Alpha')
    assert.equal(m1.interval, 30)
    assert.equal(m1.accepted_statuscodes, '200-299')
    assert.equal(m1.keyword, 'ok')
    assert.ok(m1.created_at.includes('T'))

    const m3 = store.getMonitorById(3)
    assert.ok(m3)
    assert.equal(m3.type, 'ssh')
    assert.equal(m3.ssh_username, 'root')
    assert.equal(m3.ssh_private_key, 'PRIVATE_KEY_DATA')
    assert.equal(m3.ssh_auth_method, 'privateKey')

    const m4 = store.getMonitorById(4)
    assert.ok(m4)
    assert.equal(m4.type, 'push')
    assert.equal(m4.push_token, 'secret-token-abc')

    const m5 = store.getMonitorById(5)
    assert.ok(m5)
    // Fallback to name prefix when monitor_group is not set
    assert.equal(m5.group_name, 'FallbackGroup')
    assert.equal(m5.active, 0)
    assert.equal(m5.outbound_mode, 'proxy')
    assert.equal(m5.policy_json, '{"v":1}')

    // Check heartbeats for monitor 1
    const beats = store.getRecentHeartbeats(1, 150)
    assert.equal(beats.length, 100)
    assert.ok(beats[0].time.includes('T'))
    assert.ok(beats[0].time.endsWith('Z'))
  } finally {
    try {
      if (existsSync(mockPath)) unlinkSync(mockPath)
    } catch {
      // ignore
    }
  }
})

test('migrateKumaDb against real local kuma.db if present', () => {
  const realKumaPath = 'e:/bqj/kuma/data/kuma.db'
  if (!existsSync(realKumaPath)) {
    return
  }

  const targetDb = createTargetDb()
  const result = migrateKumaDb(realKumaPath, targetDb)

  assert.ok(result.migrated >= 20, 'All Kuma monitors must be migrated')
  assert.ok(result.beats > 0, 'Heartbeats must be migrated')

  const store = new MonitorStore(targetDb)
  const m1 = store.getMonitorById(1)
  assert.ok(m1)
  assert.equal(m1.name, 'WorkBuddy 网关 API（7863）')
  assert.equal(m1.type, 'http')

  const m23 = store.getMonitorById(23)
  assert.ok(m23)
  assert.equal(m23.name, '易广金签到台（8787）')
  assert.ok(m23.policy_json && m23.policy_json.includes('1200'))

  const m7 = store.getMonitorById(7)
  assert.ok(m7)
  assert.equal(m7.type, 'ssh')
  assert.equal(m7.ssh_username, 'opc')
})
