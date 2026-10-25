import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

/**
 * 迁移前快照（spec 04「升级流程」+ spec 05「迁移前 pre-migrate 保留 5 份」）。
 *
 * 用 `VACUUM INTO` 而不是复制文件：WAL 模式下直接拷 .db 会漏掉 -wal 里还没落盘的事务，
 * 而 VACUUM INTO 出来的是一个干净的单文件库，且是同步的（migrate 本身同步）。
 * 只在「老库要升级」时拍，全新库（user_version = 0）没有可丢的东西，不拍。
 */
export const PREMIGRATE_RE = /^pre-migrate-v\d+-\d{14}\.db$/

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
}

/** 拍一张迁移前快照，返回文件路径（跳过的情形返回 null） */
export function snapshotBeforeMigrate(db: DatabaseSync, dataDir: string, fromVersion: number, keep = 5, now = new Date()): string | null {
  if (fromVersion <= 0) return null
  const dir = join(dataDir, 'backups')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'pre-migrate-v' + fromVersion + '-' + stamp(now) + '.db')
  if (existsSync(file)) return file
  db.exec("VACUUM INTO '" + file.replace(/'/g, "''") + "'")
  prunePremigrate(dir, keep)
  return file
}

/** 只保留最近 keep 份 pre-migrate 快照（按修改时间，不碰其它备份） */
export function prunePremigrate(dir: string, keep = 5): string[] {
  let names: string[] = []
  try {
    names = readdirSync(dir).filter((n) => PREMIGRATE_RE.test(n))
  } catch {
    return []
  }
  const sorted = names
    .map((n) => ({ n, t: statSync(join(dir, n)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  const dead = sorted.slice(Math.max(0, keep)).map((x) => x.n)
  for (const n of dead) {
    try { rmSync(join(dir, n), { force: true }) } catch { /* 删不掉就留着，不影响升级 */ }
  }
  return dead
}
