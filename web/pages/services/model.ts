/**
 * 服务栏的数据模型与两种视角的聚合（纯函数，可直接单测）。
 *
 * 这一页**不做任何探测**：只记录「哪台服务器上部署了哪个服务、在哪、怎么起」。
 * 观测只以「跳转」的形式存在——一条部署挂了观测项 id，点一下就去观测台定位那一项。
 */

import type { DeployKind, DeployRec, ServerRec, ServiceRec } from '../../lib/api/services'
import { localeTag, t } from '../../lib/i18n'

// 记录类型（服务器 / 服务 / 部署）定义在 API 层，跟 GET /api/services 的返回是同一份；
// 这里再导出一次，页面与单测继续从 './services/model' 拿。
export type { DeployKind, DeployRec, ServerRec, ServiceRec } from '../../lib/api/services'

/** 卡片里行的顺序：项目 → 系统服务 → 站点 → 脚本 → 定时任务。 */
export const KIND_ORDER: DeployKind[] = ['project', 'service', 'site', 'script', 'task']

// label 用 getter：调用方照旧写 KIND_LABEL[k]，取值时才知道当前语言
// （模块加载期就把 t() 的结果存进常量，等于把当时语言冻住）
export const KIND_LABEL: Record<DeployKind, string> = {
  get project() { return t('项目') },
  get service() { return t('服务') },
  get site() { return t('站点') },
  get script() { return t('脚本') },
  get task() { return t('任务') },
}

/** 列表分隔符：中文用顿号，英文用逗号（拼「观测：a、b」这类句子用） */
export function listJoin(items: Array<string | number>): string {
  return items.join(localeTag() === 'en' ? ', ' : '、')
}

/** 点一行会去哪儿：观测台定位某一项，或者打开这个部署自己的管理页。 */
export type DeployTarget = { kind: 'monitor'; id: number } | { kind: 'url'; url: string }

/**
 * 行的入口：先看有没有观测项，再看有没有管理页，都没有就返回 null（点了不动）。
 * 两个都有时优先观测台——观测项是「这个部署活着吗」，比管理页更常用。
 */
export function deployTarget(rec: DeployRec): DeployTarget | null {
  const first = (rec.monitor ?? [])[0]
  if (typeof first === 'number') return { kind: 'monitor', id: first }
  if (rec.url) return { kind: 'url', url: rec.url }
  return null
}

/**
 * 观测项的显示名：data/services.json 的 monitors 表里配了就显示它，
 * 没配（或 id 写错）就退回「观测项 12」——这一页不连 Kuma，名字只能来自这份文件。
 */
export function monitorLabel(labels: Record<string, string> | undefined | null, id: number): string {
  const hit = labels?.[String(id)]
  return hit && hit.trim() ? hit.trim() : t('观测项 {id}', { id })
}

export type ServerRow = DeployRec & { svc: ServiceRec }
export type ServiceRow = DeployRec & { srv: ServerRec }

export type ServerGroup = {
  server: ServerRec
  rows: ServerRow[]
  /** 服务器级观测（入口 / 端口），不含行里的那些 */
  monitors: number[]
}

export type ServiceGroup = {
  service: ServiceRec
  rows: ServiceRow[]
}

export type Summary = {
  servers: number
  services: number
  deploys: number
  /** 挂了观测项的部署条数 */
  linked: number
  /** 有管理页的部署条数（没观测也能点开的那种） */
  manage: number
  /** 去重后的观测项个数（含服务器级的） */
  monitors: number
}

export function kindRank(kind: DeployKind): number {
  const i = KIND_ORDER.indexOf(kind)
  return i < 0 ? KIND_ORDER.length : i
}

function sortServerRows(rows: ServerRow[]): ServerRow[] {
  return rows
    .slice()
    .sort((a, b) => kindRank(a.svc.kind) - kindRank(b.svc.kind) || a.svc.name.localeCompare(b.svc.name, localeTag()))
}

/** 服务器视角：每台机一张卡，行 = 它上面的部署。指向不存在服务的部署直接丢掉，不抛错。 */
export function groupByServer(servers: ServerRec[], services: ServiceRec[], deploys: DeployRec[]): ServerGroup[] {
  const svcById = new Map(services.map((s) => [s.id, s]))
  const byServer = new Map<string, ServerRow[]>()
  for (const d of deploys) {
    const svc = svcById.get(d.service)
    if (!svc) continue
    const list = byServer.get(d.server) ?? []
    list.push({ ...d, svc })
    byServer.set(d.server, list)
  }
  return servers.map((server) => ({
    server,
    rows: sortServerRows(byServer.get(server.id) ?? []),
    monitors: (server.monitors ?? []).slice().sort((a, b) => a - b),
  }))
}

/**
 * 服务视角：一行一个服务，行 = 它部署在哪几台机上。
 * 服务清单里登记过但还没部署的也要列出来（0 台），否则新建完就找不到了。
 */
export function groupByService(services: ServiceRec[], servers: ServerRec[], deploys: DeployRec[]): ServiceGroup[] {
  const srvById = new Map(servers.map((s) => [s.id, s]))
  const byService = new Map<string, ServiceRow[]>()
  for (const d of deploys) {
    const srv = srvById.get(d.server)
    if (!srv) continue
    const list = byService.get(d.service) ?? []
    list.push({ ...d, srv })
    byService.set(d.service, list)
  }
  const out: ServiceGroup[] = []
  for (const service of services) {
    const rows = byService.get(service.id) ?? []
    out.push({ service, rows: rows.slice().sort((a, b) => a.srv.name.localeCompare(b.srv.name, localeTag())) })
  }
  return out
}

function norm(s: string): string {
  return String(s || '').trim().toLowerCase()
}

function hit(term: string, ...fields: (string | undefined)[]): boolean {
  return fields.some((f) => !!f && String(f).toLowerCase().includes(term))
}

/**
 * 搜索：服务器自己命中就整张卡留下；否则只留命中的行（免得搜 xray 时
 * 卡片里塞满不相干的 nginx / acme）。
 */
export function filterServerGroups(groups: ServerGroup[], q: string): ServerGroup[] {
  const term = norm(q)
  if (!term) return groups
  const out: ServerGroup[] = []
  for (const g of groups) {
    const s = g.server
    if (hit(term, s.name, s.vendor, s.ip, s.user, s.note)) {
      out.push(g)
      continue
    }
    const rows = g.rows.filter((r) => hit(term, r.svc.name, r.svc.summary, r.path, r.runtime, r.port, r.url, r.note))
    if (rows.length) out.push({ ...g, rows })
  }
  return out
}

/** 服务视角的搜索规则同上：服务名 / 简介命中留整张卡，否则只留命中的服务器行。 */
export function filterServiceGroups(groups: ServiceGroup[], q: string): ServiceGroup[] {
  const term = norm(q)
  if (!term) return groups
  const out: ServiceGroup[] = []
  for (const g of groups) {
    const s = g.service
    if (hit(term, s.name, s.summary, KIND_LABEL[s.kind])) {
      out.push(g)
      continue
    }
    const rows = g.rows.filter((r) => hit(term, r.srv.name, r.srv.vendor, r.srv.ip, r.srv.user, r.path, r.runtime, r.port, r.url))
    if (rows.length) out.push({ ...g, rows })
  }
  return out
}

/**
 * 紧凑视图里一行的悬停提示：路径 / 启动方式 · 端口 / 观测 / 备注，各占一行。
 * 紧凑视图只显示名字，细节全在这条 title 里，鼠标停一下就能看到。
 */
export function deployTitle(rec: DeployRec, monitorLabels: string[] = []): string {
  const lines = [rec.path, rec.runtime + (rec.port ? ' · ' + rec.port : '')]
  if (monitorLabels.length) lines.push(t('观测：{list}', { list: listJoin(monitorLabels) }))
  if (rec.url) lines.push(t('管理页：{url}', { url: rec.url }))
  if (rec.note) lines.push(rec.note)
  return lines.join('\n')
}

/** 页头那行数字。服务数 = 服务清单里的条数（含还没部署的）。 */
export function summaryOf(servers: ServerRec[], services: ServiceRec[], deploys: DeployRec[]): Summary {
  const ids = new Set<number>()
  let linked = 0
  let manage = 0
  for (const d of deploys) {
    const list = d.monitor ?? []
    if (list.length) linked++
    if (d.url) manage++
    for (const id of list) ids.add(id)
  }
  for (const s of servers) for (const id of s.monitors ?? []) ids.add(id)
  return {
    servers: servers.length,
    services: services.length,
    deploys: deploys.length,
    linked,
    manage,
    monitors: ids.size,
  }
}
