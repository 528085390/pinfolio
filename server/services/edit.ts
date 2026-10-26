/**
 * 服务栏的增删改（纯函数，单测在 tests/unit/services-edit.test.mts）。
 *
 * 页面上的每一次编辑最后都落到 data/services.json 这一份文件上：
 * 这里只做「校验 + 改对象」，写盘（备份 + tmp+rename）在 store.ts，HTTP 状态码在 routes.ts。
 * 统一返回 { ok: true, data } 或 { ok: false, error: '一句中文' }——错误文案直接给用户看，
 * 所以写成整句（「「wb-server2」上还有 3 条部署…，先删它们」），不要「invalid input」这种。
 */
import { isHttpUrl } from '../kuma/quick.js'
import {
  DEPLOY_KINDS,
  MAX_DEPLOYS,
  MAX_SERVERS,
  MAX_SERVICES,
  type DeployKind,
  type DeployRec,
  type ServerRec,
  type ServiceRec,
  type ServicesData,
} from './parse.js'

export type EditResult = { ok: true; data: ServicesData } | { ok: false; error: string }

// 与 parse.ts 的长度上限保持一致：编辑时截断，解析时也截断，来回改不会越写越长
const LEN = {
  id: 32,
  name: 60,
  vendor: 60,
  ip: 60,
  user: 60,
  note: 200,
  doc: 300,
  path: 300,
  runtime: 120,
  port: 40,
  label: 60,
} as const

/** id 是行 key 与卡片锚点（svc-card-srv-<id>）的一部分：小写开头，只含字母数字点下划线短横线。 */
export const ID_RE = /^[a-z0-9][a-z0-9._-]*$/

const ok = (data: ServicesData): EditResult => ({ ok: true, data })
const fail = (error: string): EditResult => ({ ok: false, error })

/** 取一段文本：数字也收（端口常被写成 7863 这种数字），其余类型当没填。 */
function txt(v: unknown, max: number): string {
  if (typeof v === 'string') return v.trim().slice(0, max)
  if (typeof v === 'number' && Number.isFinite(v)) return String(v).slice(0, max)
  return ''
}

/** PATCH 语义：body 里显式给了这个键（哪怕是空串）才改，没给就保留原值。 */
function has(b: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(b, key) && b[key] !== undefined
}

function obj(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {}
}

/** 读 id：一律转小写（Sv 与 sv 看着一样，留两条只会互相打架）。 */
function readId(raw: unknown): { id: string } | { error: string } {
  const id = txt(raw, LEN.id).toLowerCase()
  if (!id) return { error: 'id 不能为空' }
  if (!ID_RE.test(id)) return { error: 'id 只能用字母、数字、点、下划线、短横线，并以字母或数字开头：' + id }
  return { id }
}

function readName(raw: unknown, what: string): { name: string } | { error: string } {
  const name = txt(raw, LEN.name)
  if (!name) return { error: what + '要填名字' }
  return { name }
}

/** 观测项 id：正整数数组，去重排序（同一份数据每次渲染顺序都一致）。 */
export function readMonitors(raw: unknown): { ids: number[] } | { error: string } {
  if (raw === undefined || raw === null) return { ids: [] }
  if (!Array.isArray(raw)) return { error: '观测项要写成数组（例如 [1, 2]）' }
  const out = new Set<number>()
  for (const v of raw) {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.trim()) : NaN
    if (!Number.isInteger(n) || n <= 0) return { error: '观测项 id 只能是正整数：' + String(v) }
    out.add(n)
  }
  return { ids: [...out].sort((a, b) => a - b) }
}

/** 管理页：空就表示没有；给了就必须是 http(s)，否则手滑写 javascript: 会变成可点的链接。 */
function readUrl(raw: unknown): { url?: string } | { error: string } {
  const url = txt(raw, 500)
  if (!url) return { url: undefined }
  if (!isHttpUrl(url)) return { error: '管理页要写 http:// 或 https:// 开头的地址' }
  return { url }
}

function readKind(raw: unknown, fallback: DeployKind): { kind: DeployKind } | { error: string } {
  const raw2 = txt(raw, 20)
  if (!raw2) return { kind: fallback }
  const kind = raw2 as DeployKind
  if (!DEPLOY_KINDS.includes(kind)) return { error: '种类只能是 ' + DEPLOY_KINDS.join(' / ') }
  return { kind }
}

function nameOfService(data: ServicesData, id: string): string {
  return data.services.find((s) => s.id === id)?.name || id
}

function nameOfServer(data: ServicesData, id: string): string {
  return data.servers.find((s) => s.id === id)?.name || id
}

/** 列表里前几条名字 + 「等」，错误文案里给用户看清是哪几条挡着。 */
function listNames(names: string[]): string {
  const head = names.slice(0, 4).join('、')
  return names.length > 4 ? head + ' 等 ' + names.length + ' 条' : head
}

// ---------- 服务器 ----------

export function addServer(data: ServicesData, input: unknown): EditResult {
  const b = obj(input)
  const idr = readId(b.id)
  if ('error' in idr) return fail(idr.error)
  if (data.servers.length >= MAX_SERVERS) return fail('服务器最多 ' + MAX_SERVERS + ' 台')
  if (data.servers.some((s) => s.id.toLowerCase() === idr.id)) return fail('已经有这台服务器：' + idr.id)
  const name = readName(b.name, '服务器')
  if ('error' in name) return fail(name.error)
  const mon = readMonitors(b.monitors)
  if ('error' in mon) return fail(mon.error)
  const rec: ServerRec = {
    id: idr.id,
    name: name.name,
    vendor: txt(b.vendor, LEN.vendor),
    ip: txt(b.ip, LEN.ip),
    user: txt(b.user, LEN.user),
    note: txt(b.note, LEN.note) || undefined,
    doc: txt(b.doc, LEN.doc) || undefined,
    monitors: mon.ids,
  }
  return ok({ ...data, servers: [...data.servers, rec] })
}

export function patchServer(data: ServicesData, id: string, patch: unknown): EditResult {
  const b = obj(patch)
  const want = txt(id, LEN.id).toLowerCase()
  const at = data.servers.findIndex((s) => s.id.toLowerCase() === want)
  if (at < 0) return fail('没有这台服务器：' + id)
  const cur = data.servers[at]
  const next: ServerRec = { ...cur }
  if (has(b, 'id')) {
    const idr = readId(b.id)
    if ('error' in idr) return fail(idr.error)
    if (idr.id !== cur.id && data.servers.some((s, i) => i !== at && s.id.toLowerCase() === idr.id)) {
      return fail('已经有这台服务器：' + idr.id)
    }
    next.id = idr.id
  }
  if (has(b, 'name')) {
    const name = readName(b.name, '服务器')
    if ('error' in name) return fail(name.error)
    next.name = name.name
  }
  if (has(b, 'vendor')) next.vendor = txt(b.vendor, LEN.vendor)
  if (has(b, 'ip')) next.ip = txt(b.ip, LEN.ip)
  if (has(b, 'user')) next.user = txt(b.user, LEN.user)
  if (has(b, 'note')) next.note = txt(b.note, LEN.note) || undefined
  if (has(b, 'doc')) next.doc = txt(b.doc, LEN.doc) || undefined
  if (has(b, 'monitors')) {
    const mon = readMonitors(b.monitors)
    if ('error' in mon) return fail(mon.error)
    next.monitors = mon.ids
  }
  const servers = data.servers.slice()
  servers[at] = next
  // 改了 id 就把部署指过去，否则那些行会指向一个不存在的服务器（parse 会整条丢掉）
  const deploys = next.id === cur.id
    ? data.deploys
    : data.deploys.map((d) => (d.server.toLowerCase() === cur.id.toLowerCase() ? { ...d, server: next.id } : d))
  return ok({ ...data, servers, deploys })
}

export function removeServer(data: ServicesData, id: string): EditResult {
  const want = txt(id, LEN.id).toLowerCase()
  const srv = data.servers.find((s) => s.id.toLowerCase() === want)
  if (!srv) return fail('没有这台服务器：' + id)
  // 不连带删部署：删错一台机不该把几十条部署一起带走，让用户自己一条条删
  const used = data.deploys.filter((d) => d.server.toLowerCase() === srv.id.toLowerCase())
  if (used.length) {
    return fail('「' + srv.name + '」上还有 ' + used.length + ' 条部署（' + listNames(used.map((d) => nameOfService(data, d.service))) + '），先删它们再删服务器')
  }
  return ok({ ...data, servers: data.servers.filter((s) => s !== srv) })
}

// ---------- 服务（JSON 里的 services 段） ----------

export function addService(data: ServicesData, input: unknown): EditResult {
  const b = obj(input)
  const idr = readId(b.id)
  if ('error' in idr) return fail(idr.error)
  if (data.services.length >= MAX_SERVICES) return fail('服务最多 ' + MAX_SERVICES + ' 个')
  if (data.services.some((s) => s.id.toLowerCase() === idr.id)) return fail('已经有这个服务：' + idr.id)
  const name = readName(b.name, '服务')
  if ('error' in name) return fail(name.error)
  const kind = readKind(b.kind, 'service')
  if ('error' in kind) return fail(kind.error)
  const rec: ServiceRec = {
    id: idr.id,
    name: name.name,
    kind: kind.kind,
    summary: txt(b.summary, LEN.note),
    doc: txt(b.doc, LEN.doc) || undefined,
  }
  return ok({ ...data, services: [...data.services, rec] })
}

export function patchService(data: ServicesData, id: string, patch: unknown): EditResult {
  const b = obj(patch)
  const want = txt(id, LEN.id).toLowerCase()
  const at = data.services.findIndex((s) => s.id.toLowerCase() === want)
  if (at < 0) return fail('没有这个服务：' + id)
  const cur = data.services[at]
  const next: ServiceRec = { ...cur }
  if (has(b, 'id')) {
    const idr = readId(b.id)
    if ('error' in idr) return fail(idr.error)
    if (idr.id !== cur.id && data.services.some((s, i) => i !== at && s.id.toLowerCase() === idr.id)) {
      return fail('已经有这个服务：' + idr.id)
    }
    next.id = idr.id
  }
  if (has(b, 'name')) {
    const name = readName(b.name, '服务')
    if ('error' in name) return fail(name.error)
    next.name = name.name
  }
  if (has(b, 'kind')) {
    const kind = readKind(b.kind, cur.kind)
    if ('error' in kind) return fail(kind.error)
    next.kind = kind.kind
  }
  if (has(b, 'summary')) next.summary = txt(b.summary, LEN.note)
  if (has(b, 'doc')) next.doc = txt(b.doc, LEN.doc) || undefined
  const services = data.services.slice()
  services[at] = next
  const deploys = next.id === cur.id
    ? data.deploys
    : data.deploys.map((d) => (d.service.toLowerCase() === cur.id.toLowerCase() ? { ...d, service: next.id } : d))
  return ok({ ...data, services, deploys })
}

export function removeService(data: ServicesData, id: string): EditResult {
  const want = txt(id, LEN.id).toLowerCase()
  const svc = data.services.find((s) => s.id.toLowerCase() === want)
  if (!svc) return fail('没有这个服务：' + id)
  const used = data.deploys.filter((d) => d.service.toLowerCase() === svc.id.toLowerCase())
  if (used.length) {
    return fail('「' + svc.name + '」还部署在 ' + used.length + ' 台机器上（' + listNames(used.map((d) => nameOfServer(data, d.server))) + '），先删这些部署再删服务')
  }
  return ok({ ...data, services: data.services.filter((s) => s !== svc) })
}

// ---------- 部署 ----------

/** 一条部署的 key：JSON 里部署没有自己的 id，就用「服务器:服务」这一对（两段 id 都不含冒号）。 */
export function deployKey(rec: { server: string; service: string }): string {
  return rec.server + ':' + rec.service
}

export function splitDeployKey(key: string): { server: string; service: string } {
  const at = String(key || '').indexOf(':')
  if (at < 0) return { server: '', service: '' }
  return { server: key.slice(0, at).trim().toLowerCase(), service: key.slice(at + 1).trim().toLowerCase() }
}

function findDeploy(data: ServicesData, key: string): number {
  const { server, service } = splitDeployKey(key)
  if (!server || !service) return -1
  return data.deploys.findIndex((d) => d.server.toLowerCase() === server && d.service.toLowerCase() === service)
}

/** 一条部署的字段校验（新增与修改共用）：返回规整后的记录，或一句错误。 */
function readDeploy(data: ServicesData, b: Record<string, unknown>, base: DeployRec | null): { rec: DeployRec } | { error: string } {
  const serverId = (has(b, 'server') ? txt(b.server, LEN.id) : base?.server || '').toLowerCase()
  const serviceId = (has(b, 'service') ? txt(b.service, LEN.id) : base?.service || '').toLowerCase()
  if (!serverId) return { error: '要选一台服务器' }
  if (!serviceId) return { error: '要选一个服务' }
  const srv = data.servers.find((s) => s.id.toLowerCase() === serverId)
  if (!srv) return { error: '没有这台服务器：' + serverId }
  const svc = data.services.find((s) => s.id.toLowerCase() === serviceId)
  if (!svc) return { error: '没有这个服务：' + serviceId }
  const path = has(b, 'path') ? txt(b.path, LEN.path) : base?.path || ''
  if (!path) return { error: '要填路径：这个服务在 ' + srv.name + ' 上的绝对路径' }
  const mon = has(b, 'monitor') ? readMonitors(b.monitor) : { ids: base?.monitor ?? [] }
  if ('error' in mon) return { error: mon.error }
  const url = has(b, 'url') ? readUrl(b.url) : { url: base?.url }
  if ('error' in url) return { error: url.error }
  return {
    rec: {
      server: srv.id,
      service: svc.id,
      path,
      runtime: has(b, 'runtime') ? txt(b.runtime, LEN.runtime) : base?.runtime || '',
      port: (has(b, 'port') ? txt(b.port, LEN.port) : base?.port || '') || undefined,
      monitor: mon.ids,
      url: url.url,
      note: (has(b, 'note') ? txt(b.note, LEN.note) : base?.note || '') || undefined,
    },
  }
}

export function addDeploy(data: ServicesData, input: unknown): EditResult {
  const b = obj(input)
  if (data.deploys.length >= MAX_DEPLOYS) return fail('部署最多 ' + MAX_DEPLOYS + ' 条')
  const r = readDeploy(data, b, null)
  if ('error' in r) return fail(r.error)
  const dup = data.deploys.some(
    (d) => d.server.toLowerCase() === r.rec.server.toLowerCase() && d.service.toLowerCase() === r.rec.service.toLowerCase(),
  )
  if (dup) return fail('「' + nameOfServer(data, r.rec.server) + '」上的「' + nameOfService(data, r.rec.service) + '」已经登记过了，改那一条')
  return ok({ ...data, deploys: [...data.deploys, r.rec] })
}

export function patchDeploy(data: ServicesData, key: string, patch: unknown): EditResult {
  const b = obj(patch)
  const at = findDeploy(data, key)
  if (at < 0) return fail('没有这条部署：' + key)
  const cur = data.deploys[at]
  const r = readDeploy(data, b, cur)
  if ('error' in r) return fail(r.error)
  const moved = r.rec.server.toLowerCase() !== cur.server.toLowerCase() || r.rec.service.toLowerCase() !== cur.service.toLowerCase()
  if (moved) {
    const dup = data.deploys.some(
      (d, i) => i !== at && d.server.toLowerCase() === r.rec.server.toLowerCase() && d.service.toLowerCase() === r.rec.service.toLowerCase(),
    )
    if (dup) return fail('「' + nameOfServer(data, r.rec.server) + '」上的「' + nameOfService(data, r.rec.service) + '」已经登记过了')
  }
  const deploys = data.deploys.slice()
  deploys[at] = r.rec
  return ok({ ...data, deploys })
}

export function removeDeploy(data: ServicesData, key: string): EditResult {
  const at = findDeploy(data, key)
  if (at < 0) return fail('没有这条部署：' + key)
  return ok({ ...data, deploys: data.deploys.filter((_, i) => i !== at) })
}

/**
 * 前端把选中观测项的名字一起带上来（从 Kuma 列表或文件自己的表里取的）：
 * 存进 monitors 表，这份文件就还能自己说明「12 号是什么」，不用打开观测台对。
 */
export function mergeMonitorNames(data: ServicesData, names: unknown): ServicesData {
  const b = obj(names)
  const monitors = { ...data.monitors }
  let changed = false
  for (const [k, v] of Object.entries(b)) {
    const n = Number(k)
    if (!Number.isInteger(n) || n <= 0) continue
    const label = txt(v, LEN.label)
    if (!label || monitors[String(n)] === label) continue
    monitors[String(n)] = label
    changed = true
  }
  return changed ? { ...data, monitors } : data
}
