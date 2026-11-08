import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { initMonitorTables, MonitorStore } from './store.ts'
import type { MonitorType, OutboundMode } from './types.ts'

function toIsoUtc(s?: string | null): string {
  if (!s) return new Date().toISOString()
  if (s.includes('T') && s.endsWith('Z')) return s
  const clean = s.trim().replace(' ', 'T')
  const d = new Date(clean + (clean.endsWith('Z') ? '' : 'Z'))
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

function parseAcceptedStatusCodes(raw: unknown): string {
  if (!raw) return '200-299'
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.join(',')
      }
    } catch {
      return raw.trim() || '200-299'
    }
    return raw.trim() || '200-299'
  }
  return '200-299'
}

function parseGroupNameFromPrefix(name: string): string {
  const parts = name.split(' / ')
  if (parts.length > 1) {
    return parts[0].trim()
  }
  return ''
}

export function migrateKumaDb(
  kumaDbPath: string,
  targetDb: DatabaseSync
): { migrated: number; beats: number } {
  if (!existsSync(kumaDbPath)) {
    return { migrated: 0, beats: 0 }
  }

  const kumaDb = new DatabaseSync(kumaDbPath, { readOnly: true })

  try {
    initMonitorTables(targetDb)
    const store = new MonitorStore(targetDb)

    const tableNames = kumaDb
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r: any) => r.name)

    const hasMonitor = tableNames.includes('monitor')
    if (!hasMonitor) {
      return { migrated: 0, beats: 0 }
    }

    const hasGroup = tableNames.includes('group') && tableNames.includes('monitor_group')
    const monitorSql = hasGroup
      ? `SELECT m.*, g.name AS kuma_group_name
         FROM monitor m
         LEFT JOIN monitor_group mg ON mg.monitor_id = m.id
         LEFT JOIN "group" g ON g.id = mg.group_id
         ORDER BY m.id ASC`
      : `SELECT m.*, NULL AS kuma_group_name FROM monitor m ORDER BY m.id ASC`

    const monitorRows = kumaDb.prepare(monitorSql).all() as any[]

    let migrated = 0
    let beats = 0

    targetDb.exec('BEGIN')
    try {
      for (const row of monitorRows) {
        const rawType = String(row.type || 'http').toLowerCase()
        const type: MonitorType =
          rawType === 'keyword'
            ? 'http'
            : rawType === 'port' || rawType === 'ssh' || rawType === 'push'
              ? rawType
              : 'http'

        let group_name = ''
        if (row.kuma_group_name && String(row.kuma_group_name).trim()) {
          group_name = String(row.kuma_group_name).trim()
        } else {
          group_name = parseGroupNameFromPrefix(String(row.name || ''))
        }

        const createdAt = toIsoUtc(row.created_date)

        store.insertMonitor({
          id: Number(row.id),
          name: String(row.name || ''),
          type,
          group_name,
          active: row.active !== undefined ? Number(row.active) : 1,
          interval: row.interval !== undefined ? Number(row.interval) : 60,
          timeout: row.timeout !== undefined ? Number(row.timeout) : 20,
          maxretries: row.maxretries !== undefined ? Number(row.maxretries) : 1,
          url: row.url ? String(row.url) : null,
          keyword: row.keyword ? String(row.keyword) : null,
          invert_keyword: row.invert_keyword ? 1 : 0,
          accepted_statuscodes: parseAcceptedStatusCodes(row.accepted_statuscodes_json),
          hostname: row.hostname ? String(row.hostname) : null,
          port: row.port !== undefined && row.port !== null ? Number(row.port) : null,
          ssh_username: row.ssh_username ? String(row.ssh_username) : null,
          ssh_password: row.ssh_password ? String(row.ssh_password) : null,
          ssh_private_key: row.ssh_private_key ? String(row.ssh_private_key) : null,
          ssh_passphrase: row.ssh_passphrase ? String(row.ssh_passphrase) : null,
          ssh_auth_method: row.ssh_auth_method
            ? String(row.ssh_auth_method)
            : row.ssh_password
              ? 'password'
              : 'privateKey',
          ssh_command: row.ssh_command ? String(row.ssh_command) : null,
          push_token: row.push_token ? String(row.push_token) : null,
          outbound_mode: (row.outbound_mode as OutboundMode) ?? null,
          policy_json: row.policy_json ? String(row.policy_json) : null,
          description: row.description ? String(row.description) : '',
          created_at: createdAt,
          updated_at: new Date().toISOString(),
        })

        migrated++
      }

      // Migrate heartbeats if table exists
      if (tableNames.includes('heartbeat')) {
        for (const m of monitorRows) {
          const rawBeats = kumaDb
            .prepare(
              `SELECT id, monitor_id, status, ping, msg, time, duration, down_count
               FROM heartbeat
               WHERE monitor_id = ?
               ORDER BY id DESC
               LIMIT 100`
            )
            .all(m.id) as any[]

          // Insert in chronological order (oldest to newest)
          const chronological = rawBeats.slice().reverse()
          for (const b of chronological) {
            store.recordHeartbeat({
              monitor_id: Number(b.monitor_id),
              status: Number(b.status),
              ping: typeof b.ping === 'number' ? b.ping : null,
              msg: b.msg ? String(b.msg) : '',
              time: toIsoUtc(b.time),
              duration: typeof b.duration === 'number' ? b.duration : 0,
              down_count: typeof b.down_count === 'number' ? b.down_count : 0,
            })
            beats++
          }
        }
      }

      targetDb.exec('COMMIT')
    } catch (err) {
      targetDb.exec('ROLLBACK')
      throw err
    }

    return { migrated, beats }
  } finally {
    kumaDb.close()
  }
}
