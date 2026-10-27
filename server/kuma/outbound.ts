/**
 * 观测台「全局出站模式」的纯逻辑：POST 请求体校验、设置合并、给人看的一句话描述。
 *
 * 为什么单独一块：界面把用户填的东西收下之前先在这里挡一遍，挡不住的才轮到 kuma 的求值器报错。
 * 文案来自 spec §3.3（设置页表单提示）；kuma 心跳里的错误文案是另一套（代理不可用：配置无效（协议/服务器地址/端口）…），
 * 两处不共用，改动前先看 spec。
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

/* ---- 错误文案：逐字照抄 spec §3.3 的设置页提示（kuma 心跳那套是另一套文案），别顺手改字 ---- */
const ERR_MODE = '出站模式只能是 direct 或 proxy'
const ERR_PROTOCOL = '不支持该代理协议（支持 socks5h / socks5 / http / https）'
const ERR_HOST = '代理主机格式不对（只填主机或 IP，不要带 http:// 或端口）'
const ERR_PORT = '代理端口必须是 1–65535 的整数'
/** 「配置无效」那条要带具体字段名（中文：代理 / 账号 / 密码），前端好定位是哪个框填坏了 */
const errInvalid = (field: string) => `代理不可用：配置无效（${field}），请检查 设置 → 出站模式`

/** `http://` / `socks5h://` 这类带 scheme 的写法一律拒（host 只填主机或 IP） */
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/**
 * 校验 POST /api/outbound 的请求体。
 *
 * 字段顺序 protocol → host → port → username → password 与 kuma 的 normalizeProxyConfig 相同，
 * 但两边报错文案是两套（见文件头），不要照着 kuma 那边改这里的字。
 * 成功时 `value.proxy` 只含 `protocol / host / port / username`，外加**按需**出现的一个 password：
 *   - 缺键 / undefined → 不出现 password 键（= 本次不修改密码，由 merge 保留旧值）
 *   - null / "" → password 键存在且为 ""（= 清空密码）
 *   - 字符串 → 原样（不 trim）
 * **不含 hasPassword** —— 那是读侧的字段，写进去会被 kuma 当成不认识的键丢掉。
 */
export function validateOutboundBody(body: unknown): OutboundValidation {
  const b = asRecord(body)
  if (!b) return { ok: false, error: ERR_MODE }

  // mode 不做大小写 / trim 归一：前端是单选按钮，写错就是坏请求
  if (b.mode === 'direct') return { ok: true, value: { mode: 'direct', proxy: null } }
  if (b.mode !== 'proxy') return { ok: false, error: ERR_MODE }

  const raw = asRecord(b.proxy)
  if (!raw) return { ok: false, error: errInvalid('代理') }

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
    return { ok: false, error: errInvalid('账号') }
  }
  const username = typeof raw.username === 'string' ? raw.username.trim() : ''

  // password 只认 string / null（null 由 R13 定为「清空」）；number / boolean / object / array 一律拒
  if (raw.password !== undefined && raw.password !== null && typeof raw.password !== 'string') {
    return { ok: false, error: errInvalid('密码') }
  }

  const proxy: Omit<ProxyCfg, 'hasPassword'> & { password?: string } = {
    protocol: protocol as ProxyProtocol,
    host,
    port,
    username,
  }
  // 密码不 trim：首尾空格也是密码的一部分。三态必须分得开，否则「清除密码」这条路不可达：
  // 缺键 / undefined = 本次不修改密码（键不出现，交给 mergeProxySettings 保留旧值）
  // null / ""      = 清空密码（键必须存在，值给空串）
  if (typeof raw.password === 'string') {
    proxy.password = raw.password
  } else if (raw.password === null) {
    proxy.password = ''
  }
  return { ok: true, value: { mode: 'proxy', proxy } }
}

/**
 * 合并旧设置与新设置 —— 对应 kuma 侧 `server/outbound.js` 的 `mergeProxyOnWrite`。
 *
 * kuma 版不补默认值、只回 5 键；这里在同一套「缺键 = 保留」语义上，额外把 protocol 缺省补成
 * socks5h、port 归一成 number、username / password 归一成字符串 —— 写侧要立刻把结果回显给表单。
 * 这个差异是有意的，别对着 kuma 那边「对齐」掉。
 *
 * - 只回 protocol / host / port / username / password 五个业务键；current 与 incoming 里多出来的键
 *   （读侧的 `hasPassword`、以及任何别的键）都不许穿过去
 * - 缺键 / undefined / null（password 除外）= 这次没改，保留 current 的值（**不要把 null 写进库**）
 * - password 例外：缺键 = 保留旧密码（用户没重填就别把密码弄丢）；显式 null 或 "" = 清空成 `""`
 * - 返回新对象，绝不原地改 current
 */
export function mergeProxySettings(current: any, incoming: any): any {
  const cur = asRecord(current) ?? {}
  const inc = asRecord(incoming) ?? {}
  const keep = (k: string) => inc[k] === undefined || inc[k] === null

  const protocol = keep('protocol') ? cur.protocol : inc.protocol
  const host = keep('host') ? cur.host || '' : inc.host
  const port = Number(keep('port') ? cur.port || 0 : inc.port)
  const username = keep('username') ? cur.username : inc.username

  // 按 5 键构造返回，不 spread cur / inc：掩码字段与未知键都不能落到 merge 结果里
  return {
    protocol: protocol || 'socks5h',
    host,
    port,
    username: username === undefined || username === null ? '' : String(username),
    // 缺键（或显式 undefined）= 保留旧密码；旧值也是空就当空串
    password:
      inc.password === undefined
        ? cur.password === undefined || cur.password === null
          ? ''
          : String(cur.password)
        : inc.password === null
          ? ''
          : String(inc.password),
  }
}

/** 给人看的一句话：`socks5h 127.0.0.1:10808`。永远不含账号密码，也不加方括号。 */
export function describe(p: ProxyCfg): string {
  // `?.` 与 `|| ''` / `|| 0` 只是防御性兜底：类型上调用方只能传 ProxyCfg，这条分支是死路径（没有测试盯着）
  const protocol = String(p?.protocol || '')
  const host = String(p?.host || '')
  const port = Number(p?.port || 0)
  return `${protocol} ${host}:${port}`
}
