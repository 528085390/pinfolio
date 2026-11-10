// 收集要打进备份包的内容：pinboard 库快照、当天心跳 CSV、观测项定义、
// data/*.json|txt（含 secret.key）、根目录 4 个配置文件。
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { backup as sqliteBackup, DatabaseSync } from 'node:sqlite'
import { gzipSync } from 'node:zlib'
import { DATA_DIR, db as defaultDb } from '../db.js'
import { resolveConfigPaths } from './config-paths.js'
import { dayStamp, heartbeatCsv, type HeartbeatRow } from './core.js'
import type { TarEntry } from './tar.js'

// 纯函数挪到 config-paths.ts 是为了能单测（本文件一 import 就打开 SQLite、跑迁移）；
// 这里再导出一次，任务接口约定的入口就是 resolveConfigPaths。
export { resolveConfigPaths }

/** 根目录那几个可进版本库的配置文件：存在才打 */
export const ROOT_CONFIGS = ['monitor-links.json', 'monitor-actions.json', 'host-services.json', 'quick-links.json']

export type Manifest = {
  instanceId: string
  createdAt: string
  members: { name: string; size: number; sha256: string }[]
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex')

/** 用 node:sqlite 的模块级 backup() 做一致性快照 */
export async function snapshotDb(db: DatabaseSync, target: string): Promise<void> {
  await sqliteBackup(db, target)
}

/** 当天 00:00 ~ 次日 00:00（本地时区）的心跳 */
export function readHeartbeats(day: Date, targetDb: DatabaseSync = defaultDb): HeartbeatRow[] {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).toISOString()
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).toISOString()
  try {
    return targetDb
      .prepare(
        'SELECT h.time, h.monitor_id, m.name AS monitor_name, h.status, h.msg, h.ping ' +
          'FROM heartbeats h LEFT JOIN monitors m ON m.id = h.monitor_id ' +
          'WHERE h.time >= ? AND h.time < ? ORDER BY h.time',
      )
      .all(start, end) as HeartbeatRow[]
  } catch {
    return []
  }
}

/** 观测项定义快照：对着心跳 CSV 看「这一条是谁」 */
export function readMonitors(targetDb: DatabaseSync = defaultDb): unknown[] {
  try {
    return targetDb
      .prepare('SELECT id, name, active, type, url, hostname, port, interval, description FROM monitors ORDER BY id')
      .all()
  } catch {
    return []
  }
}

export type CollectOptions = {
  db: DatabaseSync
  date: Date
  instanceId: string
  includeKuma?: boolean
}

/** 打好包的成员列表（顺序固定，manifest 在最前） */
export async function collectEntries(opts: CollectOptions): Promise<{ entries: TarEntry[]; manifest: Manifest }> {
  const { db, date, instanceId } = opts
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
  const beats = readHeartbeats(date, db)
  if (beats.length) push('heartbeats-' + dayStamp(date) + '.csv.gz', gzipSync(Buffer.from(heartbeatCsv(beats))))

  // 3) 观测项定义
  const monitors = readMonitors(db)
  if (monitors.length) push('monitors.json', Buffer.from(JSON.stringify(monitors, null, 2)))

  // 4) data 下的 json / txt（secret.key 必须带上，否则密文解不开）
  for (const name of ['metrics.json', 'kuma-pass.txt', 'secret.key']) {
    const p = join(DATA_DIR, name)
    if (existsSync(p) && statSync(p).isFile()) push('data/' + name, readFileSync(p))
  }

  // 5) 根目录配置文件（桌面端 cwd 不可信：数据目录优先、cwd 兜底；条目名保持裸文件名）
  for (const path of resolveConfigPaths(ROOT_CONFIGS, { dataDir: DATA_DIR, cwd: process.cwd() })) {
    push(basename(path), readFileSync(path))
  }

  // 6) 本地附件（data/uploads）：不带它们，恢复出来全是破图。
  //    走对象存储的附件（attachments.storage='s3'）不在这台机器上，也不进 tar——
  //    换机器/灾备时桶要单独搬（见 docs/runbook.md「附件与对象存储」）。
  const uploads = join(DATA_DIR, 'uploads')
  if (existsSync(uploads)) {
    for (const name of readdirSync(uploads).sort()) {
      const p = join(uploads, name)
      if (name.startsWith('.') || !statSync(p).isFile()) continue
      push('data/uploads/' + name, readFileSync(p))
    }
  }

  const manifest: Manifest = {
    instanceId,
    createdAt: date.toISOString(),
    members: entries.map((e) => ({ name: e.name, size: e.data.length, sha256: sha256(e.data) })),
  }
  entries.unshift({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)), mtime: date })
  return { entries, manifest }
}
