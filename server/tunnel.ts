import type { DatabaseSync } from 'node:sqlite'
import { db } from './db.js'
import { checkTunnel as checkCore, getTunnel as getCore, setPublicUrl as setCore } from './tunnel-core.js'

// 薄封装：默认用全局 db，并把 60s 自检挂到进程上。逻辑都在 tunnel-core.ts（不依赖 db，好测）。
export {
  normalizePublicUrl, instanceId, getPublicUrl, type TunnelStatus,
} from './tunnel-core.js'

export const getTunnel = (database: DatabaseSync = db) => getCore(database)
export const checkTunnel = (database: DatabaseSync = db, timeoutMs = 5000) => checkCore(database, timeoutMs)
export const setPublicUrl = (database: DatabaseSync, raw: unknown) => setCore(database, raw)

let timer: NodeJS.Timeout | null = null
let bootTimer: NodeJS.Timeout | null = null

/** 关服务时调：停掉 60s 自检与开机那一次（重复调用无害）。 */
export function stopTunnelProbe(): void {
  if (timer) clearInterval(timer)
  if (bootTimer) clearTimeout(bootTimer)
  timer = null
  bootTimer = null
}

/** 返回 stop（startServer 收集起来、close() 时调）；已经在跑时不会再挂第二份。 */
export function startTunnelProbe(intervalMs = 60_000): () => void {
  if (timer) return stopTunnelProbe
  const tick = () => { void checkCore(db).catch(() => {}) }
  timer = setInterval(tick, intervalMs)
  timer.unref?.()
  bootTimer = setTimeout(tick, 3_000)
  bootTimer.unref?.()
  return stopTunnelProbe
}
