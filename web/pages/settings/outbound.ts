// 设置页「出站模式」卡片的纯逻辑：表单状态 ↔ POST 请求体、摘要 / 时间文案。
// 不碰 React、不碰网络，所以能直接单测（tests/unit/settings-outbound.test.mts）。
//
// 这里最要紧的一件事是**三态**（spec §5 / R14）：
//   password / username 各有三种语义 —— 键不存在 = 本次不修改、null = 清空、字符串 = 设置成它。
//   写错任何一种，用户就会在「没动这个框」的情况下把已存的凭据悄悄清掉，所以一律在这里定，组件不许自己拼。
import { localeTag, t } from '../../lib/i18n'
import type { OutboundCfg, OutboundPayload, ProxyProtocol, ProxyView } from '../../lib/api'

/** 只支持这四种（spec §4.5）。socks5h 是默认：DNS 也交给代理解析，避免本机解析泄漏。 */
export const PROTOCOLS: ProxyProtocol[] = ['socks5h', 'socks5', 'http', 'https']

export const DEFAULT_PROTOCOL: ProxyProtocol = 'socks5h'

/**
 * 卡片里的表单状态。
 * - port 用字符串：input 里只能拿到字符串，转数字放在 buildOutboundPayload 一处做
 * - password 永远是**用户这次输入的**值，库里存的密码不进这里（读侧只有 hasPassword）
 * - usernameTouched / clearPassword 是「用户到底动没动」的唯一依据，别用「值是否为空」猜：
 *   空的用户名既可能是「没动」，也可能是「要清空」，只有标记能分开
 */
export type OutboundForm = {
  mode: 'direct' | 'proxy'
  protocol: ProxyProtocol
  host: string
  port: string
  username: string
  usernameTouched: boolean
  password: string
  clearPassword: boolean
}

/** GET 的响应（或 null）→ 表单初值。密码框**永远留空**：绝不回显已存的密码。 */
export function formFromCfg(cfg: OutboundCfg | null): OutboundForm {
  const p = cfg?.proxy ?? null
  return {
    mode: cfg?.mode === 'proxy' ? 'proxy' : 'direct',
    protocol: p?.protocol ?? DEFAULT_PROTOCOL,
    host: p?.host ?? '',
    // 直连时后端照样回已存的代理配置：表单变灰但仍显示，用户切回「经代理」不用重填
    port: p && p.port ? String(p.port) : '',
    username: p?.username ?? '',
    usernameTouched: false,
    password: '',
    clearPassword: false,
  }
}

/**
 * 表单 → POST /api/outbound 的请求体。
 *
 * - 直连：只送 `{ mode: 'direct' }`，**不带 proxy**（后端保证不清已存配置）
 * - 经代理：protocol / host / port 每次都给全；host 去首尾空格（与 pinboard 后端一致）
 * - password：没填 → 不带这个键（= 保留库里那个）；点了「清除密码」→ null；填了 → 字符串
 * - username：没动过 → 不带这个键；改空了 → null；改了 → 字符串
 */
export function buildOutboundPayload(form: OutboundForm): OutboundPayload {
  if (form.mode === 'direct') return { mode: 'direct' }

  const port = Number(form.port.trim())
  const proxy: {
    protocol: ProxyProtocol
    host: string
    port: number
    username?: string | null
    password?: string | null
  } = {
    protocol: form.protocol,
    host: form.host.trim(),
    // 空串 / 乱填一律送 0，交给后端报「代理端口必须是 1–65535 的整数」；别让 NaN 进 JSON（会变成 null）
    port: Number.isFinite(port) ? port : 0,
  }

  // 清除标记优先于输入框（点过清除又打字回来 → 以打进去的为准，见单测）
  if (form.password !== '') proxy.password = form.password
  else if (form.clearPassword) proxy.password = null

  if (form.usernameTouched) proxy.username = form.username === '' ? null : form.username

  return { mode: 'proxy', proxy }
}

/** 「socks5h 127.0.0.1:10808」——给人看的一行，永远不含账号密码 */
export function proxyLine(p: Pick<ProxyView, 'protocol' | 'host' | 'port'>): string {
  return `${p.protocol} ${p.host}:${p.port}`
}

/** 卡片底部的当前出站摘要 */
export function outboundSummary(cfg: OutboundCfg | null): string {
  if (!cfg || cfg.mode !== 'proxy') return t('出站：直连')
  if (!cfg.proxy) return t('出站：经代理（还没配代理）')
  return t('出站：经代理 {proxy}', { proxy: proxyLine(cfg.proxy) })
}

/** 保存成功的 toast。0 项时别写「0 个观测项」（那是没切换的意思） */
export function savedNotice(rechecking: number): string {
  if (rechecking > 0) return t('已切换，正在重新探测 {n} 个观测项…', { n: rechecking })
  return t('已切换（没有需要重探的观测项）')
}

/** 「测试连通」= 立刻踢一轮重探（kuma 侧异步跑，接口只回答排了几项） */
export function testNotice(queued: number): string {
  if (queued > 0) return t('已排队重探 {n} 个观测项，几秒后看观测台', { n: queued })
  return t('没有可重探的观测项')
}

/**
 * 上次切换时间。相对时间只在 1 小时内用（「30 分钟前」），更早的给本地时间 —— 和 TunnelCard 一致。
 * now 可传：单测要固定时间。
 */
export function changedAtText(iso: string | null, now: number = Date.now()): string {
  if (!iso) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const diff = now - at.getTime()
  if (diff < 0) return ''
  if (diff < 60_000) return t('上次切换：刚刚')
  if (diff < 3_600_000) return t('上次切换：{n} 分钟前', { n: Math.floor(diff / 60_000) })
  return t('上次切换：{time}', { time: at.toLocaleString(localeTag(), { hour12: false }) })
}
