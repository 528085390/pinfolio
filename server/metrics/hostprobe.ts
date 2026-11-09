import type { HeartbeatRow, MonitorRow } from '../monitor/types.js'

// 主机卡片上的「探针」摘要：延迟 / 丢包 / 最近 N 拍色条。
// 数据来源是观测台的心跳（本来就在探这台机），这里只做挑选与汇总，不新开任何探测。

export type ProbeBeat = { time: string; status: number; ping: number | null; msg: string }

export type HostProbe = {
  /** 用哪个观测项算的（卡片 tooltip 会显示名字） */
  monitorId: number
  name: string
  type: string
  /** 最近一次成功探测的往返毫秒；全是 null（例如 push 型）就给 null */
  latencyMs: number | null
  /** 最近 N 拍里 DOWN 的比例（0–100）；一拍都没有给 null */
  lossPct: number | null
  /** 时间升序，前端从左到右画色条 */
  beats: ProbeBeat[]
  /** 最近一拍的时间（ISO），没有心跳给 null */
  at: string | null
}

/** 色条格子数：和观测台卡片一致，24 拍 ≈ 2 小时（1 分钟间隔）。 */
export const PROBE_BEATS = 24

/**
 * 挑选「这台机的代表观测项」：
 * TCP 443 最能代表这台机的门面延迟，其次任意端口探测，最后 HTTP。
 * SSH 型不算：它的 ping 是「连上 + 跑完 systemctl」的耗时（实测 3–5 秒），当延迟显示会误导；
 * push 型是对方主动推的，本来就没有往返概念。两类都排除，宁可这一段不显示。
 */
function weight(m: MonitorRow): number {
  if (m.type === 'port') return m.port === 443 ? 0 : 1
  if (m.type === 'http') return 2
  return 9
}

export function pickProbeMonitor(rows: MonitorRow[]): MonitorRow | null {
  const usable = rows.filter((m) => m && (m.type === 'port' || m.type === 'http'))
  if (!usable.length) return null
  // 同权重时 id 小的优先，保证每次刷新挑到同一项（否则延迟数字会来回跳）
  return usable.slice().sort((a, b) => weight(a) - weight(b) || a.id - b.id)[0]
}

/**
 * 兜底候选：观测台里「组名 / 名字」带这台机 id 的那些项。
 * 没在 data/metrics.json 里登记 monitors、也没配 host-services.json 的老主机，
 * 靠这个还能拿到延迟（命名约定见 pinboard/AGENTS.md：'<组短名> / <服务名>'）。
 */
export function matchGroupMonitors(rows: MonitorRow[], hostId: string): MonitorRow[] {
  const id = (hostId || '').trim().toLowerCase()
  if (!id) return []
  const hit = (s: string | null) => (s || '').trim().toLowerCase().startsWith(id)
  return rows.filter((m) => hit(m.group_name) || hit(m.name))
}

/** 心跳按时间倒序传进来（MonitorStore.getRecentHeartbeats 的返回顺序）。 */
export function summarizeProbe(row: MonitorRow, latestFirst: HeartbeatRow[], limit = PROBE_BEATS): HostProbe {
  const take = Math.max(0, Math.floor(limit))
  const beats = latestFirst
    .slice(0, take)
    .slice()
    .reverse()
    .map((b) => ({ time: String(b.time ?? ''), status: Number(b.status ?? 0), ping: typeof b.ping === 'number' ? b.ping : null, msg: String(b.msg ?? '') }))
  const up = beats.filter((b) => b.status === 1).length
  const down = beats.filter((b) => b.status === 0).length
  // 丢包 = DOWN 拍 / 有结论的拍（待定与维护不算进分母，否则维护窗口会把丢包刷成 100%）
  const decided = up + down
  const latency = [...beats].reverse().find((b) => b.ping !== null)?.ping ?? null
  return {
    monitorId: row.id,
    name: row.name,
    type: row.type,
    latencyMs: latency,
    lossPct: decided > 0 ? Math.round((down / decided) * 1000) / 10 : null,
    beats,
    at: beats.length ? beats[beats.length - 1].time || null : null,
  }
}
