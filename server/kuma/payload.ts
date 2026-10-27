import { t } from '../i18n.js'
import { pickLink, type LinkRule } from './links.js'
import { toIso, toneChar, type RawBeat } from './beat.js'
import type { QuickLink } from './quick.js'

// 观测台列表的**纯拼装层**：把「状态页 + 心跳 + socket 观测项 + 跳转表」拼成前端要的 Payload。
// 这里不碰网络、不碰缓存，输入全是普通对象，所以能直接单测（tests/unit/kuma-payload.test.mts）。

export type RawMonitor = { id: number; name: string; type?: string; description?: string; showMsg?: boolean }
export type RawGroup = { id: number; name: string; monitorList?: RawMonitor[] }

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
  /** 这一项钉死的出站模式（Kuma 的 outbound_mode 列，task 12 起的字段；卡片徽标要用）。 */
  outboundMode: 'follow' | 'direct' | 'proxy'
  uptime24: number | null
  beats: number[]
  /** 与 beats 一一对应：该拍的四态字符，非四态监视器为 null。 */
  beatTones: (string | null)[]
  /** 与 beats 一一对应：该拍的时间（ISO）；卡片色条悬停提示用，缺失为 null。 */
  beatTimes: (string | null)[]
  /** 与 beats 一一对应：该拍的心跳消息（超长截断）；悬停提示用，没有就是空串。 */
  beatMsgs: string[]
  /** 与 beats 一一对应：该拍的响应毫秒；悬停提示用，没有就 null。 */
  beatPings: (number | null)[]
  downCount: number
  lastDown: string | null
  link: { url: string; label: string } | null
}

export type Group = { id: number; name: string; monitors: Monitor[] }

export type Payload = {
  kuma: { base: string; slug: string; title: string }
  updatedAt: string
  summary: { total: number; up: number; down: number; pending: number; uptime24: number | null }
  groups: Group[]
  /** 快捷入口卡（quick-links.json）：只是外链，不进 summary、不进分组筛选。 */
  quick: QuickLink[]
}

export type StatusPageData = { config?: { title?: string }; publicGroupList?: RawGroup[] }
export type HeartbeatData = { heartbeatList?: Record<string, RawBeat[]>; uptimeList?: Record<string, number> }

export type BuildInput = {
  statusPage: StatusPageData
  heartbeats: HeartbeatData
  /** socket 回来的观测项（Kuma 的 id → bean）；拿不到就给 null，退回 active=true / 60 秒。 */
  beans: Record<string, any> | null
  links: LinkRule[]
  base: string
  slug: string
  /** 心跳条显示最近多少次；routes 的详情接口也用同一个值切片。 */
  beatWindow?: number
  /** 便于固定输出（测试用），默认当前时间。 */
  now?: string
  /** 快捷入口卡；不给就当没有（老的调用点与单测不用改）。 */
  quick?: QuickLink[]
}

/** 出站模式三态归一：拿不到 bean / 老版本没有这一列 / 脏值，一律 follow（= 听全局） */
function pinOf(raw: unknown): 'follow' | 'direct' | 'proxy' {
  return raw === 'direct' || raw === 'proxy' ? raw : 'follow'
}

export const BEAT_WINDOW = 40

/** 色条悬停提示里的消息上限：Kuma 实测最长 203 字，留一倍余量，再长就截断加省略号。 */
export const BEAT_MSG_MAX = 400

function clipMsg(m?: string | null): string {
  const s = String(m || '').trim()
  return s.length > BEAT_MSG_MAX ? s.slice(0, BEAT_MSG_MAX) + '…' : s
}

export function buildPayload(input: BuildInput): Payload {
  const window = input.beatWindow ?? BEAT_WINDOW
  const hb: Record<string, RawBeat[]> = input.heartbeats.heartbeatList || {}
  const uptime: Record<string, number> = input.heartbeats.uptimeList || {}
  const beans = input.beans

  const groups: Group[] = (input.statusPage.publicGroupList || []).map((g) => ({
    id: g.id,
    name: g.name,
    monitors: (g.monitorList || []).map((m) => {
      const beats = hb[String(m.id)] || []
      const last = beats.length ? beats[beats.length - 1] : undefined
      const recent = beats.slice(-window)
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
        outboundMode: pinOf(bean?.outboundMode),
        uptime24: typeof pct === 'number' ? pct : null,
        beats: recent.map((b) => (typeof b.status === 'number' ? b.status : -1)),
        beatTones: recent.map((b) => toneChar(b.msg)),
        beatTimes: recent.map((b) => toIso(b.time)),
        beatMsgs: recent.map((b) => clipMsg(b.msg)),
        beatPings: recent.map((b) => (typeof b.ping === 'number' ? b.ping : null)),
        downCount: recent.filter((b) => b.status === 0).length,
        lastDown: toIso(downBeat?.time),
        link: pickLink(input.links, m),
      }
    }),
  }))

  const all = groups.reduce<Monitor[]>((acc, g) => acc.concat(g.monitors), [])
  const rated = all.filter((m) => m.uptime24 !== null)
  return {
    kuma: { base: input.base, slug: input.slug, title: String(input.statusPage.config?.title || t('观测台')) },
    updatedAt: input.now ?? new Date().toISOString(),
    summary: {
      total: all.length,
      up: all.filter((m) => m.status === 1).length,
      down: all.filter((m) => m.status === 0).length,
      pending: all.filter((m) => m.status === 2).length,
      uptime24: rated.length ? rated.reduce((s, m) => s + (m.uptime24 as number), 0) / rated.length : null,
    },
    groups,
    quick: input.quick ?? [],
  }
}

/** 观测项属于哪个分组（按状态页里的分组结构找；找不到返回空串）。 */
export function groupNameIn(groups: RawGroup[] | undefined, id: number): string {
  for (const g of groups || []) {
    if ((g.monitorList || []).some((m) => m.id === id)) return g.name
  }
  return ''
}
