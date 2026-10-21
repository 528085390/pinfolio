import type { Monitor } from '../../lib/api'

// Kuma 心跳状态码：0 DOWN / 1 UP / 2 PENDING / 3 MAINTENANCE
export const STATUS: Record<number, { label: string; color: string }> = {
  0: { label: '故障', color: 'var(--danger)' },
  1: { label: '正常', color: 'var(--ok)' },
  2: { label: '待定', color: 'var(--warn)' },
  3: { label: '维护', color: 'var(--muted)' },
}

// 每日打卡按天心跳：Kuma 只有 up/down，四态靠心跳消息前缀承载，前端据此取色
export const TONE: Record<string, { label: string; color: string }> = {
  绿: { label: '成功', color: 'var(--ok)' },
  黄: { label: '部分成功', color: 'var(--warn)' },
  红: { label: '失败', color: 'var(--danger)' },
  灰: { label: '未运行', color: 'var(--muted)' },
}

/** 心跳消息里的四态前缀，和后端 `server/kuma/beat.ts` 的 TONE_RE 保持一致 */
export const TONE_RE = /^\[(绿|黄|红|灰)\]/

/** 先看消息前缀（四态），没有再看 Kuma 状态码；两者都没有 = 无数据 */
export function tone(m: Pick<Monitor, 'msg' | 'status'>): { label: string; color: string } | null {
  const hit = m.msg ? TONE_RE.exec(m.msg) : null
  if (hit) return TONE[hit[1]] || null
  return m.status === null ? null : STATUS[m.status] || null
}

export const TYPE_LABEL: Record<string, string> = {
  http: 'HTTP', ssh: 'SSH', port: 'TCP', ping: 'Ping', dns: 'DNS', keyword: '关键词', grpc: 'gRPC',
}

export function typeLabel(type: string): string {
  return TYPE_LABEL[type] || type
}

/** 可用率：null 显示破折号，99.95% 以上不留小数（否则满屏都是 99.9%） */
export function pct(v: number | null): string {
  if (v === null) return '—'
  return (v * 100).toFixed(v >= 0.9995 ? 0 : 1) + '%'
}
