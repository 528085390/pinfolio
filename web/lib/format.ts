import { localeTag, t } from './i18n'

/** 「刚刚 / N 分钟前 / N 小时前 / N 天前」，超过一周直接给日期 */
export function relativeTime(iso: string) {
  const ms = new Date(iso).getTime()
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60000)
  if (m < 1) return t('刚刚')
  if (m < 60) return t('{n} 分钟前', { n: m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('{n} 小时前', { n: h })
  const d = Math.floor(h / 24)
  if (d < 7) return t('{n} 天前', { n: d })
  const dt = new Date(iso)
  return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate())
}

function pad(n: number) {
  return n < 10 ? '0' + n : String(n)
}

/** 带秒的时间戳，心跳色条悬停用：同年省年份（`10-22 09:46:15`），跨年才带 `2025-` */
export function stamp(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const date = (d.getFullYear() === now.getFullYear() ? '' : d.getFullYear() + '-') + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  return date + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
}

export function fullTime(iso: string) {
  const d = new Date(iso)
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

const SYMBOL: Record<string, string> = { CNY: '¥', USD: '$', EUR: '€', JPY: '¥', GBP: '£', HKD: 'HK$' }

export function money(price: number | null | undefined, currency: string) {
  if (price === null || price === undefined) return ''
  const sym = SYMBOL[currency] || currency + ' '
  const n = Number(price)
  return sym + (Number.isInteger(n) ? n.toLocaleString(localeTag()) : n.toFixed(2))
}

export function daysBetween(dateStr: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return null
  return Math.round((d.getTime() - today.getTime()) / 86400000)
}

export function expiry(dateStr: string | null) {
  if (!dateStr) return null
  const days = daysBetween(dateStr)
  if (days === null) return null
  if (days < 0) return { text: t('已过期 {n} 天', { n: Math.abs(days) }), tone: 'bad' as const, days }
  if (days === 0) return { text: t('今天到期'), tone: 'bad' as const, days }
  if (days <= 30) return { text: t('{n} 天后到期', { n: days }), tone: 'warn' as const, days }
  return { text: t('还剩 {n} 天', { n: days }), tone: 'ok' as const, days }
}

// label 用 getter：调用方照旧写 `KIND_META[k].label`，取值时才知道当前语言，
// 不用把 t() 散到十来个消费点上（模块加载期就把翻译冻住是这里最容易踩的坑）。
export const KIND_META: Record<string, { label: string }> = {
  device: { get label() { return t('设备') } },
  server: { get label() { return t('服务器') } },
  account: { get label() { return t('账号') } },
  domain: { get label() { return t('域名') } },
  other: { get label() { return t('其他') } },
}

export const STATUS_META: Record<string, { label: string; color: string }> = {
  active: { get label() { return t('在用') }, color: '#15803d' },
  idle: { get label() { return t('闲置') }, color: '#a16207' },
  retired: { get label() { return t('退役') }, color: '#78716c' },
  lost: { get label() { return t('丢失') }, color: '#b42318' },
}

export const KINDS = ['device', 'server', 'account', 'domain', 'other']
