import { listMonitors } from './client.js'
import { loadLinks, pickLink } from './links.js'
import { mapBeat, toIso, toneChar, type RawBeat } from './beat.js'

// 观测台数据源：把本机 Uptime Kuma 的「公开状态页」接口收敛成一份给前端卡片用的结构。
// Kuma 只当探测后端，页面在 pinboard 里（见 web/pages/MonitorsPage.tsx）。
//   KUMA_URL  Kuma 地址，默认 http://127.0.0.1:3001
//   KUMA_SLUG 状态页 slug，默认 obs
export const KUMA_BASE = (process.env.KUMA_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '')
export const KUMA_SLUG = process.env.KUMA_SLUG || 'obs'

export const BEAT_WINDOW = 40 // 卡片上心跳条显示最近多少次（Kuma 每次探测 60s）
const CACHE_MS = 5000 // 前端 30s 轮询，这里合并并发请求

// Kuma 的 /api/status-page/:slug 偶尔要 5–30 秒才回（它内部按 5 分钟缓存，缓存过期那一刻
// 正好赶上 12 个探测在跑就会很慢），而心跳接口只要几十毫秒。所以两半分开缓存：
// 状态页 5 分钟（探测项配置几乎不变，慢了就沿用旧值），心跳按需现取。
export const STATUS_TTL = 5 * 60 * 1000
const STATUS_TIMEOUT = 25000
const BEAT_TTL = 5000
const BEAT_TIMEOUT = 15000

// 心跳四态、Kuma 时间串转换、beat 映射都在 beat.ts（纯函数，可单测）；这里再导出，老的调用点不用改。
export { mapBeat, toIso, toneChar }
export type { RawBeat }

export type RawMonitor = { id: number; name: string; type?: string; description?: string; showMsg?: boolean }
type RawGroup = { id: number; name: string; monitorList?: RawMonitor[] }

export type Monitor = {
  id: number
  name: string
  type: string
  group: string
  status: number | null
  time: string | null
  ping: number | null
  msg: string
  /** 观测项的固定说明（Kuma monitor.description），卡片名悬停可见；空串表示没配。 */
  description: string
  /** 是否把最近一次心跳消息常显成「本次观测情况」一行（Kuma show_msg）。 */
  showMsg: boolean
  /** Kuma 里是不是启用状态（状态页接口不返回它，靠 socket 的观测项列表补）。 */
  active: boolean
  /** 基础检查间隔（秒）；有 policy 时真实频率可能被策略改写。 */
  interval: number
  uptime24: number | null
  beats: number[]
  /** 与 beats 一一对应：该拍的四态字符，非四态监视器为 null。 */
  beatTones: (string | null)[]
  downCount: number
  lastDown: string | null
  link: { url: string; label: string } | null
}

type Group = { id: number; name: string; monitors: Monitor[] }

export type Payload = {
  kuma: { base: string; slug: string; title: string }
  updatedAt: string
  summary: { total: number; up: number; down: number; pending: number; uptime24: number | null }
  groups: Group[]
}

async function getJson<T>(path: string, timeoutMs: number, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(KUMA_BASE + path, { signal: AbortSignal.timeout(timeoutMs), headers })
  if (!res.ok) throw new Error(path + ' -> HTTP ' + res.status)
  return (await res.json()) as T
}

type StatusPageData = { config?: { title?: string }; publicGroupList?: RawGroup[] }
type HeartbeatData = { heartbeatList?: Record<string, RawBeat[]>; uptimeList?: Record<string, number> }

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

async function getHeartbeats(): Promise<HeartbeatData> {
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

async function collect(force = false): Promise<Payload> {
  // 状态页接口**不返回 active**，而列表要显示「已暂停」，所以额外拉一次 socket 的观测项列表。
  // 拿不到（Kuma 的 socket 没起来）就退回 active=true，不至于整页打不开。
  const [statusPage, heartbeats, beans] = await Promise.all([
    getStatusPage(force),
    getHeartbeats(),
    listMonitors().catch(() => null as Record<string, any> | null),
  ])
  const hb: Record<string, RawBeat[]> = heartbeats.heartbeatList || {}
  const uptime: Record<string, number> = heartbeats.uptimeList || {}
  const links = loadLinks()

  const groups: Group[] = (statusPage.publicGroupList || []).map((g) => ({
    id: g.id,
    name: g.name,
    monitors: (g.monitorList || []).map((m) => {
      const beats = hb[String(m.id)] || []
      const last = beats.length ? beats[beats.length - 1] : undefined
      const recent = beats.slice(-BEAT_WINDOW)
      const downBeat = [...beats].reverse().find((b) => b.status === 0)
      const pct = uptime[String(m.id) + '_24']
      const bean = beans ? beans[String(m.id)] : undefined
      return {
        id: m.id,
        name: m.name,
        type: m.type || 'http',
        group: g.name,
        status: typeof last?.status === 'number' ? last.status : null,
        time: toIso(last?.time),
        ping: typeof last?.ping === 'number' ? last.ping : null,
        msg: String(last?.msg || '').trim(),
        description: String(m.description || '').trim(),
        showMsg: m.showMsg === true,
        active: bean ? bean.active === 1 || bean.active === true : true,
        interval: bean && Number(bean.interval) > 0 ? Number(bean.interval) : 60,
        uptime24: typeof pct === 'number' ? pct : null,
        beats: recent.map((b) => (typeof b.status === 'number' ? b.status : -1)),
        beatTones: recent.map((b) => toneChar(b.msg)),
        downCount: recent.filter((b) => b.status === 0).length,
        lastDown: toIso(downBeat?.time),
        link: pickLink(links, m),
      }
    }),
  }))

  const all = groups.reduce<Monitor[]>((acc, g) => acc.concat(g.monitors), [])
  const rated = all.filter((m) => m.uptime24 !== null)
  return {
    kuma: { base: KUMA_BASE, slug: KUMA_SLUG, title: String(statusPage.config?.title || '观测台') },
    updatedAt: new Date().toISOString(),
    summary: {
      total: all.length,
      up: all.filter((m) => m.status === 1).length,
      down: all.filter((m) => m.status === 0).length,
      pending: all.filter((m) => m.status === 2).length,
      uptime24: rated.length ? rated.reduce((s, m) => s + (m.uptime24 as number), 0) / rated.length : null,
    },
    groups,
  }
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
  statusCache = null
  beatCache = null
  statusBypassUntil = Date.now() + 15000
}

/** 观测项属于哪个分组（按状态页里的分组结构找；找不到返回空串）。 */
export function groupOf(id: number): string {
  for (const g of statusCache?.data.publicGroupList || []) {
    if ((g.monitorList || []).some((m) => m.id === id)) return g.name
  }
  return ''
}

// 启动时先热一次状态页，并每 5 分钟续一次：用户打开页面时永远命中缓存，不会撞上 Kuma 的慢查询。
void getStatusPage().catch(() => {})
const warmTimer = setInterval(() => {
  void getStatusPage(true).catch(() => {})
}, STATUS_TTL)
;(warmTimer as any).unref?.()
