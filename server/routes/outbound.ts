import { Hono } from 'hono'
import { t } from '../i18n.js'
import { call } from '../kuma/client.js'
import { isJsonContentType } from '../kuma/http.js'
import { validateOutboundBody } from '../kuma/outbound.js'
import { recheckAll } from '../kuma/outbound-recheck.js'
import { AT_KEY, MODE_KEY, PROXY_KEY, buildProxyWrite, diffWritten, viewOf } from '../kuma/outbound-view.js'
import { kumaMeta } from '../kuma/meta.js'
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
//
// 掩码视图 / 写回构造 / 回读比对（maskProxy / viewOf / buildProxyWrite / diffWritten）是纯逻辑，
// 抽在 server/kuma/outbound-view.ts（有单测，node --test 直接 import，不需要起服务、不需要连 kuma）；
// 这个文件只管取数、写回、错误映射。加逻辑别往这里塞，塞进 outbound-view.ts 才测得到。

export const outboundRoute = new Hono()

/** 读全量设置：setSettings 是整包写，每次都得先拿到完整的 map */
async function readSettings(): Promise<Record<string, any>> {
  const res: any = await call('getSettings')
  const data = res?.data
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, any>) : {}
}

/* ---------------- GET /api/outbound ---------------- */

outboundRoute.get('/', async (c) => {
  try {
    return c.json(viewOf(await readSettings()))
  } catch (e: any) {
    const meta = await kumaMeta().catch(() => null)
    if (meta && !meta.configured) {
      return c.json(viewOf({}))
    }
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
