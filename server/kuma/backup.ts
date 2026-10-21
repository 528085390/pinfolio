import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// Kuma 项目目录：改完观测项要重生成它的 SNAPSHOT.md，删除前要备份它的库。
//   KUMA_DIR  默认 <pinboard 的上一级>/kuma（两个项目在同一工作区里并列）
export const KUMA_DIR = process.env.KUMA_DIR || resolve(process.cwd(), '..', 'kuma')
export const KUMA_DB = join(KUMA_DIR, 'data', 'kuma.db')
const KUMA_BACKUP_DIR = join(KUMA_DIR, 'backups')
const KUMA_BACKUP_KEEP = 5

/** 改完观测项要重生成 kuma/SNAPSHOT.md（防抖 1.5 秒：连着保存只写一次）。 */
let snapshotTimer: ReturnType<typeof setTimeout> | null = null
export function refreshSnapshot() {
  if (snapshotTimer) clearTimeout(snapshotTimer)
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null
    try {
      const child = spawn(process.execPath, [join(KUMA_DIR, 'tools', 'snapshot.cjs')], {
        cwd: KUMA_DIR,
        stdio: 'ignore',
        windowsHide: true,
      })
      child.on('error', () => { /* 快照失败不影响保存本身 */ })
      child.unref()
    } catch { /* ignore */ }
  }, 1500)
  ;(snapshotTimer as any).unref?.()
}

function tsStamp(d = new Date()): string {
  const pad = (n: number) => (n < 10 ? '0' + n : String(n))
  return String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate()) + '-'
    + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds())
}

/** 删观测项之前备份整个 Kuma 库；只留最近 5 份。 */
export function backupDb(): string | null {
  try {
    if (!existsSync(KUMA_DB)) return null
    mkdirSync(KUMA_BACKUP_DIR, { recursive: true })
    const target = join(KUMA_BACKUP_DIR, 'kuma-' + tsStamp() + '.db')
    try {
      // 直接复制文件不够：kuma.db 开着 WAL，最近的写入还在 -wal 里没并进主库。
      // VACUUM INTO 走一次一致性快照，把 WAL 里的内容一起带上。
      const db = new DatabaseSync(KUMA_DB)
      try {
        db.exec("VACUUM INTO '" + target.replace(/'/g, "''") + "'")
      } finally {
        db.close()
      }
    } catch {
      copyFileSync(KUMA_DB, target)
      if (existsSync(KUMA_DB + '-wal')) copyFileSync(KUMA_DB + '-wal', target + '-wal')
    }
    const files = readdirSync(KUMA_BACKUP_DIR)
      .filter((f) => /^kuma-\d{8}-\d{6}\.db$/.test(f))
      .map((f) => ({ f, t: statSync(join(KUMA_BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    for (const old of files.slice(KUMA_BACKUP_KEEP)) {
      try { unlinkSync(join(KUMA_BACKUP_DIR, old.f)) } catch { /* ignore */ }
    }
    return target
  } catch {
    return null
  }
}
