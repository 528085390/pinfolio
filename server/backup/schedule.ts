// 每天 03:00 跑一次备份（进程内定时器；BACKUP=0 / off / false 时整个定时任务关掉，手动备份不受影响）
import type { DatabaseSync } from 'node:sqlite'
import { runBackup } from './run.js'

/** BACKUP=0 关掉定时任务；空串/未设算开启（默认开） */
export function scheduledEnabled(): boolean {
  const v = String(process.env.BACKUP ?? '').trim().toLowerCase()
  return !(v === '0' || v === 'off' || v === 'false' || v === 'no')
}

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
