/**
 * 观测台「全局出站模式」的纯逻辑：POST 请求体校验、设置合并、给人看的一句话描述。
 *
 * 为什么单独一块：这些规则还必须与 kuma 侧 `server/outbound.js` 的 `normalizeProxyConfig` 逐字对齐 ——
 * 界面把用户填的东西收下之前先在这里挡一遍，挡不住的才轮到 kuma 的求值器报错；
 * 两边文案不一样，用户就会看到两套说法，所以错误文案是**逐字照抄**的常量，改之前先看 kuma 那边。
 * 密码只进不出：这里只做「这次带没带密码」，读侧的 `hasPassword` 是 kuma 掩码算的，本文件不产出。
 * 全是纯函数，不碰网络、不碰数据库，所以能单测。
 */

/** 只支持这四种（socks5h 默认：DNS 也交给代理解，避免本机解析泄漏） */
export type ProxyProtocol = 'socks5h' | 'socks5' | 'http' | 'https'

/** 读侧（GET）的代理形状：密码只回布尔 */
export type ProxyCfg = {
  protocol: ProxyProtocol
  host: string
  port: number
  username: string
  hasPassword: boolean
}

/** 写侧（POST）的负载：密码要么是字符串（本次设置），要么键不存在（保留旧值） */
export type OutboundPayload = {
  mode: 'direct' | 'proxy'
  proxy: null | (Omit<ProxyCfg, 'hasPassword'> & { password?: string | null })
}

export type OutboundValidation = { ok: true; value: OutboundPayload } | { ok: false; error: string }

const PROTOCOLS: readonly string[] = ['socks5h', 'socks5', 'http', 'https']

/* ---- 错误文案：与 kuma 侧逐字一致，别顺手改字 ---- */
const ERR_MODE = '出站模式只能是 direct 或 proxy'
const ERR_PROTOCOL = '不支持该代理协议（支持 socks5h / socks5 / http / https）'
const ERR_HOST = '代理主机格式不对（只填主机或 IP，不要带 http:// 或端口）'
const ERR_PORT = '代理端口必须是 1–65535 的整数'
/** 「配置无效」那条要带具体字段名，前端好定位是哪个框填坏了 */
const errInvalid = (field: string) => `代理不可用：配置无效（${field}），请检查 设置 → 出站模式`

/** `http://` / `socks5h://` 这类带 scheme 的写法一律拒（host 只填主机或 IP） */
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/**
 * 校验 POST /api/outbound 的请求体。
 *
 * 顺序与 kuma 的 normalizeProxyConfig 一致：mode → proxy 是不是对象 → protocol → host → port → username → password。
 * 成功时 `value.proxy` 只含 `protocol / host / port / username`（password 只在这次真给了字符串时出现），
 * **不含 hasPassword** —— 那是读侧的字段，写进去会被 kuma 当成不认识的键丢掉。
 */
export function validateOutboundBody(body: unknown): OutboundValidation {
  const b = asRecord(body)
  if (!b) return { ok: false, error: ERR_MODE }

  // mode 不做大小写 / trim 归一：前端是单选按钮，写错就是坏请求
  if (b.mode === 'direct') return { ok: true, value: { mode: 'direct', proxy: null } }
  if (b.mode !== 'proxy') return { ok: false, error: ERR_MODE }

  const raw = asRecord(b.proxy)
  if (!raw) return { ok: false, error: errInvalid('proxy') }

  const protocol = typeof raw.protocol === 'string' ? raw.protocol.trim().toLowerCase() : ''
  if (!PROTOCOLS.includes(protocol)) return { ok: false, error: ERR_PROTOCOL }

  // host：去首尾空格后必须非空，且不含空白 / 「/」 / 「:」 / scheme
  // （「:」一并拒掉，`h:1080` 这种把端口塞进 host 的写法是最常见的填错）
  const host = typeof raw.host === 'string' ? raw.host.trim() : ''
  if (!host || /\s/.test(host) || host.includes('/') || host.includes(':') || SCHEME.test(host)) {
    return { ok: false, error: ERR_HOST }
  }

  // port：只认 number（`"10808"` / `true` / `[10808]` 全部拒）
  const port = raw.port
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: ERR_PORT }
  }

  if (raw.username !== undefined && raw.username !== null && typeof raw.username !== 'string') {
    return { ok: false, error: errInvalid('username') }
  }
  const username = typeof raw.username === 'string' ? raw.username.trim() : ''

  if (raw.password !== undefined && raw.password !== null && typeof raw.password !== 'string') {
    return { ok: false, error: errInvalid('password') }
  }

  const proxy: Omit<ProxyCfg, 'hasPassword'> & { password?: string } = {
    protocol: protocol as ProxyProtocol,
    host,
    port,
    username,
  }
  // 密码不 trim：首尾空格也是密码的一部分；缺键 / null 表示「本次不提供」，键干脆不出现
  if (typeof raw.password === 'string') proxy.password = raw.password
  return { ok: true, value: { mode: 'proxy', proxy } }
}

/**
 * 合并旧设置与新设置 —— kuma 侧 `mergeProxyOnWrite`（`server/server.js` 的 setSettings 分支）的镜像。
 *
 * - 只认 protocol / host / port / username / password 五个键，current 里别的键原样留着
 * - 缺键 / null = 这次没改，保留 current 的值（**不要把 null 写进库**）
 * - password 例外：显式 null 或空串 = 清空成 `""`；缺键 = 保留旧密码（用户没重填就别把密码弄丢）
 * - 返回新对象，绝不原地改 current
 */
export function mergeProxySettings(current: any, incoming: any): any {
  const cur = asRecord(current) ?? {}
  const inc = asRecord(incoming) ?? {}
  const keep = (k: string) => inc[k] === undefined || inc[k] === null

  const out: Record<string, unknown> = { ...cur }

  const protocol = keep('protocol') ? cur.protocol : inc.protocol
  out.protocol = protocol || 'socks5h'
  out.host = keep('host') ? cur.host || '' : inc.host
  out.port = Number(keep('port') ? cur.port || 0 : inc.port)
  const username = keep('username') ? cur.username : inc.username
  out.username = username === undefined || username === null ? '' : String(username)

  if (inc.password === undefined) {
    // 缺键（或显式 undefined）= 保留旧密码；旧值也是空就当空串
    out.password = cur.password === undefined || cur.password === null ? '' : cur.password
  } else {
    out.password = inc.password === null ? '' : String(inc.password)
  }

  return out
}

/** 给人看的一句话：`socks5h 127.0.0.1:10808`。永远不含账号密码，也不加方括号。 */
export function describe(p: ProxyCfg): string {
  const protocol = String(p?.protocol || '')
  const host = String(p?.host || '')
  const port = Number(p?.port || 0)
  return `${protocol} ${host}:${port}`
}
