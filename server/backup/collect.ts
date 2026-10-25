// 收集要打进备份包的内容：pinboard 库快照、当天心跳 CSV、观测项定义、kuma 全量（周日）、
// data/*.json|txt（含 secret.key）、根目录 4 个配置文件。
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { backup as sqliteBackup, DatabaseSync } from 'node:sqlite'
import { gzipSync } from 'node:zlib'
import { DATA_DIR } from '../db.js'
import { KUMA_DB } from '../kuma/backup.js'
import { dayStamp, heartbeatCsv, type HeartbeatRow } from './core.js'
import type { TarEntry } from './tar.js'

export const ROOT = process.cwd()

/** 根目录那几个可进版本库的配置文件：存在才打 */
export const ROOT_CONFIGS = ['monitor-links.json', 'monitor-actions.json', 'host-services.json', 'quick-links.json']

export type Manifest = {
  instanceId: string
  createdAt: string
  members: { name: string; size: number; sha256: string }[]
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex')

/** 用 node:sqlite 的模块级 backup()（DatabaseSync.prototype.backup 是 undefined）做一致性快照 */
export async function snapshotDb(db: DatabaseSync, target: string): Promise<void> {
  await sqliteBackup(db, target)
}

/** Kuma 的 heartbeat.time 存的是 UTC 的 'YYYY-MM-DD HH:MM:SS.sss'，这里把「本地这一天」换成 UTC 边界 */
const utcStamp = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ')

/** 当天 00:00 ~ 次日 00:00（本地时区）的心跳（Kuma 库不在就当没有，不影响 pinboard 自己的备份） */
export function readHeartbeats(day: Date): HeartbeatRow[] {
  if (!existsSync(KUMA_DB)) return []
  const start = utcStamp(new Date(day.getFullYear(), day.getMonth(), day.getDate()))
  const end = utcStamp(new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1))
  const db = new DatabaseSync(KUMA_DB, { readOnly: true })
  try {
    return db
      .prepare(
        'SELECT h.time, h.monitor_id, m.name AS monitor_name, h.status, h.msg, h.ping ' +
          'FROM heartbeat h LEFT JOIN monitor m ON m.id = h.monitor_id ' +
          'WHERE h.time >= ? AND h.time < ? ORDER BY h.time',
      )
      .all(start, end) as HeartbeatRow[]
  } finally {
    db.close()
  }
}

/** 观测项定义快照：对着心跳 CSV 看「这一条是谁」 */
export function readMonitors(): unknown[] {
  if (!existsSync(KUMA_DB)) return []
  const db = new DatabaseSync(KUMA_DB, { readOnly: true })
  try {
    return db
      .prepare('SELECT id, name, active, type, url, hostname, port, interval, description FROM monitor ORDER BY id')
      .all()
  } finally {
    db.close()
  }
}

export type CollectOptions = {
  db: DatabaseSync
  date: Date
  instanceId: string
  includeKuma: boolean
}

/** 打好包的成员列表（顺序固定，manifest 在最前） */
export async function collectEntries(opts: CollectOptions): Promise<{ entries: TarEntry[]; manifest: Manifest }> {
  const { db, date, instanceId, includeKuma } = opts
  const entries: TarEntry[] = []
  const push = (name: string, data: Buffer) => entries.push({ name, data, mtime: date })

  // 1) pinboard 库快照（先落临时文件，再读进内存删掉）
  const tmp = join(DATA_DIR, '.snapshot-' + process.pid + '.db')
  await snapshotDb(db, tmp)
  try {
    push('pinboard.db', readFileSync(tmp))
  } finally {
    try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
  }

  // 2) 当天心跳 → CSV.gz（审计用）
  const beats = readHeartbeats(date)
  if (beats.length) push('heartbeats-' + dayStamp(date) + '.csv.gz', gzipSync(Buffer.from(heartbeatCsv(beats))))

  // 3) 观测项定义
  const monitors = readMonitors()
  if (monitors.length) push('monitors.json', Buffer.from(JSON.stringify(monitors, null, 2)))

  // 4) 周日带 Kuma 全量（整库恢复用）
  if (includeKuma && existsSync(KUMA_DB)) {
    const ktmp = join(DATA_DIR, '.kuma-' + process.pid + '.db')
    const kdb = new DatabaseSync(KUMA_DB, { readOnly: true })
    try {
      await sqliteBackup(kdb, ktmp)
      push('kuma.db', readFileSync(ktmp))
    } finally {
      kdb.close()
      try { rmSync(ktmp, { force: true }) } catch { /* ignore */ }
    }
  }

  // 5) data 下的 json / txt（secret.key 必须带上，否则 03 的密文解不开）
  for (const name of ['metrics.json', 'kuma-pass.txt', 'secret.key']) {
    const p = join(DATA_DIR, name)
    if (existsSync(p) && statSync(p).isFile()) push('data/' + name, readFileSync(p))
  }

  // 6) 根目录配置文件
  for (const name of ROOT_CONFIGS) {
    const p = join(ROOT, name)
    if (existsSync(p) && statSync(p).isFile()) push(name, readFileSync(p))
  }

  const manifest: Manifest = {
    instanceId,
    createdAt: date.toISOString(),
    members: entries.map((e) => ({ name: e.name, size: e.data.length, sha256: sha256(e.data) })),
  }
  entries.unshift({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)), mtime: date })
  return { entries, manifest }
}
