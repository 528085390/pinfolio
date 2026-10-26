import type { MonitorDetail } from '../../lib/api'
import { t } from '../../lib/i18n'

/** 详情接口里的 monitor 比列表里的多几个字段（timeout / target / policy 等）。 */
export type MonitorFull = MonitorDetail['monitor']

// Kuma 心跳状态码：0 DOWN / 1 UP / 2 PENDING / 3 MAINTENANCE
// label 用 getter：调用方照旧写 `STATUS[n].label`，取值时才知道当前语言
export const STATUS: Record<number, { label: string; color: string }> = {
  0: { get label() { return t('故障') }, color: 'var(--danger)' },
  1: { get label() { return t('正常') }, color: 'var(--ok)' },
  2: { get label() { return t('待定') }, color: 'var(--warn)' },
  3: { get label() { return t('维护') }, color: 'var(--muted)' },
}

// 键是心跳消息里的中文前缀（数据，不是界面文案），写成 \u 转义，免得被 i18n 巡检当成待翻译
export const TONE: Record<string, { label: string; color: string }> = {
  '\u7eff': { get label() { return t('成功') }, color: 'var(--ok)' }, // 绿
  '\u9ec4': { get label() { return t('部分成功') }, color: 'var(--warn)' }, // 黄
  '\u7ea2': { get label() { return t('失败') }, color: 'var(--danger)' }, // 红
  '\u7070': { get label() { return t('未运行') }, color: 'var(--muted)' }, // 灰
}

export const TYPE_LABEL: Record<string, string> = {
  http: 'HTTP', ssh: 'SSH', port: 'TCP', ping: 'Ping', dns: 'DNS',
  get keyword() { return t('关键词') }, grpc: 'gRPC',
  get push() { return t('推送') },
}

/** 抽屉顶部那颗状态点：先看心跳自带的四态 tone，再看 Kuma 状态码，都没有 = 无数据。 */
export function toneOf(latest: { tone?: string | null; status: number | null } | null) {
  if (!latest) return null
  if (latest.tone) return TONE[latest.tone] || null
  return latest.status === null ? null : (STATUS[latest.status] || null)
}
