import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { initMonitorTables, MonitorStore } from '../../server/monitor/store.ts'
import { MonitorEngine } from '../../server/monitor/engine.ts'
import { createMonitorsRoute, createPushRoute } from '../../server/monitor/routes.ts'
import { isPublic } from '../../server/auth/middleware.ts'
import type { ProbeResult } from '../../server/monitor/types.ts'

function setupTestEnv() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  initMonitorTables(db)
  const store = new MonitorStore(db)

  // Mock engine with controllable probeNow and tracking of notifyBeat / cancels
  let probedId: number | null = null
  let notifiedBeat: any = null
  let cancelledId: number | null = null
  let scheduledId: number | null = null

  const engine = {
    async probeNow(id: number): Promise<ProbeResult> {
      probedId = id
      const m = store.getMonitorById(id)
      if (!m) return { status: 0, ping: null, msg: 'Not found' }
      return { status: 1, ping: 42, msg: 'OK 200' }
    },
    notifyBeat(id: number, beat: any) {
      notifiedBeat = { id, beat }
    },
    cancelSchedule(id: number) {
      cancelledId = id
    },
    scheduleMonitor(id: number) {
      scheduledId = id
    },
    refreshSchedule() {},
    start() {},
    stop() {},
  } as unknown as MonitorEngine

  const monitorsRoute = createMonitorsRoute({ db, store, engine })
  const pushRoute = createPushRoute({ store, engine })

  const app = new Hono()
  app.route('/api/monitors', monitorsRoute)
  app.route('/api/push', pushRoute)

  return {
    db,
    store,
    engine,
    app,
    getProbedId: () => probedId,
    getNotifiedBeat: () => notifiedBeat,
    getCancelledId: () => cancelledId,
    getScheduledId: () => scheduledId,
  }
}

test('GET /api/monitors/meta: returns configured: true, flavor: fork, url: http://127.0.0.1:7788', async () => {
  const { app } = setupTestEnv()
  const res = await app.request('/api/monitors/meta')
  assert.equal(res.status, 200)
  const json = await res.json()
  assert.deepEqual(json, {
    configured: true,
    flavor: 'fork',
    url: 'http://127.0.0.1:7788',
  })
})

test('GET /api/monitors: returns MonitorsPayload format with groups, summary, quick and monitors', async () => {
  const { app, store } = setupTestEnv()

  // Insert two monitors in different groups
  const id1 = store.insertMonitor({
    name: 'WorkBuddy 网关 API',
    type: 'http',
    group_name: '本机',
    url: 'http://127.0.0.1:7863',
    active: 1,
    interval: 60,
  })
  const id2 = store.insertMonitor({
    name: 'oj / Xray 代理服务',
    type: 'ssh',
    group_name: 'oj (Oracle · 东京)',
    hostname: '1.2.3.4',
    port: 22,
    active: 1,
    interval: 60,
  })

  // Insert heartbeats
  store.recordHeartbeat({
    monitor_id: id1,
    status: 1,
    ping: 25,
    msg: 'HTTP 200 OK',
    time: new Date().toISOString(),
    duration: 25,
    down_count: 0,
  })
  store.recordHeartbeat({
    monitor_id: id2,
    status: 0,
    ping: null,
    msg: 'Connection refused',
    time: new Date().toISOString(),
    duration: 0,
    down_count: 1,
  })

  const res = await app.request('/api/monitors')
  assert.equal(res.status, 200)
  const data = await res.json()

  assert.equal(data.kuma.title, '观测台')
  assert.equal(data.kuma.base, 'http://127.0.0.1:7788')
  assert.equal(data.summary.total, 2)
  assert.equal(data.summary.up, 1)
  assert.equal(data.summary.down, 1)
  assert.equal(data.summary.pending, 0)
  assert.equal(data.summary.uptime24, 0.5)

  assert.equal(data.groups.length, 2)
  assert.equal(data.groups[0].name, '本机')
  assert.equal(data.groups[0].monitors.length, 1)
  assert.equal(data.groups[0].monitors[0].id, id1)
  assert.equal(data.groups[0].monitors[0].status, 1)
  assert.equal(data.groups[0].monitors[0].ping, 25)

  assert.equal(data.groups[1].name, 'oj (Oracle · 东京)')
  assert.equal(data.groups[1].monitors.length, 1)
  assert.equal(data.groups[1].monitors[0].id, id2)
  assert.equal(data.groups[1].monitors[0].status, 0)
})

test('GET /api/monitors/:id: returns MonitorDetail with latest beat, recent beats, action, and link', async () => {
  const { app, store } = setupTestEnv()
  const id = store.insertMonitor({
    name: 'WorkBuddy 网关 API',
    type: 'http',
    group_name: '本机',
    url: 'http://127.0.0.1:7863',
    active: 1,
    interval: 60,
    timeout: 20,
    maxretries: 2,
    description: '网关健康检查',
  })

  store.recordHeartbeat({
    monitor_id: id,
    status: 1,
    ping: 30,
    msg: 'OK',
    time: '2026-11-06T10:00:00.000Z',
    duration: 30,
    down_count: 0,
  })

  // Valid id
  const res = await app.request(`/api/monitors/${id}`)
  assert.equal(res.status, 200)
  const detail = await res.json()

  assert.equal(detail.monitor.id, id)
  assert.equal(detail.monitor.name, 'WorkBuddy 网关 API')
  assert.equal(detail.monitor.group, '本机')
  assert.equal(detail.monitor.timeout, 20)
  assert.equal(detail.monitor.maxretries, 2)
  assert.equal(detail.latest?.status, 1)
  assert.equal(detail.latest?.ping, 30)
  assert.ok(Array.isArray(detail.beats))
  assert.equal(detail.beats.length, 1)
  assert.equal(detail.action.source, 'default')

  // Non-existent id
  const notFound = await app.request('/api/monitors/99999')
  assert.equal(notFound.status, 404)
})

test('PATCH /api/monitors/:id: updates fields and validates constraints', async () => {
  const { app, store } = setupTestEnv()
  const id = store.insertMonitor({
    name: 'Old Name',
    type: 'http',
    group_name: '本机',
    url: 'http://127.0.0.1:8080',
    active: 1,
    interval: 60,
    timeout: 20,
  })

  // Valid patch
  const patchRes = await app.request(`/api/monitors/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'New Name',
      interval: 120,
      timeout: 30,
      maxretries: 3,
      description: 'Updated description',
      outboundMode: 'proxy',
    }),
  })
  assert.equal(patchRes.status, 200)
  const patchData = await patchRes.json()
  assert.equal(patchData.ok, true)
  assert.equal(patchData.monitor.name, 'New Name')

  const updated = store.getMonitorById(id)!
  assert.equal(updated.name, 'New Name')
  assert.equal(updated.interval, 120)
  assert.equal(updated.timeout, 30)
  assert.equal(updated.maxretries, 3)
  assert.equal(updated.description, 'Updated description')
  assert.equal(updated.outbound_mode, 'proxy')

  // Invalid patch: timeout >= interval
  const invalidRes = await app.request(`/api/monitors/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      interval: 30,
      timeout: 30,
    }),
  })
  assert.equal(invalidRes.status, 400)
  const invalidData = await invalidRes.json()
  assert.match(invalidData.error, /超时.*必须小于检查频率/)
})

test('POST /api/monitors/:id/pause and /resume: toggles active status and notifies engine', async () => {
  const { app, store, getCancelledId, getScheduledId } = setupTestEnv()
  const id = store.insertMonitor({
    name: 'Pause Resume Monitor',
    type: 'http',
    active: 1,
  })

  // Pause
  const pauseRes = await app.request(`/api/monitors/${id}/pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(pauseRes.status, 200)
  const pauseData = await pauseRes.json()
  assert.equal(pauseData.ok, true)
  assert.equal(pauseData.active, false)
  assert.equal(store.getMonitorById(id)?.active, 0)
  assert.equal(getCancelledId(), id)

  // Resume
  const resumeRes = await app.request(`/api/monitors/${id}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(resumeRes.status, 200)
  const resumeData = await resumeRes.json()
  assert.equal(resumeData.ok, true)
  assert.equal(resumeData.active, true)
  assert.equal(store.getMonitorById(id)?.active, 1)
  assert.equal(getScheduledId(), id)
})

test('DELETE /api/monitors/:id: verifies confirmation name, backs up, and cascades delete', async () => {
  const { app, store } = setupTestEnv()
  const id = store.insertMonitor({
    name: 'Delete Target',
    type: 'http',
    active: 1,
  })
  store.recordHeartbeat({
    monitor_id: id,
    status: 1,
    ping: null,
    time: new Date().toISOString(),
    duration: 10,
    msg: 'ok',
    down_count: 0,
  })

  // Mismatched confirm name -> 400
  const badConfirm = await app.request(`/api/monitors/${id}?confirm=WrongName`, {
    method: 'DELETE',
  })
  assert.equal(badConfirm.status, 400)
  assert.ok(store.getMonitorById(id))

  // Correct confirm name -> 200
  const goodConfirm = await app.request(`/api/monitors/${id}?confirm=Delete%20Target`, {
    method: 'DELETE',
  })
  assert.equal(goodConfirm.status, 200)
  const resData = await goodConfirm.json()
  assert.equal(resData.ok, true)
  assert.equal(store.getMonitorById(id), null)
  assert.equal(store.getRecentHeartbeats(id).length, 0)
})

test('POST /api/monitors/:id/check & /beat: executes recipe and directly calls engine.probeNow(id)', async () => {
  const { app, store, getProbedId } = setupTestEnv()
  const id = store.insertMonitor({
    name: 'Check Target',
    type: 'http',
    active: 1,
  })

  // /check route
  const res = await app.request(`/api/monitors/${id}/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.ok, true)
  assert.equal(getProbedId(), id)
  assert.equal(data.steps.length, 1)
  assert.equal(data.steps[0].type, 'kuma-check')
  assert.equal(data.steps[0].ok, true)

  // /beat alias route
  const beatRes = await app.request(`/api/monitors/${id}/beat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(beatRes.status, 200)
  const beatData = await beatRes.json()
  assert.equal(beatData.ok, true)

  // Paused monitor should reject check
  store.updateMonitor(id, { active: 0 })
  const pausedRes = await app.request(`/api/monitors/${id}/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(pausedRes.status, 400)
  const pausedData = await pausedRes.json()
  assert.match(pausedData.error, /已暂停/)
})

test('GET & POST /api/push/:token: records heartbeat for push token or push monitor id', async () => {
  const { app, store, getNotifiedBeat } = setupTestEnv()

  // 1. Push monitor with push_token
  const idWithToken = store.insertMonitor({
    name: 'Push With Token',
    type: 'push',
    push_token: 'secret-token-123',
    active: 1,
  })

  // 2. Push monitor matching id
  const idAsToken = store.insertMonitor({
    id: 987,
    name: 'Push By ID',
    type: 'push',
    push_token: null,
    active: 1,
  })

  // Not found
  const notFound = await app.request('/api/push/unknown-token')
  assert.equal(notFound.status, 404)
  const notFoundJson = await notFound.json()
  assert.equal(notFoundJson.ok, false)

  // Push by token via GET
  const getPush = await app.request('/api/push/secret-token-123?status=up&msg=FromGet&ping=33')
  assert.equal(getPush.status, 200)
  const getPushJson = await getPush.json()
  assert.equal(getPushJson.ok, true)

  const beats1 = store.getRecentHeartbeats(idWithToken)
  assert.equal(beats1.length, 1)
  assert.equal(beats1[0].status, 1)
  assert.equal(beats1[0].msg, 'FromGet')
  assert.equal(beats1[0].ping, 33)
  assert.equal(getNotifiedBeat()?.id, idWithToken)

  // Push by ID via POST with JSON body
  const postPush = await app.request('/api/push/987', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'down',
      msg: 'Job failed',
      ping: 15,
    }),
  })
  assert.equal(postPush.status, 200)
  const postPushJson = await postPush.json()
  assert.equal(postPushJson.ok, true)

  const beats2 = store.getRecentHeartbeats(idAsToken)
  assert.equal(beats2.length, 1)
  assert.equal(beats2[0].status, 0)
  assert.equal(beats2[0].msg, 'Job failed')
  assert.equal(beats2[0].ping, 15)
  assert.equal(beats2[0].down_count, 1)
  assert.equal(getNotifiedBeat()?.id, idAsToken)
})

test('Auth middleware isPublic: exempts /api/push/* from authentication', () => {
  assert.equal(isPublic('GET', '/api/push/secret-token-123'), true)
  assert.equal(isPublic('POST', '/api/push/987'), true)
  assert.equal(isPublic('GET', '/api/push/'), true)
  assert.equal(isPublic('GET', '/api/monitors'), false)
  assert.equal(isPublic('POST', '/api/monitors/1/check'), false)
})
