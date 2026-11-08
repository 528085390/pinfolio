import { Hono } from 'hono'
import type { DatabaseSync } from 'node:sqlite'
import { t } from '../i18n.js'
import { loadLinks, pickLink } from './links.js'
import { resolveAction } from './actions.js'
import { runRecipe } from './runner.js'
import { buildMonitorsPayload, mapBeat, BEAT_WINDOW } from './payload.js'
import { buildMonitorPatch } from './patch.js'
import { toView } from './redact.js'
import { backupPinboardDb, refreshMonitorSnapshot } from './backup.js'
import type { MonitorStore } from './store.js'
import type { MonitorEngine } from './engine.js'
import type { HeartbeatRow } from './types.js'

export function isJsonContentType(ct?: string | null): boolean {
  if (!ct) return false
  return ct.toLowerCase().includes('application/json')
}

export function kumaErrorStatus(e: any): 404 | 502 {
  const msg = String(e?.message || '')
  if (e?.code === 'notfound' || /not found|Cannot read properties of null|不存在|没找到/i.test(msg)) return 404
  return 502
}

export interface MonitorsRouteOptions {
  db: DatabaseSync
  store: MonitorStore
  engine: MonitorEngine
}

export interface PushRouteOptions {
  store: MonitorStore
  engine: MonitorEngine
}

export function createMonitorsRoute(options: MonitorsRouteOptions): Hono {
  const { db, store, engine } = options
  const app = new Hono()

  /* ---------------- GET /: 全部监控项列表 ---------------- */
  app.get('/', (c) => {
    try {
      const payload = buildMonitorsPayload(store)
      return c.json(payload)
    } catch (e: any) {
      return c.json({ error: t('读取观测项失败：{msg}', { msg: String(e?.message || e) }) }, 500)
    }
  })

  /* ---------------- GET /meta: 观测台元信息 ---------------- */
  // 必须排在 /:id 之前
  app.get('/meta', (c) => {
    return c.json({
      configured: true,
      flavor: 'fork',
      url: 'http://127.0.0.1:7788',
    })
  })

  /* ---------------- GET /:id: 单项详情 ---------------- */
  app.get('/:id', (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: t('观测项 id 不合法') }, 400)
    }

    const monitor = store.getMonitorById(id)
    if (!monitor) {
      return c.json({ error: t('观测项不存在') }, 404)
    }

    const all = store.getAllMonitors()
    const names: Record<string, string> = {}
    for (const m of all) names[String(m.id)] = m.name

    const rawBeatsDesc = store.getRecentHeartbeats(id, BEAT_WINDOW)
    const beats = [...rawBeatsDesc].reverse().map(mapBeat)
    const latest = beats.length ? beats[beats.length - 1] : null

    return c.json({
      monitor: { ...toView({ ...monitor, outboundMode: monitor.outbound_mode }, names), group: monitor.group_name },
      latest,
      beats,
      action: resolveAction({ id: monitor.id, name: monitor.name, type: monitor.type }),
      link: pickLink(loadLinks(), { id: monitor.id, name: monitor.name }),
    })
  })

  /* ---------------- PATCH /:id: 更新监控项 ---------------- */
  app.patch('/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: t('观测项 id 不合法') }, 400)
    }
    if (!isJsonContentType(c.req.header('content-type'))) {
      return c.json({ error: t('写操作必须用 application/json') }, 415)
    }

    let body: Record<string, unknown>
    try {
      body = (await c.req.json()) as Record<string, unknown>
    } catch {
      return c.json({ error: t('请求体不是合法 JSON') }, 400)
    }
    if (!body || typeof body !== 'object') {
      return c.json({ error: t('请求体不是合法 JSON') }, 400)
    }

    const monitor = store.getMonitorById(id)
    if (!monitor) {
      return c.json({ error: t('观测项不存在') }, 404)
    }

    const all = store.getAllMonitors()
    const allMap: Record<string, any> = {}
    const names: Record<string, string> = {}
    for (const m of all) {
      allMap[String(m.id)] = m
      names[String(m.id)] = m.name
    }

    const built = buildMonitorPatch(body, monitor, allMap)
    if ('error' in built) {
      return c.json({ error: built.error }, built.status)
    }

    const next = built.next
    store.updateMonitor(id, {
      name: next.name,
      description: next.description,
      interval: next.interval,
      timeout: next.timeout,
      maxretries: next.maxretries,
      outbound_mode: next.outboundMode === 'follow' ? null : next.outboundMode,
      policy_json: next.policyJson,
    })

    if (names[String(id)]) names[String(id)] = String(next.name || '')
    engine.refreshSchedule()
    refreshMonitorSnapshot(store)

    const updated = store.getMonitorById(id)
    return c.json({
      ok: true,
      monitor: { ...toView({ ...updated, outboundMode: updated?.outbound_mode }, names), group: next.group_name || monitor.group_name },
    })
  })

  /* ---------------- POST /:id/pause: 暂停监控项 ---------------- */
  app.post('/:id/pause', (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: t('观测项 id 不合法') }, 400)
    }
    const ct = c.req.header('content-type')
    if (ct && !isJsonContentType(ct)) {
      return c.json({ error: t('写操作必须用 application/json') }, 415)
    }

    const monitor = store.getMonitorById(id)
    if (!monitor) {
      return c.json({ error: t('观测项不存在') }, 404)
    }

    store.updateMonitor(id, { active: 0 })
    engine.cancelSchedule(id)
    refreshMonitorSnapshot(store)
    return c.json({ ok: true, active: false })
  })

  /* ---------------- POST /:id/resume: 恢复监控项 ---------------- */
  app.post('/:id/resume', (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: t('观测项 id 不合法') }, 400)
    }
    const ct = c.req.header('content-type')
    if (ct && !isJsonContentType(ct)) {
      return c.json({ error: t('写操作必须用 application/json') }, 415)
    }

    const monitor = store.getMonitorById(id)
    if (!monitor) {
      return c.json({ error: t('观测项不存在') }, 404)
    }

    store.updateMonitor(id, { active: 1 })
    engine.scheduleMonitor(id)
    refreshMonitorSnapshot(store)
    return c.json({ ok: true, active: true })
  })

  /* ---------------- DELETE /:id: 删除监控项 ---------------- */
  app.delete('/:id', (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: t('观测项 id 不合法') }, 400)
    }
    const ct = c.req.header('content-type')
    if (ct && !isJsonContentType(ct)) {
      return c.json({ error: t('写操作必须用 application/json') }, 415)
    }

    const monitor = store.getMonitorById(id)
    if (!monitor) {
      return c.json({ error: t('观测项不存在') }, 404)
    }

    const confirm = String(c.req.query('confirm') || '').trim()
    const name = String(monitor.name || '').trim()
    if (confirm !== name) {
      return c.json({ error: t('要删除必须把观测项名字原样输对（当前是「{name}」）', { name }) }, 400)
    }

    const backup = backupPinboardDb(db)
    store.deleteMonitor(id)
    engine.cancelSchedule(id)
    refreshMonitorSnapshot(store)
    return c.json({ ok: true, backup })
  })

  /* ---------------- POST /:id/check & /:id/beat: 立即观测 ---------------- */
  const checkHandler = async (c: any) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: t('观测项 id 不合法') }, 400)
    }
    const ct = c.req.header('content-type')
    if (ct && !isJsonContentType(ct)) {
      return c.json({ error: t('写操作必须用 application/json') }, 415)
    }

    const monitor = store.getMonitorById(id)
    if (!monitor) {
      return c.json({ error: t('观测项不存在') }, 404)
    }

    if (!monitor.active) {
      return c.json({ error: t('这个观测项已暂停，先恢复再立即观测') }, 400)
    }

    const recipe = resolveAction({ id, name: monitor.name, type: monitor.type })
    if (recipe.disabledReason) {
      return c.json({ error: recipe.disabledReason }, 400)
    }

    const run = await runRecipe(id, recipe, engine)
    refreshMonitorSnapshot(store)

    const last = store.getLatestHeartbeat(id)
    return c.json({
      ok: run.ok,
      steps: run.steps,
      latest: last ? mapBeat(last) : null,
    })
  }

  app.post('/:id/check', checkHandler)
  app.post('/:id/beat', checkHandler)

  return app
}

export function createPushRoute(options: PushRouteOptions): Hono {
  const { store, engine } = options
  const app = new Hono()

  const pushHandler = async (c: any) => {
    const token = String(c.req.param('token') || '').trim()
    if (!token) {
      return c.json({ ok: false, msg: 'Monitor not found' }, 404)
    }

    const monitor = store.getMonitorByPushTokenOrId(token)
    if (!monitor) {
      return c.json({ ok: false, msg: 'Monitor not found' }, 404)
    }

    // Extract query params
    let msgParam = c.req.query('msg')
    let statusParam = c.req.query('status')
    let pingParam = c.req.query('ping')

    // If POST and body exists
    if (c.req.method === 'POST') {
      const ct = (c.req.header('content-type') || '').toLowerCase()
      if (ct.includes('application/json')) {
        try {
          const body = await c.req.json()
          if (body && typeof body === 'object') {
            if (msgParam === undefined && (body.msg !== undefined || body.message !== undefined)) {
              msgParam = String(body.msg ?? body.message)
            }
            if (statusParam === undefined && body.status !== undefined) {
              statusParam = String(body.status)
            }
            if (pingParam === undefined && body.ping !== undefined) {
              pingParam = String(body.ping)
            }
          }
        } catch {
          // ignore json parse error
        }
      } else {
        const text = await c.req.text().catch(() => '')
        if (text && msgParam === undefined) {
          msgParam = text.trim()
        }
      }
    }

    // Determine status (1 = UP, 0 = DOWN)
    let status = 1
    if (statusParam !== undefined) {
      const s = String(statusParam).toLowerCase().trim()
      if (s === '0' || s === 'down' || s === 'fail' || s === 'error') {
        status = 0
      } else if (s === '1' || s === 'up' || s === 'ok' || s === 'success') {
        status = 1
      }
    }

    const pingNum = Number.isFinite(Number(pingParam)) ? Number(pingParam) : null
    const msgText = String(msgParam !== undefined ? msgParam : 'OK').trim()

    // Calculate downCount
    const prevBeat = store.getLatestHeartbeat(monitor.id)
    const downCount =
      status === 1
        ? 0
        : (prevBeat && (prevBeat.status === 0 || prevBeat.status === 2)
            ? prevBeat.down_count
            : 0) + 1

    const beat: Omit<HeartbeatRow, 'id'> = {
      monitor_id: monitor.id,
      status,
      ping: pingNum,
      msg: msgText,
      time: new Date().toISOString(),
      duration: pingNum ?? 0,
      down_count: downCount,
    }

    const beatId = store.recordHeartbeat(beat)
    engine.notifyBeat(monitor.id, { id: beatId, ...beat })

    return c.json({ ok: true, msg: 'Heartbeat recorded' })
  }

  app.get('/:token', pushHandler)
  app.post('/:token', pushHandler)

  return app
}
