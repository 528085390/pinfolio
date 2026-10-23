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

export function startTunnelProbe(intervalMs = 60_000): void {
  if (timer) return
  const tick = () => { void checkCore(db).catch(() => {}) }
  timer = setInterval(tick, intervalMs)
  timer.unref?.()
  setTimeout(tick, 3_000).unref?.()
}
