import type { MonitorDetail } from '../../lib/api'

/** 详情接口里的 monitor 比列表里的多几个字段（timeout / target / policy 等）。 */
export type MonitorFull = MonitorDetail['monitor']

// Kuma 心跳状态码：0 DOWN / 1 UP / 2 PENDING / 3 MAINTENANCE
export const STATUS: Record<number, { label: string; color: string }> = {
  0: { label: '故障', color: 'var(--danger)' },
  1: { label: '正常', color: 'var(--ok)' },
  2: { label: '待定', color: 'var(--warn)' },
  3: { label: '维护', color: 'var(--muted)' },
}

export const TONE: Record<string, { label: string; color: string }> = {
  绿: { label: '成功', color: 'var(--ok)' },
  黄: { label: '部分成功', color: 'var(--warn)' },
  红: { label: '失败', color: 'var(--danger)' },
  灰: { label: '未运行', color: 'var(--muted)' },
}

export const TYPE_LABEL: Record<string, string> = {
  http: 'HTTP', ssh: 'SSH', port: 'TCP', ping: 'Ping', dns: 'DNS', keyword: '关键词', grpc: 'gRPC', push: '推送',
}

/** 抽屉顶部那颗状态点：先看心跳自带的四态 tone，再看 Kuma 状态码，都没有 = 无数据。 */
export function toneOf(latest: { tone?: string | null; status: number | null } | null) {
  if (!latest) return null
  if (latest.tone) return TONE[latest.tone] || null
  return latest.status === null ? null : (STATUS[latest.status] || null)
}
