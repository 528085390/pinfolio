// 时间、金额、资产类型/状态这些跨页共用的格式化文案。
// KIND_META / STATUS_META 的 label 是 getter，渲染时才来这里取，所以这里用函数条目做复数。
import type { Dict } from '../core'

const plural = (n: unknown, one: string, many: string) => (Number(n) === 1 ? one : many)

export const format: Dict = {
  '刚刚': 'just now',
  '{n} 分钟前': (v) => `${v.n} ${plural(v.n, 'minute', 'minutes')} ago`,
  '{n} 小时前': (v) => `${v.n} ${plural(v.n, 'hour', 'hours')} ago`,
  '{n} 天前': (v) => `${v.n} ${plural(v.n, 'day', 'days')} ago`,
  '已过期 {n} 天': (v) => `expired ${v.n} ${plural(v.n, 'day', 'days')} ago`,
  '今天到期': 'expires today',
  '{n} 天后到期': (v) => `expires in ${v.n} ${plural(v.n, 'day', 'days')}`,
  '还剩 {n} 天': (v) => `${v.n} ${plural(v.n, 'day', 'days')} left`,

  '设备': 'Device',
  '服务器': 'Server',
  '账号': 'Account',
  '域名': 'Domain',
  '其他': 'Other',
  '在用': 'Active',
  '闲置': 'Idle',
  '退役': 'Retired',
  '丢失': 'Lost',
}
