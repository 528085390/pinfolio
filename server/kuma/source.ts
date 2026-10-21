import type { HeartbeatData, StatusPageData } from './payload.js'

// 观测台的数据来源：本机 Uptime Kuma 的公开状态页接口，外加两层缓存。
// Kuma 只当探测后端，页面在 pinboard 里（见 web/pages/MonitorsPage.tsx）。
//   KUMA_URL  Kuma 地址，默认 http://127.0.0.1:3001
//   KUMA_SLUG 状态页 slug，默认 obs
export const KUMA_BASE = (process.env.KUMA_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '')
export const KUMA_SLUG = process.env.KUMA_SLUG || 'obs'

// Kuma 的 /api/status-page/:slug 偶尔要 5–30 秒才回（它内部按 5 分钟缓存，缓存过期那一刻
// 正好赶上 12 个探测在跑就会很慢），而心跳接口只要几十毫秒。所以两半分开缓存：
// 状态页 5 分钟（探测项配置几乎不变，慢了就沿用旧值），心跳按需现取。
export const STATUS_TTL = 5 * 60 * 1000
const STATUS_TIMEOUT = 25000
const BEAT_TTL = 5000
const BEAT_TIMEOUT = 15000

async function getJson<T>(path: string, timeoutMs: number, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(KUMA_BASE + path, { signal: AbortSignal.timeout(timeoutMs), headers })
  if (!res.ok) throw new Error(path + ' -> HTTP ' + res.status)
  return (await res.json()) as T
}

// 刚写完（改名 / 暂停 / 删除）的那十几秒里，普通轮询也要绕过 Kuma 的 apicache，
// 否则页面会「改完没反应」，用户会以为没保存上。
let statusBypassUntil = 0

let statusCache: { at: number; data: StatusPageData } | null = null
let statusInflight: Promise<StatusPageData> | null = null
let beatCache: { at: number; data: HeartbeatData } | null = null
let beatInflight: Promise<HeartbeatData> | null = null

export async function getStatusPage(force = false): Promise<StatusPageData> {
  if (!force && statusCache && Date.now() - statusCache.at < STATUS_TTL) return statusCache.data
  if (statusInflight) return statusInflight
  statusInflight = (async () => {
    try {
      // 状态页在 Kuma 侧有 5 分钟 apicache；force（fresh=1）时必须带绕过头，
      // 否则刚改完名字/频率，列表还要等最多 5 分钟才变（改完立刻看不见变化）。
      const bypass = force || Date.now() < statusBypassUntil
      const data = await getJson<StatusPageData>(
        '/api/status-page/' + encodeURIComponent(KUMA_SLUG),
        STATUS_TIMEOUT,
        bypass ? { 'x-apicache-bypass': '1' } : undefined,
      )
      statusCache = { at: Date.now(), data }
      return data
    } catch (e) {
      // 慢/失败时沿用旧配置：页面最多显示「数据旧了」，不会整页变空
      if (statusCache) return statusCache.data
      throw e
    } finally {
      statusInflight = null
    }
  })()
  return statusInflight
}

export async function getHeartbeats(): Promise<HeartbeatData> {
  if (beatCache && Date.now() - beatCache.at < BEAT_TTL) return beatCache.data
  if (beatInflight) return beatInflight
  beatInflight = (async () => {
    try {
      const data = await getJson<HeartbeatData>('/api/status-page/heartbeat/' + encodeURIComponent(KUMA_SLUG), BEAT_TIMEOUT)
      beatCache = { at: Date.now(), data }
      return data
    } catch (e) {
      if (beatCache) return beatCache.data
      throw e
    } finally {
      beatInflight = null
    }
  })()
  return beatInflight
}

/** 写完之后清掉两层缓存，并让接下来 15 秒的状态页请求绕开 Kuma 的 apicache。 */
export function invalidateSource() {
  statusCache = null
  beatCache = null
  statusBypassUntil = Date.now() + 15000
}

/** 最近一次成功抓到的状态页（groupOf 要用，不触发新请求）。 */
export function lastStatusPage(): StatusPageData | null {
  return statusCache?.data ?? null
}

// 启动时先热一次状态页，并每 5 分钟续一次：用户打开页面时永远命中缓存，不会撞上 Kuma 的慢查询。
void getStatusPage().catch(() => {})
const warmTimer = setInterval(() => {
  void getStatusPage(true).catch(() => {})
}, STATUS_TTL)
;(warmTimer as any).unref?.()
