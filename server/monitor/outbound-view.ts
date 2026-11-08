/**
 * 观测台「全局出站模式」的读侧视图 / 写回构造 / 回读比对 —— 全是纯函数。
 */

/** settings 表的三个键（与 spec 固定取值一致，别改名） */
export const MODE_KEY = 'monitorOutboundMode'
export const PROXY_KEY = 'monitorOutboundProxy'
export const AT_KEY = 'monitorOutboundChangedAt'

/** 读侧视图：只允许这 5 个键 */
export type ProxyView = { protocol: string; host: string; port: number; username: string; hasPassword: boolean }
export type OutboundView = { mode: 'direct' | 'proxy'; proxy: ProxyView | null; changedAt: string | null }

const asRecord = (v: unknown): Record<string, any> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : null

/**
 * 把库里的代理配置变成「能回给浏览器」的形状。
 * - 有 password → 自己算 hasPassword，然后不把它放进输出
 * - 已有 hasPassword → 原样用
 * - 只回 5 个键：多一个都不行（掩码是安全边界，不是格式化）
 */
export function maskProxy(raw: Record<string, any>): ProxyView {
  const port = Number(raw.port)
  const out: ProxyView = {
    protocol: typeof raw.protocol === 'string' && raw.protocol ? raw.protocol : 'socks5h',
    host: typeof raw.host === 'string' ? raw.host : '',
    port: Number.isInteger(port) ? port : 0,
    username: typeof raw.username === 'string' ? raw.username : '',
    hasPassword: false,
  }
  if (typeof raw.password === 'string') out.hasPassword = raw.password.length > 0
  else if (typeof raw.hasPassword === 'boolean') out.hasPassword = raw.hasPassword
  return out
}

/** 设置对象 → 响应体。设置里没有的键一律按「直连 / 没配代理 / 没改过」处理。 */
export function viewOf(settings: unknown): OutboundView {
  const s = asRecord(settings) ?? {}
  const rawProxy = asRecord(s[PROXY_KEY])
  const changedAt = s[AT_KEY]
  return {
    mode: s[MODE_KEY] === 'proxy' ? 'proxy' : 'direct',
    proxy: rawProxy ? maskProxy(rawProxy) : null,
    changedAt: typeof changedAt === 'string' && changedAt ? changedAt : null,
  }
}

/**
 * 构造要写回的 monitorOutboundProxy。
 */
export function buildProxyWrite(rawCurrent: unknown, validated: Record<string, any>): Record<string, any> {
  const cur = asRecord(rawCurrent) ?? {}
  const out: Record<string, any> = {
    protocol: validated.protocol,
    host: validated.host,
    port: validated.port,
  }
  for (const k of ['username', 'password']) {
    if (Object.prototype.hasOwnProperty.call(validated, k)) out[k] = validated[k]
    else if (typeof cur[k] === 'string') out[k] = cur[k]
  }
  return out
}

/** 比对用的摘要：只有「协议 host:port / 账号 / 有没有密码」，不含密码本身 */
export function proxySummary(raw: unknown) {
  const p = asRecord(raw) ?? {}
  const port = Number(p.port)
  return {
    protocol: typeof p.protocol === 'string' ? p.protocol : '',
    host: typeof p.host === 'string' ? p.host : '',
    port: Number.isInteger(port) ? port : 0,
    username: typeof p.username === 'string' ? p.username : '',
    hasPassword: typeof p.password === 'string' ? p.password.length > 0 : p.hasPassword === true,
  }
}

/**
 * 回读比对：mode / 代理的五项 / changedAt 必须与刚才写进去的一致。
 * 不一致就说明「写了但没落库」，必须报出来 —— 但差异文案只写字段与摘要，永不回显密码。
 */
export function diffWritten(
  intended: { mode: string; changedAt: string; proxy?: Record<string, any> },
  after: Record<string, any>,
): string[] {
  const diffs: string[] = []
  const modeNow = after[MODE_KEY] === 'proxy' ? 'proxy' : 'direct'
  if (modeNow !== intended.mode) diffs.push('出站模式：期望 ' + intended.mode + '，实际 ' + modeNow)

  const atNow = typeof after[AT_KEY] === 'string' ? after[AT_KEY] : ''
  if (atNow !== intended.changedAt) diffs.push('改动时间：期望 ' + intended.changedAt + '，实际 ' + (atNow || '(空)'))

  if (intended.proxy) {
    const want = proxySummary(intended.proxy)
    const got = proxySummary(after[PROXY_KEY])
    if (got.protocol !== want.protocol) diffs.push('代理协议：期望 ' + want.protocol + '，实际 ' + got.protocol)
    if (got.host !== want.host) diffs.push('代理主机：期望 ' + want.host + '，实际 ' + got.host)
    if (got.port !== want.port) diffs.push('代理端口：期望 ' + want.port + '，实际 ' + got.port)
    // 账号：请求没带这个键时（「不修改」）不比
    if (Object.prototype.hasOwnProperty.call(intended.proxy, 'username') && got.username !== want.username) {
      diffs.push('代理账号：与写回的期望不一致')
    }
    // 密码只比「有没有」；请求没带密码时同理不比
    if (Object.prototype.hasOwnProperty.call(intended.proxy, 'password') && got.hasPassword !== want.hasPassword) {
      diffs.push('代理密码：期望' + (want.hasPassword ? '有' : '没有') + '，实际' + (got.hasPassword ? '有' : '没有'))
    }
  }
  return diffs
}
