import { Hono } from 'hono'
import { t } from '../i18n.js'
import {
  deleteMonitor, editMonitor, getBeats, getMonitor, listMonitors, pauseMonitor, resumeMonitor, toView,
} from './client.js'
import { resolveAction, runRecipe } from './actions.js'
import { loadLinks, pickLink } from './links.js'
import { BEAT_WINDOW, collectCached, getStatusPage, groupOf, invalidate, lastPayload, mapBeat } from './feed.js'
import { backupDb, refreshSnapshot } from './backup.js'
import { isJsonContentType, kumaErrorStatus } from './http.js'
import { buildMonitorPatch } from './patch.js'
import { kumaMeta } from './meta.js'

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
    if (stale) return c.json({ ...stale, stale: true, error: t('读不到 Kuma：{msg}', { msg: String(e?.message || e) }) })
    // 压根没接 Kuma：给空列表而不是 502 —— 页面本来就会渲染引导卡（见 /meta），
    // 后台的异常通知轮询每 30 秒来一次，回 502 只会让浏览器控制台一直刷「Failed to load resource」。
    // 放在 catch 里是刻意的：接上了的实例走上面的快路径，不为此多付一次探测。
    const meta = await kumaMeta().catch(() => null)
    if (meta && !meta.configured) {
      return c.json({
        kuma: { base: meta.url || '', slug: '', title: t('观测台') },
        updatedAt: new Date().toISOString(),
        summary: { total: 0, up: 0, down: 0, pending: 0, uptime24: null },
        groups: [],
        quick: [],
        configured: false,
      })
    }
    return c.json({ error: t('读不到 Kuma 状态页：{msg}', { msg: String(e?.message || e) }) }, 502)
  }
})

/* ---------------- 连的是哪个 Kuma / 到底配没配（界面靠它决定渲染什么） ---------------- */

// 必须排在 '/:id' 之前：Hono 按注册顺序匹配，否则 'meta' 会被当成 id 走详情分支。
monitorsRoute.get('/meta', async (c) => {
  try {
    return c.json(await kumaMeta())
  } catch (e: any) {
    // 探测失败不该让整个观测页崩：按「配了但连不上」回，页面照旧走原来的错误分支
    return c.json({ configured: true, flavor: 'upstream', url: '', error: String(e?.message || e) })
  }
})

/* ---------------- 单个观测项：详情 / 改名 / 暂停 / 删除 / 立即观测 ---------------- */

monitorsRoute.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: t('观测项 id 不合法') }, 400)
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

/**
 * 从状态页补 showMsg：Kuma 的 toJSON 不返回它，而 editMonitor 是全量覆盖，
 * 不显式补上，Boolean(undefined) 会把 show_msg 静默改成 false。
 */
async function showMsgFromPage(id: number): Promise<boolean> {
  const page = await getStatusPage(false).catch(() => null)
  let hit: any = null
  for (const g of page?.publicGroupList || []) {
    hit = (g.monitorList || []).find((m: any) => Number(m.id) === id) || hit
  }
  return hit ? hit.showMsg === true : false
}

monitorsRoute.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: t('观测项 id 不合法') }, 400)
  if (!isJsonContentType(c.req.header('content-type'))) return c.json({ error: t('写操作必须用 application/json') }, 415)
  let body: Record<string, unknown>
  try {
    body = (await c.req.json()) as Record<string, unknown>
  } catch {
    return c.json({ error: t('请求体不是合法 JSON') }, 400)
  }
  if (!body || typeof body !== 'object') return c.json({ error: t('请求体不是合法 JSON') }, 400)

  try {
    const bean = await getMonitor(id)
    const beans = await listMonitors().catch(() => ({}) as Record<string, any>)

    // 校验 + 归一化都在 patch.ts（纯函数，有单测）；这里只管取数、补 showMsg、写回
    const built = buildMonitorPatch(body, bean, beans)
    if ('error' in built) return c.json({ error: built.error }, built.status)
    const next = built.next
    if (next.showMsg === undefined) next.showMsg = await showMsgFromPage(id)

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
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: t('观测项 id 不合法') }, 400)
  if (!isJsonContentType(c.req.header('content-type'))) return c.json({ error: t('写操作必须用 application/json') }, 415)
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
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: t('观测项 id 不合法') }, 400)
  if (!isJsonContentType(c.req.header('content-type'))) return c.json({ error: t('写操作必须用 application/json') }, 415)
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
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: t('观测项 id 不合法') }, 400)
  // DELETE 是「非简单请求」，浏览器跨站表单发不出来，所以没有 body 时也允许；
  // 带了 body 就必须是 JSON。
  const ct = c.req.header('content-type')
  if (ct && !isJsonContentType(ct)) return c.json({ error: t('写操作必须用 application/json') }, 415)
  const confirm = String(c.req.query('confirm') || '').trim()
  try {
    const bean = await getMonitor(id)
    const name = String(bean.name || '').trim()
    if (confirm !== name) {
      return c.json({ error: t('要删除必须把观测项名字原样输对（当前是「{name}」）', { name }) }, 400)
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
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: t('观测项 id 不合法') }, 400)
  if (!isJsonContentType(c.req.header('content-type'))) return c.json({ error: t('写操作必须用 application/json') }, 415)
  try {
    const bean = await getMonitor(id)
    const active = bean.active === true || bean.active === 1
    if (!active) return c.json({ error: t('这个观测项已暂停，先恢复再立即观测') }, 400)

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
