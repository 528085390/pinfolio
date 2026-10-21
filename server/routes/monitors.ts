import { Hono } from 'hono'
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  deleteMonitor, editMonitor, getBeats, getMonitor, listMonitors, pauseMonitor, resumeMonitor, toView,
} from '../kuma.js'
import { resolveAction, runRecipe } from '../monitor-actions.js'

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

// Kuma 项目目录：改完观测项要重生成它的 SNAPSHOT.md，删除前要备份它的库。
//   KUMA_DIR  默认 <pinboard 的上一级>/kuma（两个项目在同一工作区里并列）
const KUMA_DIR = process.env.KUMA_DIR || resolve(process.cwd(), '..', 'kuma')
const KUMA_DB = join(KUMA_DIR, 'data', 'kuma.db')
const KUMA_BACKUP_DIR = join(KUMA_DIR, 'backups')
const KUMA_BACKUP_KEEP = 5

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

/**
 * 按 id 优先匹配：观测项可以在抽屉里改名，名字不再是稳定键（改名后按名字配的规则会失配）。
 * name 规则保留作兜底，给「按名字写更顺手」的临时配置用。
 */
function pickLink(rules: LinkRule[], m: RawMonitor): { url: string; label: string } | null {
  const hit = rules.find((r) => typeof r.id === 'number' && r.id === m.id)
    || rules.find((r) => r.name && r.name === m.name)
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

async function getStatusPage(force = false): Promise<StatusPageData> {
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

/* ---------------- 单个观测项：详情 / 改名 / 暂停 / 删除 / 立即观测 ---------------- */

function groupOf(id: number): string {
  for (const g of statusCache?.data.publicGroupList || []) {
    if ((g.monitorList || []).some((m) => m.id === id)) return g.name
  }
  return ''
}

function mapBeat(b: RawBeat) {
  return {
    status: typeof b.status === 'number' ? b.status : null,
    time: toIso(b.time),
    msg: String(b.msg || '').trim(),
    ping: typeof b.ping === 'number' ? b.ping : null,
    tone: toneChar(b.msg),
  }
}

monitorsRoute.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: '观测项 id 不合法' }, 400)
  try {
    // 顺手拿一份 id → 名字的表：策略里的门控可能按 id 引用别的观测项，摘要里显示名字比 #3 好读
    const beans = await listMonitors().catch(() => null as Record<string, any> | null)
    const names: Record<string, string> = {}
    if (beans) for (const k of Object.keys(beans)) names[k] = String(beans[k]?.name || '')

    const [bean, rawBeats] = await Promise.all([getMonitor(id), getBeats(id, 24)])
    const beats = rawBeats.slice(-BEAT_WINDOW).map(mapBeat)
    const monitor = toView(bean, names)
    return c.json({
      monitor: { ...monitor, group: groupOf(id) },
      latest: beats.length ? beats[beats.length - 1] : null,
      beats,
      action: resolveAction({ id: monitor.id, name: monitor.name, type: monitor.type }),
      link: pickLink(loadLinks(), { id: monitor.id, name: monitor.name }),
    })
  } catch (e: any) {
    // Kuma 的 getMonitor 对不存在的 id 不返回 ok:false，而是抛 TypeError（reading 'id'），
    // 统一交给 kumaErrorStatus 把这种消息也判成 404，否则前端看到的是 502。
    return c.json({ error: String(e?.message || e) }, kumaErrorStatus(e))
  }
})

/* ---------------- 写操作：改名 / 介绍 / 频率 / 暂停 / 恢复 / 删除 ---------------- */

/** 写完之后清掉所有本地缓存，并让接下来 15 秒的状态页请求绕开 Kuma 的 apicache。 */
function invalidate() {
  cache = null
  statusCache = null
  beatCache = null
  statusBypassUntil = Date.now() + 15000
}

/** 改完观测项要重生成 kuma/SNAPSHOT.md（防抖 1.5 秒：连着保存只写一次）。 */
let snapshotTimer: ReturnType<typeof setTimeout> | null = null
function refreshSnapshot() {
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
function backupDb(): string | null {
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

/** 写接口只收 application/json：跨站表单只能发 text/plain，这样能挡掉 CSRF。 */
function isJsonRequest(c: any): boolean {
  return String(c.req.header('content-type') || '').toLowerCase().includes('application/json')
}

/** 收集所有策略里「按名字」引用观测项的地方（policy_json 的 monitorStatus.name）。 */
function policyNameRefs(beans: Record<string, any>): Map<string, number[]> {
  const out = new Map<string, number[]>()
  const walk = (v: any, hit: (name: string) => void) => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x, hit)
      return
    }
    if (!v || typeof v !== 'object') return
    const ms = (v as any).monitorStatus
    if (ms && typeof ms === 'object' && typeof ms.name === 'string') hit(ms.name)
    for (const k of Object.keys(v)) walk((v as any)[k], hit)
  }
  for (const key of Object.keys(beans)) {
    const raw = beans[key]?.policyJson ?? beans[key]?.policy_json
    if (!raw) continue
    let parsed: any = raw
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed) } catch { continue }
    }
    walk(parsed, (name) => {
      const list = out.get(name) || []
      list.push(Number(beans[key]?.id || key))
      out.set(name, list)
    })
  }
  return out
}

function asInt(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : null
}

function kumaErrorStatus(e: any): 404 | 502 {
  const msg = String(e?.message || '')
  if (e?.code === 'notfound' || /not found|Cannot read properties of null/i.test(msg)) return 404
  return 502
}

monitorsRoute.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: '观测项 id 不合法' }, 400)
  if (!isJsonRequest(c)) return c.json({ error: '写操作必须用 application/json' }, 415)
  let body: Record<string, unknown>
  try {
    body = (await c.req.json()) as Record<string, unknown>
  } catch {
    return c.json({ error: '请求体不是合法 JSON' }, 400)
  }
  if (!body || typeof body !== 'object') return c.json({ error: '请求体不是合法 JSON' }, 400)

  try {
    const bean = await getMonitor(id)
    const beans = await listMonitors().catch(() => ({}) as Record<string, any>)
    const next: any = { ...bean }

    // ---- 名字 ----
    if (body.name !== undefined) {
      const name = String(body.name ?? '').trim()
      if (!name) return c.json({ error: '名字不能为空' }, 400)
      if (name.length > 120) return c.json({ error: '名字最长 120 字' }, 400)
      if (name !== String(bean.name || '').trim()) {
        const dup = Object.values(beans).find((b: any) => Number(b?.id) !== id && String(b?.name || '').trim() === name)
        if (dup) return c.json({ error: '已经有同名观测项：' + name }, 400)
        const refs = policyNameRefs(beans).get(String(bean.name || '').trim())
        if (refs && refs.length) {
          return c.json({
            error: '有策略按名字引用了「' + String(bean.name) + '」（观测项 #' + refs.join('、#')
              + '），改名会让策略失效。请先把那些策略改成按 id 引用或改掉名字。',
          }, 409)
        }
      }
      next.name = name
    }

    // ---- 介绍 ----
    if (body.description !== undefined) {
      const desc = String(body.description ?? '').trim()
      if (desc.length > 500) return c.json({ error: '介绍最长 500 字' }, 400)
      next.description = desc
    }

    // ---- 频率 / 超时 / 重试 ----
    if (body.interval !== undefined) {
      const v = asInt(body.interval)
      if (v === null || v < 20 || v > 86400) return c.json({ error: '检查频率要在 20–86400 秒之间' }, 400)
      next.interval = v
    }
    if (body.timeout !== undefined) {
      const v = asInt(body.timeout)
      if (v === null || v < 1 || v > 120) return c.json({ error: '超时要在 1–120 秒之间' }, 400)
      next.timeout = v
    }
    if (body.retryInterval !== undefined) {
      const v = asInt(body.retryInterval)
      if (v === null || v < 1 || v > 3600) return c.json({ error: '重试间隔要在 1–3600 秒之间' }, 400)
      next.retryInterval = v
    }
    if (body.maxretries !== undefined) {
      const v = asInt(body.maxretries)
      if (v === null || v < 0 || v > 10) return c.json({ error: '重试次数要在 0–10 之间' }, 400)
      next.maxretries = v
    }
    if (Number(next.timeout) >= Number(next.interval)) {
      return c.json({ error: '超时（' + next.timeout + 's）必须小于检查频率（' + next.interval + 's）' }, 400)
    }
    if (body.showMsg !== undefined) next.showMsg = body.showMsg === true || body.showMsg === 1

    // Kuma 的 toJSON 不返回 showMsg，而 editMonitor 是全量覆盖：
    // 不显式补上，Boolean(undefined) 会把 show_msg 静默改成 false。
    if (next.showMsg === undefined) {
      const page = await getStatusPage(false).catch(() => null)
      let hit: any = null
      for (const g of page?.publicGroupList || []) {
        hit = (g.monitorList || []).find((m: any) => Number(m.id) === id) || hit
      }
      next.showMsg = hit ? hit.showMsg === true : false
    }

    // ---- 归一化：editMonitor 会把这些原样 JSON.stringify 写库 ----
    next.accepted_statuscodes = Array.isArray(next.accepted_statuscodes) && next.accepted_statuscodes.length
      ? next.accepted_statuscodes.map((s: any) => String(s))
      : ['200-299']
    next.conditions = Array.isArray(next.conditions) ? next.conditions : []
    const pol = next.policyJson ?? next.policy_json
    if (pol === undefined || pol === null || pol === '') next.policyJson = null
    else if (typeof pol === 'object') next.policyJson = JSON.stringify(pol)
    else next.policyJson = String(pol)

    await editMonitor(next)
    invalidate()
    refreshSnapshot()

    const names: Record<string, string> = {}
    for (const k of Object.keys(beans)) names[k] = String(beans[k]?.name || '')
    if (names[String(id)]) names[String(id)] = String(next.name || '')
    return c.json({ ok: true, monitor: { ...toView(next, names), group: groupOf(id) } })
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, kumaErrorStatus(e))
  }
})

monitorsRoute.post('/:id/pause', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: '观测项 id 不合法' }, 400)
  if (!isJsonRequest(c)) return c.json({ error: '写操作必须用 application/json' }, 415)
  try {
    await getMonitor(id) // 先确认存在，避免把不存在的 id 当成功
    await pauseMonitor(id)
    invalidate()
    refreshSnapshot()
    return c.json({ ok: true, active: false })
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, kumaErrorStatus(e))
  }
})

monitorsRoute.post('/:id/resume', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: '观测项 id 不合法' }, 400)
  if (!isJsonRequest(c)) return c.json({ error: '写操作必须用 application/json' }, 415)
  try {
    await getMonitor(id)
    await resumeMonitor(id)
    invalidate()
    refreshSnapshot()
    return c.json({ ok: true, active: true })
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, kumaErrorStatus(e))
  }
})

monitorsRoute.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: '观测项 id 不合法' }, 400)
  // DELETE 是「非简单请求」，浏览器跨站表单发不出来，所以没有 body 时也允许；
  // 带了 body 就必须是 JSON。
  const ct = String(c.req.header('content-type') || '').toLowerCase()
  if (ct && !ct.includes('application/json')) return c.json({ error: '写操作必须用 application/json' }, 415)
  const confirm = String(c.req.query('confirm') || '').trim()
  try {
    const bean = await getMonitor(id)
    const name = String(bean.name || '').trim()
    if (confirm !== name) {
      return c.json({ error: '要删除必须把观测项名字原样输对（当前是「' + name + '」）' }, 400)
    }
    const backup = backupDb()
    await deleteMonitor(id)
    invalidate()
    refreshSnapshot()
    return c.json({ ok: true, backup })
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, kumaErrorStatus(e))
  }
})

/**
 * 立即观测：按配方（monitor-actions.json）逐步执行，失败即中止。
 * 一次请求跑完整套配方，逐步回显；暂停中的观测项直接拒绝——
 * 因为 kuma-check 走的 restartMonitor 会把 active 悄悄置回 1。
 */
monitorsRoute.post('/:id/check', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: '观测项 id 不合法' }, 400)
  if (!isJsonRequest(c)) return c.json({ error: '写操作必须用 application/json' }, 415)
  try {
    const bean = await getMonitor(id)
    const active = bean.active === true || bean.active === 1
    if (!active) return c.json({ error: '这个观测项已暂停，先恢复再立即观测' }, 400)

    const recipe = resolveAction({ id, name: String(bean.name || ''), type: String(bean.type || '') })
    if (recipe.disabledReason) return c.json({ error: recipe.disabledReason }, 400)

    const run = await runRecipe(id, recipe)
    invalidate()
    refreshSnapshot()

    const last = (await getBeats(id, 1).catch(() => [])).slice(-1)[0]
    return c.json({
      ok: run.ok,
      steps: run.steps,
      latest: last ? mapBeat(last) : null,
    })
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, kumaErrorStatus(e))
  }
})

// 启动时先热一次状态页，并每 5 分钟续一次：用户打开页面时永远命中缓存，不会撞上 Kuma 的慢查询。
void getStatusPage().catch(() => {})
const warmTimer = setInterval(() => {
  void getStatusPage(true).catch(() => {})
}, STATUS_TTL)
;(warmTimer as any).unref?.()
