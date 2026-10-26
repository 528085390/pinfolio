import type { Monitor } from '../../lib/api'
import { t } from '../../lib/i18n'

// Kuma 心跳状态码：0 DOWN / 1 UP / 2 PENDING / 3 MAINTENANCE
// label 用 getter：调用方照旧写 `STATUS[n].label`，取值时才知道当前语言
export const STATUS: Record<number, { label: string; color: string }> = {
  0: { get label() { return t('故障') }, color: 'var(--danger)' },
  1: { get label() { return t('正常') }, color: 'var(--ok)' },
  2: { get label() { return t('待定') }, color: 'var(--warn)' },
  3: { get label() { return t('维护') }, color: 'var(--muted)' },
}

// 每日打卡按天心跳：Kuma 只有 up/down，四态靠心跳消息前缀承载，前端据此取色
// 键是消息里的中文前缀（数据，不是界面文案），写成 \u 转义，免得被 i18n 巡检当成待翻译
export const TONE: Record<string, { label: string; color: string }> = {
  '\u7eff': { get label() { return t('成功') }, color: 'var(--ok)' }, // 绿
  '\u9ec4': { get label() { return t('部分成功') }, color: 'var(--warn)' }, // 黄
  '\u7ea2': { get label() { return t('失败') }, color: 'var(--danger)' }, // 红
  '\u7070': { get label() { return t('未运行') }, color: 'var(--muted)' }, // 灰
}

/** 心跳消息里的四态前缀，和后端 `server/kuma/beat.ts` 的 TONE_RE 保持一致（\u 转义同上） */
export const TONE_RE = /^\[([\u7eff\u9ec4\u7ea2\u7070])\]/

/** 先看消息前缀（四态），没有再看 Kuma 状态码；两者都没有 = 无数据 */
export function tone(m: Pick<Monitor, 'msg' | 'status'>): { label: string; color: string } | null {
  const hit = m.msg ? TONE_RE.exec(m.msg) : null
  if (hit) return TONE[hit[1]] || null
  return m.status === null ? null : STATUS[m.status] || null
}

export const TYPE_LABEL: Record<string, string> = {
  http: 'HTTP', ssh: 'SSH', port: 'TCP', ping: 'Ping', dns: 'DNS',
  get keyword() { return t('关键词') }, grpc: 'gRPC',
}

export function typeLabel(type: string): string {
  return TYPE_LABEL[type] || type
}

/** 可用率：null 显示破折号，99.95% 以上不留小数（否则满屏都是 99.9%） */
export function pct(v: number | null): string {
  if (v === null) return '—'
  return (v * 100).toFixed(v >= 0.9995 ? 0 : 1) + '%'
}
