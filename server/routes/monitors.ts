import { Hono } from 'hono'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// 观测台数据源：把本机 Uptime Kuma 的「公开状态页」接口收敛成一份给前端卡片用的结构。
// Kuma 只当探测后端，页面在 pinboard 里（见 web/pages/MonitorsPage.tsx）。
//   KUMA_URL  Kuma 地址，默认 http://127.0.0.1:3001
//   KUMA_SLUG 状态页 slug，默认 obs
const KUMA_BASE = (process.env.KUMA_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '')
const KUMA_SLUG = process.env.KUMA_SLUG || 'obs'

// 观测项 → 项目管理页的跳转表（monitor-links.json，可随时改，不用重启）。
// 每条形如 { "name": "Kuma 里的监视器名", "url": "...", "label": "悬浮提示" }，
// name 对不上时还可以用 { "id": 6, "url": "..." }。
const LINKS_FILE = process.env.MONITOR_LINKS || join(process.cwd(), 'monitor-links.json')

type LinkRule = { name?: string; id?: number; url: string; label?: string }

function loadLinks(): LinkRule[] {
  try {
    const parsed = JSON.parse(readFileSync(LINKS_FILE, 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter((r: any) => r && typeof r.url === 'string' && r.url)
  } catch {
    return [] // 没配置就当没有管理页
  }
}

function pickLink(rules: LinkRule[], m: RawMonitor): { url: string; label: string } | null {
  const hit = rules.find((r) => r.name && r.name === m.name)
    || rules.find((r) => typeof r.id === 'number' && r.id === m.id)
  return hit ? { url: hit.url, label: hit.label || hit.url } : null
}

const BEAT_WINDOW = 40 // 卡片上心跳条显示最近多少次（Kuma 每次探测 60s）
const CACHE_MS = 5000 // 前端 30s 轮询，这里合并并发请求

// Kuma 的 /api/status-page/:slug 偶尔要 5–30 秒才回（它内部按 5 分钟缓存，缓存过期那一刻
// 正好赶上 12 个探测在跑就会很慢），而心跳接口只要几十毫秒。所以两半分开缓存：
// 状态页 5 分钟（探测项配置几乎不变，慢了就沿用旧值），心跳按需现取。
const STATUS_TTL = 5 * 60 * 1000
const STATUS_TIMEOUT = 25000
const BEAT_TTL = 5000
const BEAT_TIMEOUT = 15000

/** 四态心跳：消息前缀 `[绿|黄|红|灰]` 决定这一拍的颜色（Kuma 自身只有 up/down）。 */
const TONE_RE = /^\s*\[(绿|黄|红|灰)\]/
const toneChar = (m?: string | null): string | null => {
  const hit = TONE_RE.exec(m || '')
  return hit ? hit[1] : null
}

type RawBeat = { status?: number; time?: string; msg?: string | null; ping?: number | null }
type RawMonitor = { id: number; name: string; type?: string; description?: string; showMsg?: boolean }
type RawGroup = { id: number; name: string; monitorList?: RawMonitor[] }

type Monitor = {
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
  uptime24: number | null
  beats: number[]
  /** 与 beats 一一对应：该拍的四态字符，非四态监视器为 null。 */
  beatTones: (string | null)[]
  downCount: number
  lastDown: string | null
  link: { url: string; label: string } | null
}

type Group = { id: number; name: string; monitors: Monitor[] }

type Payload = {
  kuma: { base: string; slug: string; title: string }
  updatedAt: string
  summary: { total: number; up: number; down: number; pending: number; uptime24: number | null }
  groups: Group[]
}

// Kuma 的心跳时间是**不带时区的 UTC 串**（"2026-10-19 08:35:24.131"，
// 实测 08:43 UTC 对应本机 16:43 CST），直接丢给浏览器 new Date() 会被当本地时间解析，
// 于是「刚刚」显示成「8 小时前」。这里按 UTC 解析再转 ISO，前端才拿到真实时刻。
function toIso(s?: string | null): string | null {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(s)
  if (!m) return null
  const ms = Number((m[7] || '0').padEnd(3, '0'))
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]), ms))
  return isNaN(d.getTime()) ? null : d.toISOString()
}

async function getJson<T>(path: string, timeoutMs: number): Promise<T> {
  const res = await fetch(KUMA_BASE + path, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(path + ' -> HTTP ' + res.status)
  return (await res.json()) as T
}

type StatusPageData = { config?: { title?: string }; publicGroupList?: RawGroup[] }
type HeartbeatData = { heartbeatList?: Record<string, RawBeat[]>; uptimeList?: Record<string, number> }

let statusCache: { at: number; data: StatusPageData } | null = null
let statusInflight: Promise<StatusPageData> | null = null
let beatCache: { at: number; data: HeartbeatData } | null = null
let beatInflight: Promise<HeartbeatData> | null = null

async function getStatusPage(force = false): Promise<StatusPageData> {
  if (!force && statusCache && Date.now() - statusCache.at < STATUS_TTL) return statusCache.data
  if (statusInflight) return statusInflight
  statusInflight = (async () => {
    try {
      const data = await getJson<StatusPageData>('/api/status-page/' + encodeURIComponent(KUMA_SLUG), STATUS_TIMEOUT)
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
  const [statusPage, heartbeats] = await Promise.all([getStatusPage(force), getHeartbeats()])
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

export const monitorsRoute = new Hono()

monitorsRoute.get('/', async (c) => {
  const fresh = c.req.query('fresh') === '1'
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return c.json(cache.data)
  try {
    const data = await collect(fresh)
    cache = { at: Date.now(), data }
    return c.json(data)
  } catch (e: any) {
    // Kuma 挂了 / 没启动时，退回上一次的数据并标记 stale，比直接空屏有用
    if (cache) return c.json({ ...cache.data, stale: true, error: '读不到 Kuma：' + String(e?.message || e) })
    return c.json({ error: '读不到 Kuma 状态页（' + KUMA_BASE + '）：' + String(e?.message || e) }, 502)
  }
})

// 启动时先热一次状态页，并每 5 分钟续一次：用户打开页面时永远命中缓存，不会撞上 Kuma 的慢查询。
void getStatusPage().catch(() => {})
const warmTimer = setInterval(() => {
  void getStatusPage(true).catch(() => {})
}, STATUS_TTL)
;(warmTimer as any).unref?.()
