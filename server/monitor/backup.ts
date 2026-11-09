import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DATA_DIR, ROOT } from '../db.js'
import type { MonitorStore } from './store.js'
import { writeMonitorSnapshot } from './snapshot.js'

function tsStamp(d = new Date()): string {
  const pad = (n: number) => (n < 10 ? '0' + n : String(n))
  return (
    String(d.getFullYear()) +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  )
}

/**
 * 删观测项前自动备份 pinboard.db，最多保留 5 份。
 */
export function backupPinboardDb(db: DatabaseSync, dataDir = DATA_DIR): string | null {
  try {
    const backupDir = join(dataDir, 'backups')
    mkdirSync(backupDir, { recursive: true })
    const target = join(backupDir, 'pinboard-monitor-del-' + tsStamp() + '.db')
    try {
      db.exec("VACUUM INTO '" + target.replace(/'/g, "''") + "'")
    } catch {
      const dbFile = join(dataDir, 'pinboard.db')
      if (existsSync(dbFile)) {
        copyFileSync(dbFile, target)
        if (existsSync(dbFile + '-wal')) copyFileSync(dbFile + '-wal', target + '-wal')
      }
    }
    const files = readdirSync(backupDir)
      .filter((f) => /^pinboard-monitor-del-\d{8}-\d{6}\.db$/.test(f))
      .map((f) => ({ f, t: statSync(join(backupDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    for (const old of files.slice(5)) {
      try {
        unlinkSync(join(backupDir, old.f))
      } catch {
        /* ignore */
      }
    }
    return target
  } catch {
    return null
  }
}

let snapshotTimer: NodeJS.Timeout | null = null

/**
 * 防抖刷新观测快照 SNAPSHOT.md（默认 1.5 秒）。
 */
export function refreshMonitorSnapshot(store: MonitorStore, delay = 1500): void {
  if (snapshotTimer) clearTimeout(snapshotTimer)
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null
    const target =
      process.env.MONITOR_SNAPSHOT || resolve(ROOT, 'SNAPSHOT-MONITORS.md')
    try {
      writeMonitorSnapshot(target, store)
    } catch (e) {
      console.warn('[monitor-snapshot] 写入失败：', e)
    }
  }, delay)
  if ((snapshotTimer as any)?.unref) (snapshotTimer as any).unref()
}
