export function relativeTime(iso: string) {
  const t = new Date(iso).getTime()
  const diff = Date.now() - t
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return m + ' 分钟前'
  const h = Math.floor(m / 60)
  if (h < 24) return h + ' 小时前'
  const d = Math.floor(h / 24)
  if (d < 7) return d + ' 天前'
  const dt = new Date(iso)
  return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate())
}

function pad(n: number) {
  return n < 10 ? '0' + n : String(n)
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
  return sym + (Number.isInteger(n) ? n.toLocaleString('zh-CN') : n.toFixed(2))
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
  if (days < 0) return { text: '已过期 ' + Math.abs(days) + ' 天', tone: 'bad' as const, days }
  if (days === 0) return { text: '今天到期', tone: 'bad' as const, days }
  if (days <= 30) return { text: days + ' 天后到期', tone: 'warn' as const, days }
  return { text: '还剩 ' + days + ' 天', tone: 'ok' as const, days }
}

export const KIND_META: Record<string, { label: string; short: string }> = {
  device: { label: '设备', short: '设' },
  server: { label: '服务器', short: '服' },
  account: { label: '账号', short: '账' },
  domain: { label: '域名', short: '域' },
  other: { label: '其他', short: '其' },
}

export const STATUS_META: Record<string, { label: string; color: string }> = {
  active: { label: '在用', color: '#15803d' },
  idle: { label: '闲置', color: '#a16207' },
  retired: { label: '退役', color: '#78716c' },
  lost: { label: '丢失', color: '#b42318' },
}

export const KINDS = ['device', 'server', 'account', 'domain', 'other']
