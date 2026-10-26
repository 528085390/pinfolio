import { Hono, type Context } from 'hono'
import { isJsonContentType } from '../kuma/http.js'
import {
  addDeploy,
  addServer,
  addService,
  mergeMonitorNames,
  patchDeploy,
  patchServer,
  patchService,
  removeDeploy,
  removeServer,
  removeService,
  type EditResult,
} from './edit.js'
import { loadServices, saveServices } from './store.js'
import { t } from '../i18n.js'

// 服务栏：读 + 写 data/services.json。
// GET 把文件解析后整份返回；写接口每次都返回整份 payload，前端拿到直接替换，不用再拉一次。
// 这一栏不探测：写接口只动文件，不碰 Kuma。
export const servicesRoute = new Hono()

servicesRoute.get('/', (c) => c.json(loadServices()))

/** 写接口统一收口：状态码按错误文案前缀分（没有…=404，已经有…=409，其余 400）。 */
function done(c: Context, r: EditResult, monitorNames?: unknown) {
  if (!r.ok) {
    const code: 400 | 404 | 409 = r.error.startsWith(t('没有')) ? 404 : r.error.startsWith(t('已经有')) ? 409 : 400
    return c.json({ error: r.error }, code)
  }
  return c.json(saveServices(monitorNames === undefined ? r.data : mergeMonitorNames(r.data, monitorNames)))
}

/** 写操作只收 application/json（跨站表单发不出这个 Content-Type，挡掉 CSRF）。 */
async function bodyOf(c: Context): Promise<Record<string, unknown> | null> {
  if (!isJsonContentType(c.req.header('content-type'))) return null
  const body: any = await c.req.json().catch(() => ({}))
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {}
}

/** 删除要手输 id 确认（沿用主机页的规矩）：confirm 就是那个 id。 */
function confirmed(c: Context, id: string): boolean {
  const confirm = (c.req.query('confirm') || '').trim().toLowerCase()
  return !!confirm && confirm === id.trim().toLowerCase()
}

/** 路径参数里的 key 可能带 %3A（部署 key 是 server:service），解一层保险。 */
function param(c: Context, name: string): string {
  const raw = c.req.param(name) || ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

// ---------- 服务器 ----------

servicesRoute.post('/servers', async (c) => {
  const body = await bodyOf(c)
  if (!body) return c.json({ error: t('需要 application/json') }, 415)
  return done(c, addServer(loadServices(), body), body.monitorNames)
})

servicesRoute.patch('/servers/:id', async (c) => {
  const body = await bodyOf(c)
  if (!body) return c.json({ error: t('需要 application/json') }, 415)
  return done(c, patchServer(loadServices(), param(c, 'id'), body), body.monitorNames)
})

servicesRoute.delete('/servers/:id', (c) => {
  const id = param(c, 'id')
  if (!confirmed(c, id)) return c.json({ error: t('要手输服务器 id（{id}）确认删除', { id }) }, 400)
  return done(c, removeServer(loadServices(), id))
})

// ---------- 服务（JSON 里的 services 段；路径用 catalog 避开 /services/services） ----------

servicesRoute.post('/catalog', async (c) => {
  const body = await bodyOf(c)
  if (!body) return c.json({ error: t('需要 application/json') }, 415)
  return done(c, addService(loadServices(), body))
})

servicesRoute.patch('/catalog/:id', async (c) => {
  const body = await bodyOf(c)
  if (!body) return c.json({ error: t('需要 application/json') }, 415)
  return done(c, patchService(loadServices(), param(c, 'id'), body))
})

servicesRoute.delete('/catalog/:id', (c) => {
  const id = param(c, 'id')
  if (!confirmed(c, id)) return c.json({ error: t('要手输服务 id（{id}）确认删除', { id }) }, 400)
  return done(c, removeService(loadServices(), id))
})

// ---------- 部署（key = server:service） ----------

servicesRoute.post('/deploys', async (c) => {
  const body = await bodyOf(c)
  if (!body) return c.json({ error: t('需要 application/json') }, 415)
  return done(c, addDeploy(loadServices(), body), body.monitorNames)
})

servicesRoute.patch('/deploys/:key', async (c) => {
  const body = await bodyOf(c)
  if (!body) return c.json({ error: t('需要 application/json') }, 415)
  return done(c, patchDeploy(loadServices(), param(c, 'key'), body), body.monitorNames)
})

servicesRoute.delete('/deploys/:key', (c) => {
  const key = param(c, 'key')
  if (!confirmed(c, key)) return c.json({ error: t('要手输部署（{key}）确认删除', { key }) }, 400)
  return done(c, removeDeploy(loadServices(), key))
})
