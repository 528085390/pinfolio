// 本机文件目的地：把备份包写到 data/backups/，按份数保留，顺带把当天心跳 CSV 存进 data/audit/。
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { gunzipSync, gzipSync } from 'node:zlib'
import { DATA_DIR } from '../db.js'
import { collectEntries, readHeartbeats, type Manifest } from './collect.js'
import { backupFileName, dayStamp, heartbeatCsv, isWeeklySnapshot, pickExpired } from './core.js'
import { createTar, readTar } from './tar.js'

export const BACKUP_DIR = process.env.BACKUP_DIR ? resolve(process.env.BACKUP_DIR) : join(DATA_DIR, 'backups')
export const AUDIT_DIR = join(DATA_DIR, 'audit')
export const KEEP = Number(process.env.BACKUP_KEEP ?? 14)

export type LocalBackup = { name: string; size: number; mtime: string }

function ensure(dir: string) {
  mkdirSync(dir, { recursive: true })
}

/** 当天心跳单独归档（不受 14 份限制；Kuma 只留 365 天，长期审计靠它） */
export function archiveHeartbeats(day: Date): string | null {
  const beats = readHeartbeats(day)
  if (!beats.length) return null
  ensure(AUDIT_DIR)
  const file = join(AUDIT_DIR, 'heartbeats-' + dayStamp(day) + '.csv.gz')
  if (existsSync(file)) return file // 一天只写一次，重复跑不覆盖已有归档
  writeFileSync(file, gzipSync(Buffer.from(heartbeatCsv(beats))))
  return file
}

/** 打好一个备份包（内存里），本机目的地和远端目的地共用同一份字节 */
export async function buildPackage(db: DatabaseSync, date: Date, instanceId: string): Promise<{ name: string; data: Buffer; manifest: Manifest }> {
  const { entries, manifest } = await collectEntries({ db, date, instanceId, includeKuma: isWeeklySnapshot(date) })
  const data = gzipSync(createTar(entries), { level: 6 })
  return { name: backupFileName(date), data, manifest }
}

/** 写成本机文件 */
export function writeLocal(pkg: { name: string; data: Buffer }): { file: string; size: number } {
  ensure(BACKUP_DIR)
  const file = join(BACKUP_DIR, pkg.name)
  writeFileSync(file, pkg.data)
  return { file, size: pkg.data.length }
}

export function listLocal(): LocalBackup[] {
  if (!existsSync(BACKUP_DIR)) return []
  return readdirSync(BACKUP_DIR)
    .filter((n) => n.endsWith('.tar.gz'))
    .map((name) => {
      const st = statSync(join(BACKUP_DIR, name))
      return { name, size: st.size, mtime: st.mtime.toISOString() }
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1))
}

/** 读一份备份包的 manifest（页面的「内容清单」） */
export function readManifest(name: string): Manifest | null {
  const p = safePath(name)
  if (!p || !existsSync(p)) return null
  try {
    const entries = readTar(gunzipSync(readFileSync(p)))
    const m = entries.find((e) => e.name === 'manifest.json')
    return m ? (JSON.parse(m.data.toString('utf8')) as Manifest) : null
  } catch {
    return null
  }
}

export function backupPath(name: string): string | null {
  return safePath(name)
}

/** 只认备份目录里的普通文件名，防 ../ 越界 */
function safePath(name: string): string | null {
  if (!/^[A-Za-z0-9._-]+\.tar\.gz$/.test(name)) return null
  return join(BACKUP_DIR, name)
}

export function deleteLocal(name: string): boolean {
  const p = safePath(name)
  if (!p || !existsSync(p)) return false
  unlinkSync(p)
  return true
}

/** 超出保留份数的删掉（返回删掉的文件名） */
export function pruneLocal(keep = KEEP): string[] {
  const expired = pickExpired(listLocal().map((b) => b.name), keep)
  for (const name of expired) deleteLocal(name)
  return expired
}
