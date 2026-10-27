import { Hono } from 'hono'
import { t } from '../i18n.js'
import { call } from '../kuma/client.js'
import { isJsonContentType } from '../kuma/http.js'
import { validateOutboundBody } from '../kuma/outbound.js'
import { recheckAll } from '../kuma/outbound-recheck.js'
import { scheduleSnapshot } from '../snapshot.js'

// 设置页「出站模式」的读写面：
//   GET  /api/outbound          读当前模式 + 代理（**永不回明文密码**，只回 hasPassword）
//   POST /api/outbound          整包写回 Kuma 的 general settings，然后立刻重探一轮
//   POST /api/outbound/recheck  只重探，不改设置
//
// 两条要紧的边界：
//   1. 密码只进不出。Kuma 的 getSettings 现在还没掩码（回明文），将来会自己掩码（只回 hasPassword），
//      所以这里两边都要认：有 password 就自己算 hasPassword 再把它从输出里删掉。
//   2. 写回是**整包** setSettings，代理配置少一个键就可能把用户填好的东西写丢 —— 见 buildProxyWrite。
// 校验与合并的纯逻辑在 server/kuma/outbound.ts（有单测），这里只管取数、写回、比对。

export const outboundRoute = new Hono()

/** kuma general setting 的三个键（与 spec 固定取值一致，别改名） */
const MODE_KEY = 'monitorOutboundMode'
const PROXY_KEY = 'monitorOutboundProxy'
const AT_KEY = 'monitorOutboundChangedAt'

/** 读侧视图：只允许这 5 个键 */
type ProxyView = { protocol: string; host: string; port: number; username: string; hasPassword: boolean }
type OutboundView = { mode: 'direct' | 'proxy'; proxy: ProxyView | null; changedAt: string | null }

const asRecord = (v: unknown): Record<string, any> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : null

/**
 * 把库里的代理配置变成「能回给浏览器」的形状。
 * - 有 password（老 kuma 回明文）→ 自己算 hasPassword，然后**不把它放进输出**
 * - 已有 hasPassword（将来 kuma 自己掩码）→ 原样用
 * - 只回 5 个键：多一个都不行（掩码是安全边界，不是格式化）
 */
function maskProxy(raw: Record<string, any>): ProxyView {
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
function viewOf(settings: unknown): OutboundView {
  const s = asRecord(settings) ?? {}
  const rawProxy = asRecord(s[PROXY_KEY])
  const changedAt = s[AT_KEY]
  return {
    mode: s[MODE_KEY] === 'proxy' ? 'proxy' : 'direct',
    proxy: rawProxy ? maskProxy(rawProxy) : null,
    changedAt: typeof changedAt === 'string' && changedAt ? changedAt : null,
  }
}

async function readSettings(): Promise<Record<string, any>> {
  const res: any = await call('getSettings')
  return asRecord(res?.data) ?? {}
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
function buildProxyWrite(rawCurrent: unknown, validated: Record<string, any>): Record<string, any> {
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
function proxySummary(raw: unknown) {
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
function diffWritten(intended: { mode: string; changedAt: string; proxy?: Record<string, any> }, after: Record<string, any>): string[] {
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
    // 账号：请求没带这个键时（「不修改」）不比 —— 老 kuma 与库里的值一致，新 kuma 由它自己保留
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

/* ---------------- GET /api/outbound ---------------- */

outboundRoute.get('/', async (c) => {
  try {
    return c.json(viewOf(await readSettings()))
  } catch (e: any) {
    // 文案来自 client.ts / kuma，只含「连不上 / 没有口令」这类信息，不含请求体
    return c.json({ error: String(e?.message || e) }, 502)
  }
})

/* ---------------- POST /api/outbound ---------------- */

outboundRoute.post('/', async (c) => {
  if (!isJsonContentType(c.req.header('content-type'))) return c.json({ error: t('写操作必须用 application/json') }, 415)
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: t('请求体不是合法 JSON') }, 400)
  }

  // 校验在 outbound.ts（纯函数）。失败文案只带字段名，绝不回显请求体（里面有明文密码）。
  const validated = validateOutboundBody(body)
  if (!validated.ok) return c.json({ error: validated.error }, 400)
  const payload = validated.value

  try {
    // 先取全量：setSettings 是整包写，漏一个键就等于把那个设置改掉
    const before = await readSettings()
    const next: Record<string, any> = { ...before }
    next[MODE_KEY] = payload.mode
    next[AT_KEY] = new Date().toISOString()
    // direct 只改模式与时间，**不动** monitorOutboundProxy：用户切回代理时不该重填一遍
    const proxyWrite = payload.mode === 'proxy' && payload.proxy ? buildProxyWrite(before[PROXY_KEY], payload.proxy) : undefined
    if (proxyWrite) next[PROXY_KEY] = proxyWrite

    // 第二个参数是 currentPassword：**必须显式给 null**。
    // kuma 的 handler 签名是 (data, currentPassword, callback)，只 emit 两个参数时 ack 回调会被当成
    // currentPassword，服务端 callback 就是 undefined —— 写确实生效了，但永远不回 ack（实测挂 20 秒超时）。
    // 这次写不涉及关闭鉴权，kuma 不会真去校验它。
    await call('setSettings', next, null)

    const after = await readSettings()
    const diffs = diffWritten({ mode: payload.mode, changedAt: next[AT_KEY], proxy: proxyWrite }, after)
    if (diffs.length) {
      return c.json({ error: t('Kuma 没有按预期写回设置：') + diffs.join('；') }, 500)
    }

    // 设置变了：SNAPSHOT.md 里的出站说明要跟着重生成
    scheduleSnapshot()

    // 立刻重探一轮（后台跑，不等它跑完）。条数 = 本轮要踢的 active & 受支持项
    const rechecking = await recheckAll().catch((e: any) => {
      console.warn('[outbound] 切换后重探没启动：' + String(e?.message || e))
      return 0
    })

    return c.json({ ...viewOf(after), rechecking })
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 502)
  }
})

/* ---------------- POST /api/outbound/recheck ---------------- */

outboundRoute.post('/recheck', async (c) => {
  if (!isJsonContentType(c.req.header('content-type'))) return c.json({ error: t('写操作必须用 application/json') }, 415)
  try {
    return c.json({ queued: await recheckAll() })
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 502)
  }
})
