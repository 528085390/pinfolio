/**
 * 服务栏的数据模型与两种视角的聚合（纯函数，可直接单测）。
 *
 * 这一页**不做任何探测**：只记录「哪台服务器上部署了哪个服务、在哪、怎么起」。
 * 观测只以「跳转」的形式存在——一条部署挂了观测项 id，点一下就去观测台定位那一项。
 */

export type DeployKind = 'project' | 'service' | 'site' | 'script' | 'task'

/** 卡片里行的顺序：项目 → 系统服务 → 站点 → 脚本 → 定时任务。 */
export const KIND_ORDER: DeployKind[] = ['project', 'service', 'site', 'script', 'task']

export const KIND_LABEL: Record<DeployKind, string> = {
  project: '项目',
  service: '服务',
  site: '站点',
  script: '脚本',
  task: '任务',
}

export type ServerRec = {
  id: string
  /** 卡片标题：与观测台组名、主机页一致的那截短名 */
  name: string
  /** 副标题：厂商 · 区域 */
  vendor: string
  ip: string
  user: string
  note?: string
  /** 档案（本机文档路径 / 仓库地址），样例里只做展示 */
  doc?: string
  /** 不挂在具体部署上的观测项（入口、端口这类） */
  monitors?: number[]
}

export type ServiceRec = {
  id: string
  name: string
  kind: DeployKind
  summary: string
  doc?: string
}

export type DeployRec = {
  /** ServerRec.id */
  server: string
  /** ServiceRec.id */
  service: string
  /** 服务器上的绝对路径（本机就是本机路径） */
  path: string
  /** 怎么起的：systemd unit / timer / 计划任务 / 裸命令 */
  runtime: string
  /** 监听，写成 7863 或 127.0.0.1:29195 这种 */
  port?: string
  /** 对应的 Kuma 观测项 id（没有观测就不写，点了也没得跳） */
  monitor?: number[]
  note?: string
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
    .sort((a, b) => kindRank(a.svc.kind) - kindRank(b.svc.kind) || a.svc.name.localeCompare(b.svc.name, 'zh'))
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

/** 服务视角：每个服务一张卡，行 = 它部署在哪几台机上。没有部署的服务不出现。 */
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
    const rows = byService.get(service.id)
    if (!rows || rows.length === 0) continue
    out.push({ service, rows: rows.slice().sort((a, b) => a.srv.name.localeCompare(b.srv.name, 'zh')) })
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
    const rows = g.rows.filter((r) => hit(term, r.svc.name, r.svc.summary, r.path, r.runtime, r.port, r.note))
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
    const rows = g.rows.filter((r) => hit(term, r.srv.name, r.srv.vendor, r.srv.ip, r.srv.user, r.path, r.runtime, r.port))
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
  if (monitorLabels.length) lines.push('观测：' + monitorLabels.join('、'))
  if (rec.note) lines.push(rec.note)
  return lines.join('\n')
}

/** 页头那行数字。服务数只算「真的部署过」的。 */
export function summaryOf(servers: ServerRec[], services: ServiceRec[], deploys: DeployRec[]): Summary {
  const ids = new Set<number>()
  const deployed = new Set<string>()
  let linked = 0
  for (const d of deploys) {
    deployed.add(d.service)
    const list = d.monitor ?? []
    if (list.length) linked++
    for (const id of list) ids.add(id)
  }
  for (const s of servers) for (const id of s.monitors ?? []) ids.add(id)
  return {
    servers: servers.length,
    services: services.filter((s) => deployed.has(s.id)).length,
    deploys: deploys.length,
    linked,
    monitors: ids.size,
  }
}
