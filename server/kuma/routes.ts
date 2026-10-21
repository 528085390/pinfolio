import { Hono } from 'hono'
import {
  deleteMonitor, editMonitor, getBeats, getMonitor, listMonitors, pauseMonitor, resumeMonitor, toView,
} from './client.js'
import { resolveAction, runRecipe } from './actions.js'
import { loadLinks, pickLink } from './links.js'
import { BEAT_WINDOW, collectCached, getStatusPage, groupOf, invalidate, lastPayload, mapBeat } from './feed.js'
import { backupDb, refreshSnapshot } from './backup.js'

// 观测台的 HTTP 面：列表 / 详情 / 改名 / 暂停 / 删除 / 立即观测。
// 数据抓取和缓存在 feed.ts，Kuma 的 socket 通道在 client.ts，配方执行在 actions.ts。
export const monitorsRoute = new Hono()

monitorsRoute.get('/', async (c) => {
  const fresh = c.req.query('fresh') === '1'
  try {
    return c.json(await collectCached(fresh))
  } catch (e: any) {
    // Kuma 挂了 / 没启动时，退回上一次的数据并标记 stale，比直接空屏有用
    const stale = lastPayload()
    if (stale) return c.json({ ...stale, stale: true, error: '读不到 Kuma：' + String(e?.message || e) })
    return c.json({ error: '读不到 Kuma 状态页：' + String(e?.message || e) }, 502)
  }
})

/* ---------------- 单个观测项：详情 / 改名 / 暂停 / 删除 / 立即观测 ---------------- */

monitorsRoute.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: '观测项 id 不合法' }, 400)
  try {
    // 顺手拿一份 id → 名字的表：策略里的门控可能按 id 引用别的观测项，摘要里显示名字比 #3 好读
    const beans = await listMonitors().catch(() => null as Record<string, any> | null)
    const names: Record<string, string> = {}
    if (beans) for (const k of Object.keys(beans)) names[k] = String(beans[k]?.name || '')

    const [bean, rawBeats] = await Promise.all([getMonitor(id), getBeats(id, 24)])
    const beats = rawBeats.slice(-BEAT_WINDOW).map(mapBeat)
    const monitor = toView(bean, names)
    return c.json({
      monitor: { ...monitor, group: groupOf(id) },
      latest: beats.length ? beats[beats.length - 1] : null,
      beats,
      action: resolveAction({ id: monitor.id, name: monitor.name, type: monitor.type }),
      link: pickLink(loadLinks(), { id: monitor.id, name: monitor.name }),
    })
  } catch (e: any) {
    // Kuma 的 getMonitor 对不存在的 id 不返回 ok:false，而是抛 TypeError（reading 'id'），
    // 统一交给 kumaErrorStatus 把这种消息也判成 404，否则前端看到的是 502。
    return c.json({ error: String(e?.message || e) }, kumaErrorStatus(e))
  }
})

/* ---------------- 写操作：改名 / 介绍 / 频率 / 暂停 / 恢复 / 删除 ---------------- */

/** 写接口只收 application/json：跨站表单只能发 text/plain，这样能挡掉 CSRF。 */
function isJsonRequest(c: any): boolean {
  return String(c.req.header('content-type') || '').toLowerCase().includes('application/json')
}

/** 收集所有策略里「按名字」引用观测项的地方（policy_json 的 monitorStatus.name）。 */
function policyNameRefs(beans: Record<string, any>): Map<string, number[]> {
  const out = new Map<string, number[]>()
  const walk = (v: any, hit: (name: string) => void) => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x, hit)
      return
    }
    if (!v || typeof v !== 'object') return
    const ms = (v as any).monitorStatus
    if (ms && typeof ms === 'object' && typeof ms.name === 'string') hit(ms.name)
    for (const k of Object.keys(v)) walk((v as any)[k], hit)
  }
  for (const key of Object.keys(beans)) {
    const raw = beans[key]?.policyJson ?? beans[key]?.policy_json
    if (!raw) continue
    let parsed: any = raw
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed) } catch { continue }
    }
    walk(parsed, (name) => {
      const list = out.get(name) || []
      list.push(Number(beans[key]?.id || key))
      out.set(name, list)
    })
  }
  return out
}

function asInt(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : null
}

function kumaErrorStatus(e: any): 404 | 502 {
  const msg = String(e?.message || '')
  if (e?.code === 'notfound' || /not found|Cannot read properties of null/i.test(msg)) return 404
  return 502
}

monitorsRoute.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: '观测项 id 不合法' }, 400)
  if (!isJsonRequest(c)) return c.json({ error: '写操作必须用 application/json' }, 415)
  let body: Record<string, unknown>
  try {
    body = (await c.req.json()) as Record<string, unknown>
  } catch {
    return c.json({ error: '请求体不是合法 JSON' }, 400)
  }
  if (!body || typeof body !== 'object') return c.json({ error: '请求体不是合法 JSON' }, 400)

  try {
    const bean = await getMonitor(id)
    const beans = await listMonitors().catch(() => ({}) as Record<string, any>)
    const next: any = { ...bean }

    // ---- 名字 ----
    if (body.name !== undefined) {
      const name = String(body.name ?? '').trim()
      if (!name) return c.json({ error: '名字不能为空' }, 400)
      if (name.length > 120) return c.json({ error: '名字最长 120 字' }, 400)
      if (name !== String(bean.name || '').trim()) {
        const dup = Object.values(beans).find((b: any) => Number(b?.id) !== id && String(b?.name || '').trim() === name)
        if (dup) return c.json({ error: '已经有同名观测项：' + name }, 400)
        const refs = policyNameRefs(beans).get(String(bean.name || '').trim())
        if (refs && refs.length) {
          return c.json({
            error: '有策略按名字引用了「' + String(bean.name) + '」（观测项 #' + refs.join('、#')
              + '），改名会让策略失效。请先把那些策略改成按 id 引用或改掉名字。',
          }, 409)
        }
      }
      next.name = name
    }

    // ---- 介绍 ----
    if (body.description !== undefined) {
      const desc = String(body.description ?? '').trim()
      if (desc.length > 500) return c.json({ error: '介绍最长 500 字' }, 400)
      next.description = desc
    }

    // ---- 频率 / 超时 / 重试 ----
    if (body.interval !== undefined) {
      const v = asInt(body.interval)
      if (v === null || v < 20 || v > 86400) return c.json({ error: '检查频率要在 20–86400 秒之间' }, 400)
      next.interval = v
    }
    if (body.timeout !== undefined) {
      const v = asInt(body.timeout)
      if (v === null || v < 1 || v > 120) return c.json({ error: '超时要在 1–120 秒之间' }, 400)
      next.timeout = v
    }
    if (body.retryInterval !== undefined) {
      const v = asInt(body.retryInterval)
      if (v === null || v < 1 || v > 3600) return c.json({ error: '重试间隔要在 1–3600 秒之间' }, 400)
      next.retryInterval = v
    }
    if (body.maxretries !== undefined) {
      const v = asInt(body.maxretries)
      if (v === null || v < 0 || v > 10) return c.json({ error: '重试次数要在 0–10 之间' }, 400)
      next.maxretries = v
    }
    if (Number(next.timeout) >= Number(next.interval)) {
      return c.json({ error: '超时（' + next.timeout + 's）必须小于检查频率（' + next.interval + 's）' }, 400)
    }
    if (body.showMsg !== undefined) next.showMsg = body.showMsg === true || body.showMsg === 1

    // Kuma 的 toJSON 不返回 showMsg，而 editMonitor 是全量覆盖：
    // 不显式补上，Boolean(undefined) 会把 show_msg 静默改成 false。
    if (next.showMsg === undefined) {
      const page = await getStatusPage(false).catch(() => null)
      let hit: any = null
      for (const g of page?.publicGroupList || []) {
        hit = (g.monitorList || []).find((m: any) => Number(m.id) === id) || hit
      }
      next.showMsg = hit ? hit.showMsg === true : false
    }

    // ---- 归一化：editMonitor 会把这些原样 JSON.stringify 写库 ----
    next.accepted_statuscodes = Array.isArray(next.accepted_statuscodes) && next.accepted_statuscodes.length
      ? next.accepted_statuscodes.map((s: any) => String(s))
      : ['200-299']
    next.conditions = Array.isArray(next.conditions) ? next.conditions : []
    const pol = next.policyJson ?? next.policy_json
    if (pol === undefined || pol === null || pol === '') next.policyJson = null
    else if (typeof pol === 'object') next.policyJson = JSON.stringify(pol)
    else next.policyJson = String(pol)

    await editMonitor(next)
    invalidate()
    refreshSnapshot()

    const names: Record<string, string> = {}
    for (const k of Object.keys(beans)) names[k] = String(beans[k]?.name || '')
    if (names[String(id)]) names[String(id)] = String(next.name || '')
    return c.json({ ok: true, monitor: { ...toView(next, names), group: groupOf(id) } })
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, kumaErrorStatus(e))
  }
})

monitorsRoute.post('/:id/pause', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: '观测项 id 不合法' }, 400)
  if (!isJsonRequest(c)) return c.json({ error: '写操作必须用 application/json' }, 415)
  try {
    await getMonitor(id) // 先确认存在，避免把不存在的 id 当成功
    await pauseMonitor(id)
    invalidate()
    refreshSnapshot()
    return c.json({ ok: true, active: false })
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, kumaErrorStatus(e))
  }
})

monitorsRoute.post('/:id/resume', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: '观测项 id 不合法' }, 400)
  if (!isJsonRequest(c)) return c.json({ error: '写操作必须用 application/json' }, 415)
  try {
    await getMonitor(id)
    await resumeMonitor(id)
    invalidate()
    refreshSnapshot()
    return c.json({ ok: true, active: true })
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, kumaErrorStatus(e))
  }
})

monitorsRoute.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: '观测项 id 不合法' }, 400)
  // DELETE 是「非简单请求」，浏览器跨站表单发不出来，所以没有 body 时也允许；
  // 带了 body 就必须是 JSON。
  const ct = String(c.req.header('content-type') || '').toLowerCase()
  if (ct && !ct.includes('application/json')) return c.json({ error: '写操作必须用 application/json' }, 415)
  const confirm = String(c.req.query('confirm') || '').trim()
  try {
    const bean = await getMonitor(id)
    const name = String(bean.name || '').trim()
    if (confirm !== name) {
      return c.json({ error: '要删除必须把观测项名字原样输对（当前是「' + name + '」）' }, 400)
    }
    const backup = backupDb()
    await deleteMonitor(id)
    invalidate()
    refreshSnapshot()
    return c.json({ ok: true, backup })
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, kumaErrorStatus(e))
  }
})

/**
 * 立即观测：按配方（monitor-actions.json）逐步执行，失败即中止。
 * 一次请求跑完整套配方，逐步回显；暂停中的观测项直接拒绝——
 * 因为 kuma-check 走的 restartMonitor 会把 active 悄悄置回 1。
 */
monitorsRoute.post('/:id/check', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: '观测项 id 不合法' }, 400)
  if (!isJsonRequest(c)) return c.json({ error: '写操作必须用 application/json' }, 415)
  try {
    const bean = await getMonitor(id)
    const active = bean.active === true || bean.active === 1
    if (!active) return c.json({ error: '这个观测项已暂停，先恢复再立即观测' }, 400)

    const recipe = resolveAction({ id, name: String(bean.name || ''), type: String(bean.type || '') })
    if (recipe.disabledReason) return c.json({ error: recipe.disabledReason }, 400)

    const run = await runRecipe(id, recipe)
    invalidate()
    refreshSnapshot()

    const last = (await getBeats(id, 1).catch(() => [])).slice(-1)[0]
    return c.json({
      ok: run.ok,
      steps: run.steps,
      latest: last ? mapBeat(last) : null,
    })
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, kumaErrorStatus(e))
  }
})
