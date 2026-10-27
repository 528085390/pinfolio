/**
 * 观测台「全局出站模式」的**读侧视图 / 写回构造 / 回读比对** —— 全是纯函数。
 *
 * 为什么单独一块（Task 7 评审 I-1）：这三件事原来长在 server/routes/outbound.ts 里，而那个文件
 * import 了 hono 与 socket.io 客户端；想给「铁律 7：写了没落库就必须报错」补一条单测，就得起 HTTP 服务、
 * 还得连一个真 kuma。抽到这里之后 node --test 直接 import 就能断言，护栏不再是零覆盖。
 * 路由那边只剩取数 / 写回 / 错误映射。
 *
 * 三条要紧的边界（R12 + 评审的写回铁律）：
 *   1. **绝不把 GET 掩码视图当成写回的 current**：buildProxyWrite 的 rawCurrent 必须是 getSettings 的原始值。
 *   2. 写回对象里既不能出现 hasPassword（读侧字段，kuma 不认），也不能因为「本次没改」就少写 key
 *      ——老 kuma 的 setSettings 是整包覆盖，少一个键就等于把用户填好的东西改掉。
 *   3. 密码只进不出：maskProxy 只折算成 hasPassword；diffWritten 的文案只带字段名与摘要，永不回显密码。
 */

/** kuma general setting 的三个键（与 spec 固定取值一致，别改名） */
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
 * - 有 password（老 kuma 回明文）→ 自己算 hasPassword，然后**不把它放进输出**
 * - 已有 hasPassword（将来 kuma 自己掩码）→ 原样用
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
 *
 * protocol / host / port 一律用校验后的值（这三项每次都必须给全）。
 * username / password 是**三态**（请求里带没带这个键，语义完全不同），所以分开处理：
 *   - 请求带了这个键 → 原样写（validateOutboundBody 已经把 null 折成 ""，即「清空」）
 *   - 请求没带 → 「本次不修改」。这时有两种 kuma：
 *       · 老 kuma（getSettings 回明文，setSettings 整包覆盖）：库里值能从 getSettings 里看到，
 *         必须原样写回，否则「不修改」会变成「清空」——这正是 R14 前的老 bug。
 *       · 新 kuma（getSettings 已掩码，password 看不到）：这个键**不写**，交给 kuma 的
 *         mergeProxyOnWrite 用库里值保留（它对缺键是保留、对 "" 才是清空）。
 * 写回对象里绝不能出现 hasPassword：那是读侧字段，写进去会被 kuma 当成不认识的键。
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

/** 比对用的摘要：只有「协议 host:port / 账号 / 有没有密码」，**不含密码本身** */
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
 * 回读比对（铁律 7）：mode / 代理的五项 / changedAt 必须与刚才写进去的一致。
 * 不一致就说明「写了但没落库」，必须报出来 —— 但差异文案只写字段与摘要，永不回显密码。
 *
 * intended.proxy 就是 buildProxyWrite 的返回值，所以「请求里没带 username/password 键」在
 * 这里表现为「意图对象里没有这个键」：那种情况下这两个键不比（老 kuma 与库里的值一致，
 * 新 kuma 由它自己保留），否则读回是掩码/空值就会误报「没落库」。
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
    // 密码只比「有没有」；请求没带密码时同理不比（保留语义由 kuma 决定）
    if (Object.prototype.hasOwnProperty.call(intended.proxy, 'password') && got.hasPassword !== want.hasPassword) {
      diffs.push('代理密码：期望' + (want.hasPassword ? '有' : '没有') + '，实际' + (got.hasPassword ? '有' : '没有'))
    }
  }
  return diffs
}
