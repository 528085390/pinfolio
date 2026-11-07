import { t } from '../i18n.js'
import { loadLinks, pickLink, type LinkRule } from './links.js'
import { loadQuick, type QuickLink } from './quick.js'
import type { MonitorStore } from './store.js'
import type { HeartbeatRow, MonitorRow } from './types.js'
import { pinOf } from './redact.js'

export const BEAT_WINDOW = 40
export const BEAT_MSG_MAX = 400

const TONE_RE = /^\s*\[(绿|黄|红|灰)\]/

export function toneChar(m?: string | null): string | null {
  const hit = TONE_RE.exec(m || '')
  return hit ? hit[1] : null
}

export function toIso(s?: string | null): string | null {
  if (!s) return null
  if (s.endsWith('Z')) return s
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(s)
  if (!m) {
    const d = new Date(s)
    return isNaN(d.getTime()) ? null : d.toISOString()
  }
  const ms = Number((m[7] || '0').padEnd(3, '0'))
  const d = new Date(
    Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6]),
      ms
    )
  )
  return isNaN(d.getTime()) ? null : d.toISOString()
}

export function clipMsg(m?: string | null): string {
  const s = String(m || '').trim()
  return s.length > BEAT_MSG_MAX ? s.slice(0, BEAT_MSG_MAX) + '…' : s
}

export function mapBeat(b: {
  status?: number | null
  time?: string | null
  msg?: string | null
  ping?: number | null
}) {
  return {
    status: typeof b.status === 'number' ? b.status : null,
    time: toIso(b.time),
    msg: String(b.msg || '').trim(),
    ping: typeof b.ping === 'number' ? b.ping : null,
    tone: toneChar(b.msg),
  }
}

export type Monitor = {
  id: number
  name: string
  type: string
  group: string
  status: number | null
  time: string | null
  ping: number | null
  msg: string
  description: string
  showMsg: boolean
  active: boolean
  interval: number
  outboundMode: 'follow' | 'direct' | 'proxy'
  uptime24: number | null
  beats: number[]
  beatTones: (string | null)[]
  beatTimes: (string | null)[]
  beatMsgs: string[]
  beatPings: (number | null)[]
  downCount: number
  lastDown: string | null
  link: { url: string; label: string } | null
}

export type Group = { id: number; name: string; monitors: Monitor[] }

export type MonitorsPayload = {
  kuma: { base: string; slug: string; title: string }
  updatedAt: string
  summary: {
    total: number
    up: number
    down: number
    pending: number
    uptime24: number | null
  }
  groups: Group[]
  quick: QuickLink[]
  stale?: boolean
  error?: string
}

export function buildMonitorsPayload(
  store: MonitorStore,
  options: {
    base?: string
    slug?: string
    title?: string
    now?: string
    quick?: QuickLink[]
    links?: LinkRule[]
  } = {}
): MonitorsPayload {
  const allMonitors = store.getAllMonitors()
  const links = options.links ?? loadLinks()
  const quick = options.quick ?? loadQuick()

  // Calculate 24h uptime per monitor
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const uptimeMap = new Map<number, number>()
  try {
    const db = (store as any).db
    if (db?.prepare) {
      const rows = db
        .prepare(
          `SELECT monitor_id,
                  COUNT(*) as total,
                  SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as up_count
           FROM heartbeats
           WHERE time >= ?
           GROUP BY monitor_id`
        )
        .all(cutoff) as Array<{ monitor_id: number; total: number; up_count: number }>
      for (const r of rows) {
        if (r.total > 0) {
          uptimeMap.set(r.monitor_id, r.up_count / r.total)
        }
      }
    }
  } catch {
    // fallback if query fails
  }

  // Group monitors by group_name
  const grouped = new Map<string, MonitorRow[]>()
  for (const m of allMonitors) {
    const g = (m.group_name || '').trim() || t('未分组')
    if (!grouped.has(g)) grouped.set(g, [])
    grouped.get(g)!.push(m)
  }

  const sortedGroupNames = [...grouped.keys()].sort((a, b) => {
    if (a === '本机') return -1
    if (b === '本机') return 1
    return a.localeCompare(b, 'zh-CN')
  })

  let groupIdx = 1
  const groups: Group[] = sortedGroupNames.map((groupName) => {
    const list = grouped.get(groupName) || []
    return {
      id: groupIdx++,
      name: groupName,
      monitors: list.map((m) => {
        const rawBeatsDesc = store.getRecentHeartbeats(m.id, BEAT_WINDOW)
        const recent = [...rawBeatsDesc].reverse()
        const last = rawBeatsDesc[0] as HeartbeatRow | undefined
        const downBeat = [...recent].reverse().find((b) => b.status === 0)
        const pct = uptimeMap.has(m.id)
          ? uptimeMap.get(m.id)!
          : recent.length > 0
            ? recent.filter((b) => b.status === 1).length / recent.length
            : null

        return {
          id: m.id,
          name: m.name,
          type: m.type || 'http',
          group: groupName,
          status: typeof last?.status === 'number' ? last.status : null,
          time: toIso(last?.time),
          ping: typeof last?.ping === 'number' ? last.ping : null,
          msg: String(last?.msg || '').trim(),
          description: String(m.description || '').trim(),
          showMsg: Boolean((m as any).showMsg || (m as any).show_msg),
          active: Boolean(m.active),
          interval: Number(m.interval) > 0 ? Number(m.interval) : 60,
          outboundMode: pinOf(m.outbound_mode),
          uptime24: typeof pct === 'number' ? pct : null,
          beats: recent.map((b) => (typeof b.status === 'number' ? b.status : -1)),
          beatTones: recent.map((b) => toneChar(b.msg)),
          beatTimes: recent.map((b) => toIso(b.time)),
          beatMsgs: recent.map((b) => clipMsg(b.msg)),
          beatPings: recent.map((b) => (typeof b.ping === 'number' ? b.ping : null)),
          downCount: recent.filter((b) => b.status === 0).length,
          lastDown: toIso(downBeat?.time),
          link: pickLink(links, m),
        }
      }),
    }
  })

  const all = groups.reduce<Monitor[]>((acc, g) => acc.concat(g.monitors), [])
  const rated = all.filter((m) => m.uptime24 !== null)

  return {
    kuma: {
      base: options.base ?? 'http://127.0.0.1:7788',
      slug: options.slug ?? 'obs',
      title: options.title ?? t('观测台'),
    },
    updatedAt: options.now ?? new Date().toISOString(),
    summary: {
      total: all.length,
      up: all.filter((m) => m.status === 1).length,
      down: all.filter((m) => m.status === 0).length,
      pending: all.filter((m) => m.status === 2).length,
      uptime24: rated.length
        ? rated.reduce((s, m) => s + (m.uptime24 as number), 0) / rated.length
        : null,
    },
    groups,
    quick,
  }
}
