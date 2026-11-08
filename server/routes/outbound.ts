import { Hono } from 'hono'
import { t } from '../i18n.js'
import { db } from '../db.js'
import { isJsonContentType } from '../monitor/routes.js'
import { validateOutboundBody } from '../monitor/outbound.js'
import { AT_KEY, MODE_KEY, PROXY_KEY, buildProxyWrite, diffWritten, viewOf } from '../monitor/outbound-view.js'
import { MonitorStore } from '../monitor/store.js'
import { getGlobalEngine } from '../monitor/engine.js'
import { scheduleSnapshot } from '../snapshot.js'

// 设置页「出站模式」的读写面：
//   GET  /api/outbound          读当前模式 + 代理（永不回明文密码，只回 hasPassword）
//   POST /api/outbound          写回 settings 表，然后立刻刷新引擎调度
//   POST /api/outbound/recheck  只刷新引擎调度，不改设置

export const outboundRoute = new Hono()
const store = new MonitorStore(db)

/** 读全量出站设置 */
function readSettings(): Record<string, any> {
  const rows = db
    .prepare("SELECT key, value FROM settings WHERE key IN ('monitorOutboundMode', 'monitorOutboundProxy', 'monitorOutboundChangedAt')")
    .all() as Array<{ key: string; value: string }>
  const out: Record<string, any> = {}
  for (const r of rows) {
    if (r.key === PROXY_KEY) {
      try {
        out[r.key] = JSON.parse(r.value)
      } catch {
        out[r.key] = r.value
      }
    } else {
      out[r.key] = r.value
    }
  }
  return out
}

/* ---------------- GET /api/outbound ---------------- */

outboundRoute.get('/', (c) => {
  try {
    return c.json(viewOf(readSettings()))
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 500)
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

  // 校验在 monitor/outbound.ts（纯函数）。失败文案只带字段名，绝不回显请求体（里面有明文密码）。
  const validated = validateOutboundBody(body)
  if (!validated.ok) return c.json({ error: validated.error }, 400)
  const payload = validated.value

  try {
    const before = readSettings()
    const next: Record<string, any> = { ...before }
    next[MODE_KEY] = payload.mode
    next[AT_KEY] = new Date().toISOString()
    // direct 只改模式与时间，不动 monitorOutboundProxy：用户切回代理时不该重填一遍
    const proxyWrite = payload.mode === 'proxy' && payload.proxy ? buildProxyWrite(before[PROXY_KEY], payload.proxy) : undefined
    if (proxyWrite) next[PROXY_KEY] = proxyWrite

    const upsert = db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `)
    upsert.run(MODE_KEY, payload.mode)
    upsert.run(AT_KEY, next[AT_KEY])
    if (proxyWrite) {
      upsert.run(PROXY_KEY, JSON.stringify(proxyWrite))
    }

    const after = readSettings()
    const diffs = diffWritten({ mode: payload.mode, changedAt: next[AT_KEY], proxy: proxyWrite }, after)
    if (diffs.length) {
      return c.json({ error: t('设置没有按预期写回：') + diffs.join('；') }, 500)
    }

    // 设置变了：SNAPSHOT.md 里的出站说明要跟着重生成
    scheduleSnapshot()

    // 立刻刷新调度
    try {
      getGlobalEngine()?.refreshSchedule()
    } catch (e: any) {
      console.warn('[outbound] 切换后重探没启动：' + String(e?.message || e))
    }

    const rechecking = store.getAllMonitors(true).length
    return c.json({ ...viewOf(after), rechecking })
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 500)
  }
})

/* ---------------- POST /api/outbound/recheck ---------------- */

outboundRoute.post('/recheck', (c) => {
  if (!isJsonContentType(c.req.header('content-type'))) return c.json({ error: t('写操作必须用 application/json') }, 415)
  try {
    getGlobalEngine()?.refreshSchedule()
    const queued = store.getAllMonitors(true).length
    return c.json({ queued })
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 500)
  }
})
