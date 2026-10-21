import { listMonitors } from './client.js'
import { loadLinks } from './links.js'
import { mapBeat, toIso, toneChar, type RawBeat } from './beat.js'
import { buildPayload, groupNameIn, BEAT_WINDOW, type Payload } from './payload.js'
import { getHeartbeats, getStatusPage, invalidateSource, lastStatusPage, KUMA_BASE, KUMA_SLUG, STATUS_TTL } from './source.js'

// 观测台列表：拉三份数据（状态页 / 心跳 / socket 观测项）→ 交给 payload.ts 拼 → 本地缓存 5 秒。
// 纯拼装在 payload.ts，网络与缓存分层在 source.ts，这里只做编排。
export { BEAT_WINDOW }
const CACHE_MS = 5000 // 前端 30s 轮询，这里合并并发请求

// 心跳四态、Kuma 时间串转换、beat 映射都在 beat.ts（纯函数，可单测）；这里再导出，老的调用点不用改。
export { mapBeat, toIso, toneChar }
export type { RawBeat }
export { KUMA_BASE, KUMA_SLUG, STATUS_TTL }
export { getStatusPage }
export type { Group, HeartbeatData, Monitor, Payload, RawMonitor, StatusPageData } from './payload.js'

async function collect(force = false): Promise<Payload> {
  // 状态页接口**不返回 active**，而列表要显示「已暂停」，所以额外拉一次 socket 的观测项列表。
  // 拿不到（Kuma 的 socket 没起来）就退回 active=true，不至于整页打不开。
  const [statusPage, heartbeats, beans] = await Promise.all([
    getStatusPage(force),
    getHeartbeats(),
    listMonitors().catch(() => null as Record<string, any> | null),
  ])
  return buildPayload({
    statusPage,
    heartbeats,
    beans,
    links: loadLinks(),
    base: KUMA_BASE,
    slug: KUMA_SLUG,
    beatWindow: BEAT_WINDOW,
  })
}

let cache: { at: number; data: Payload } | null = null

/** 列表数据：5 秒内的重复请求直接命中本地缓存；fresh=1 跳过缓存。 */
export async function collectCached(force = false): Promise<Payload> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.data
  const data = await collect(force)
  cache = { at: Date.now(), data }
  return data
}

/** 上一次成功抓到的列表数据（Kuma 挂了时用来退回旧值）。 */
export function lastPayload(): Payload | null {
  return cache?.data ?? null
}

/** 写完之后清掉所有本地缓存，并让接下来 15 秒的状态页请求绕开 Kuma 的 apicache。 */
export function invalidate() {
  cache = null
  invalidateSource()
}

/** 观测项属于哪个分组（按状态页里的分组结构找；找不到返回空串）。 */
export function groupOf(id: number): string {
  return groupNameIn(lastStatusPage()?.publicGroupList, id)
}
