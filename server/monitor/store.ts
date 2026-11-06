import type { DatabaseSync } from 'node:sqlite'
import type { HeartbeatRow, MonitorRow } from './types.ts'

export function initMonitorTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS monitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      group_name TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      interval INTEGER NOT NULL DEFAULT 60,
      timeout INTEGER NOT NULL DEFAULT 20,
      maxretries INTEGER NOT NULL DEFAULT 1,
      url TEXT,
      keyword TEXT,
      invert_keyword INTEGER NOT NULL DEFAULT 0,
      accepted_statuscodes TEXT NOT NULL DEFAULT '200-299',
      hostname TEXT,
      port INTEGER,
      ssh_username TEXT,
      ssh_password TEXT,
      ssh_private_key TEXT,
      ssh_passphrase TEXT,
      ssh_auth_method TEXT DEFAULT 'privateKey',
      ssh_command TEXT,
      push_token TEXT,
      outbound_mode TEXT,
      policy_json TEXT,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS heartbeats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
      status INTEGER NOT NULL,
      ping INTEGER,
      msg TEXT NOT NULL DEFAULT '',
      time TEXT NOT NULL,
      duration INTEGER NOT NULL DEFAULT 0,
      down_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_heartbeats_monitor_time ON heartbeats(monitor_id, time DESC);
    CREATE INDEX IF NOT EXISTS idx_heartbeats_time ON heartbeats(time DESC);
  `)
}

export class MonitorStore {
  constructor(private db: DatabaseSync) {}

  getAllMonitors(activeOnly = false): MonitorRow[] {
    const sql = activeOnly
      ? 'SELECT * FROM monitors WHERE active = 1 ORDER BY id ASC'
      : 'SELECT * FROM monitors ORDER BY id ASC'
    return this.db.prepare(sql).all() as unknown as MonitorRow[]
  }

  getMonitors(activeOnly = false): MonitorRow[] {
    return this.getAllMonitors(activeOnly)
  }

  getMonitorById(id: number): MonitorRow | null {
    const row = this.db.prepare('SELECT * FROM monitors WHERE id = ?').get(id)
    return row ? (row as unknown as MonitorRow) : null
  }

  getMonitorsByGroup(groupName: string): MonitorRow[] {
    return this.db
      .prepare('SELECT * FROM monitors WHERE group_name = ? ORDER BY id ASC')
      .all(groupName) as unknown as MonitorRow[]
  }

  insertMonitor(m: Partial<MonitorRow>): number {
    const now = new Date().toISOString()
    const name = m.name ?? ''
    const type = m.type ?? 'http'
    const group_name = m.group_name ?? ''
    const active = m.active !== undefined ? Number(m.active) : 1
    const interval = m.interval !== undefined ? Number(m.interval) : 60
    const timeout = m.timeout !== undefined ? Number(m.timeout) : 20
    const maxretries = m.maxretries !== undefined ? Number(m.maxretries) : 1
    const url = m.url ?? null
    const keyword = m.keyword ?? null
    const invert_keyword = m.invert_keyword ? 1 : 0
    const accepted_statuscodes = m.accepted_statuscodes ?? '200-299'
    const hostname = m.hostname ?? null
    const port = m.port !== undefined && m.port !== null ? Number(m.port) : null
    const ssh_username = m.ssh_username ?? null
    const ssh_password = m.ssh_password ?? null
    const ssh_private_key = m.ssh_private_key ?? null
    const ssh_passphrase = m.ssh_passphrase ?? null
    const ssh_auth_method = m.ssh_auth_method ?? (ssh_password ? 'password' : 'privateKey')
    const ssh_command = m.ssh_command ?? null
    const push_token = m.push_token ?? null
    const outbound_mode = m.outbound_mode ?? null
    const policy_json = m.policy_json ?? null
    const description = m.description ?? ''
    const created_at = m.created_at ?? now
    const updated_at = m.updated_at ?? now

    if (m.id !== undefined && m.id !== null) {
      this.db
        .prepare(
          `INSERT INTO monitors (
            id, name, type, group_name, active, interval, timeout, maxretries,
            url, keyword, invert_keyword, accepted_statuscodes, hostname, port,
            ssh_username, ssh_password, ssh_private_key, ssh_passphrase,
            ssh_auth_method, ssh_command, push_token, outbound_mode,
            policy_json, description, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          Number(m.id),
          name,
          type,
          group_name,
          active,
          interval,
          timeout,
          maxretries,
          url,
          keyword,
          invert_keyword,
          accepted_statuscodes,
          hostname,
          port,
          ssh_username,
          ssh_password,
          ssh_private_key,
          ssh_passphrase,
          ssh_auth_method,
          ssh_command,
          push_token,
          outbound_mode,
          policy_json,
          description,
          created_at,
          updated_at
        )
      return Number(m.id)
    }

    const res = this.db
      .prepare(
        `INSERT INTO monitors (
          name, type, group_name, active, interval, timeout, maxretries,
          url, keyword, invert_keyword, accepted_statuscodes, hostname, port,
          ssh_username, ssh_password, ssh_private_key, ssh_passphrase,
          ssh_auth_method, ssh_command, push_token, outbound_mode,
          policy_json, description, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        name,
        type,
        group_name,
        active,
        interval,
        timeout,
        maxretries,
        url,
        keyword,
        invert_keyword,
        accepted_statuscodes,
        hostname,
        port,
        ssh_username,
        ssh_password,
        ssh_private_key,
        ssh_passphrase,
        ssh_auth_method,
        ssh_command,
        push_token,
        outbound_mode,
        policy_json,
        description,
        created_at,
        updated_at
      )

    return Number(res.lastInsertRowid)
  }

  updateMonitor(id: number, patch: Partial<MonitorRow>): boolean {
    const fields: string[] = []
    const values: (string | number | null)[] = []

    const validKeys: (keyof MonitorRow)[] = [
      'name',
      'type',
      'group_name',
      'active',
      'interval',
      'timeout',
      'maxretries',
      'url',
      'keyword',
      'invert_keyword',
      'accepted_statuscodes',
      'hostname',
      'port',
      'ssh_username',
      'ssh_password',
      'ssh_private_key',
      'ssh_passphrase',
      'ssh_auth_method',
      'ssh_command',
      'push_token',
      'outbound_mode',
      'policy_json',
      'description',
    ]

    for (const key of validKeys) {
      if (key in patch && patch[key] !== undefined) {
        fields.push(`${key} = ?`)
        values.push(patch[key] as string | number | null)
      }
    }

    fields.push('updated_at = ?')
    values.push(patch.updated_at ?? new Date().toISOString())

    values.push(id)
    const sql = `UPDATE monitors SET ${fields.join(', ')} WHERE id = ?`
    const res = this.db.prepare(sql).run(...values)
    return Number(res.changes) > 0
  }

  deleteMonitor(id: number): boolean {
    const res = this.db.prepare('DELETE FROM monitors WHERE id = ?').run(id)
    return Number(res.changes) > 0
  }

  deleteMonitorsByGroup(groupName: string): number {
    const res = this.db.prepare('DELETE FROM monitors WHERE group_name = ?').run(groupName)
    return Number(res.changes)
  }

  recordHeartbeat(beat: Omit<HeartbeatRow, 'id'>): number {
    const time = beat.time ?? new Date().toISOString()
    const msg = beat.msg ?? ''
    const duration = beat.duration ?? 0
    const down_count = beat.down_count ?? 0
    const ping = beat.ping !== undefined ? beat.ping : null

    const res = this.db
      .prepare(
        `INSERT INTO heartbeats (monitor_id, status, ping, msg, time, duration, down_count)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(beat.monitor_id, beat.status, ping, msg, time, duration, down_count)
    return Number(res.lastInsertRowid)
  }

  getRecentHeartbeats(monitorId: number, limit = 100): HeartbeatRow[] {
    return this.db
      .prepare(
        `SELECT * FROM heartbeats WHERE monitor_id = ? ORDER BY time DESC, id DESC LIMIT ?`
      )
      .all(monitorId, limit) as unknown as HeartbeatRow[]
  }

  getLatestHeartbeat(monitorId: number): HeartbeatRow | null {
    const row = this.db
      .prepare(
        `SELECT * FROM heartbeats WHERE monitor_id = ? ORDER BY time DESC, id DESC LIMIT 1`
      )
      .get(monitorId)
    return row ? (row as unknown as HeartbeatRow) : null
  }

  pruneHeartbeats(keepDays = 7): number {
    const cutoff = new Date(Date.now() - keepDays * 86400 * 1000).toISOString()
    const res = this.db.prepare('DELETE FROM heartbeats WHERE time < ?').run(cutoff)
    return Number(res.changes)
  }
}
