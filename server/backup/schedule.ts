// 每天 03:00 跑一次备份（进程内定时器；BACKUP=0 / off / false 时整个定时任务关掉，手动备份不受影响）
import type { DatabaseSync } from 'node:sqlite'
import { scheduledEnabled } from './core.js'

// 这个模块会被 server/index.ts 在启动时 import，也会被单测 import。
// runBackup 走动态导入：模块加载时不把 db.ts 拉进来（否则单测一 import 就打开真实库，见坑 59）。
export { scheduledEnabled }

/** BACKUP_HOUR 只收 0–23 的整数，写坏了退回 3（NaN 会让 setTimeout 变成立即触发、无限重排） */
function backupHour(): number {
  const n = Number(process.env.BACKUP_HOUR ?? 3)
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : 3
}

function msUntilNext(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), backupHour(), 0, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next.getTime() - now.getTime()
}

let timer: ReturnType<typeof setTimeout> | null = null

export function startBackupScheduler(db: DatabaseSync): void {
  if (!scheduledEnabled()) return
  const schedule = () => {
    const wait = msUntilNext(new Date())
    timer = setTimeout(async () => {
      try {
        const { runBackup } = await import('./run.js')
        const r = await runBackup(db)
        console.log('[backup] 定时备份完成', JSON.stringify(r))
      } catch (e) {
        console.error('[backup] 定时备份失败:', String(e))
      }
      schedule()
    }, wait)
    timer.unref?.()
  }
  schedule()
}

export function stopBackupScheduler(): void {
  if (timer) clearTimeout(timer)
  timer = null
}
