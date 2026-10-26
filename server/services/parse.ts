/**
 * 服务栏的数据文件解析（纯函数，单测在 tests/unit/services-parse.test.mts）。
 *
 * 唯一数据源是 data/services.json（环境变量 SERVICES_FILE 可换路径）：
 * 三段 —— servers（哪几台机）/ services（哪些服务）/ deploys（谁部署在谁上面），
 * 外加一张 monitors 表给观测项 id 配可读名字（只用于显示，不产生任何探测）。
 *
 * 坏条目一律丢掉而不是整份报错：手写 JSON 打错一个字，页面还是要能开。
 */
import { isHttpUrl } from '../kuma/quick.js'

export type DeployKind = 'project' | 'service' | 'site' | 'script' | 'task'

/** 合法的种类；写错了退回 'service'。 */
export const DEPLOY_KINDS: DeployKind[] = ['project', 'service', 'site', 'script', 'task']

export type ServerRec = {
  id: string
  /** 卡片标题：与观测台组名、主机页一致的那截短名 */
  name: string
  /** 副标题：厂商 · 区域 */
  vendor: string
  ip: string
  user: string
  note?: string
  /** 档案（本机文档路径 / 仓库地址），只做展示 */
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
  /** 这个部署自己的管理页（面板 / 后台那种能打开的页面） */
  url?: string
  note?: string
}

export type ServicesData = {
  servers: ServerRec[]
  services: ServiceRec[]
  deploys: DeployRec[]
  /** 观测项 id → 短名，只用于显示；缺了就显示「观测项 12」 */
  monitors: Record<string, string>
}

// 上限只为挡住手滑写出的一坨垃圾（正常规模：个位数服务器、几十个服务、几十条部署）
export const MAX_SERVERS = 200
export const MAX_SERVICES = 500
export const MAX_DEPLOYS = 2000

const LEN = {
  id: 40,
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

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

/** id 只认 [A-Za-z0-9._-]：它是行 key 与卡片锚点（svc-card-srv-<id>）的一部分。 */
function ident(v: unknown): string {
  const s = text(v, LEN.id)
  return /^[A-Za-z0-9._-]+$/.test(s) ? s : ''
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

/** 观测项 id：正整数、去重、按大小排（同一份数据每次渲染顺序都一致）。 */
function ids(v: unknown): number[] {
  const out = new Set<number>()
  for (const raw of list(v)) {
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
    if (Number.isInteger(n) && n > 0) out.add(n)
  }
  return [...out].sort((a, b) => a - b)
}

function optional(v: unknown, max: number): string | undefined {
  const s = text(v, max)
  return s ? s : undefined
}

/** 解析整份数据：坏条目跳过、id 重复只留第一条、指向不存在服务器/服务的部署丢掉。 */
export function parseServices(input: unknown): ServicesData {
  const root = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {}

  const servers: ServerRec[] = []
  const seenServer = new Set<string>()
  for (const raw of list(root.servers).slice(0, MAX_SERVERS)) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const id = ident(r.id)
    if (!id || seenServer.has(id)) continue
    const name = text(r.name, LEN.name)
    if (!name) continue
    seenServer.add(id)
    servers.push({
      id,
      name,
      vendor: text(r.vendor, LEN.vendor),
      ip: text(r.ip, LEN.ip),
      user: text(r.user, LEN.user),
      note: optional(r.note, LEN.note),
      doc: optional(r.doc, LEN.doc),
      monitors: ids(r.monitors),
    })
  }

  const services: ServiceRec[] = []
  const seenService = new Set<string>()
  for (const raw of list(root.services).slice(0, MAX_SERVICES)) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const id = ident(r.id)
    if (!id || seenService.has(id)) continue
    const name = text(r.name, LEN.name)
    if (!name) continue
    seenService.add(id)
    const kind = text(r.kind, 20) as DeployKind
    services.push({
      id,
      name,
      kind: DEPLOY_KINDS.includes(kind) ? kind : 'service',
      summary: text(r.summary, LEN.note),
      doc: optional(r.doc, LEN.doc),
    })
  }

  const deploys: DeployRec[] = []
  for (const raw of list(root.deploys).slice(0, MAX_DEPLOYS)) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const server = ident(r.server)
    const service = ident(r.service)
    // 指向没登记的服务器 / 服务就没有可跳转的两端，留着只会渲染出一张空气卡
    if (!seenServer.has(server) || !seenService.has(service)) continue
    deploys.push({
      server,
      service,
      path: text(r.path, LEN.path),
      runtime: text(r.runtime, LEN.runtime),
      port: optional(r.port, LEN.port),
      monitor: ids(r.monitor),
      // 只认 http(s)：手滑写成 javascript: 也不会变成可点的链接
      url: isHttpUrl(text(r.url, 500)) ? text(r.url, 500) : undefined,
      note: optional(r.note, LEN.note),
    })
  }

  const monitors: Record<string, string> = {}
  const rawMonitors = root.monitors && typeof root.monitors === 'object' ? (root.monitors as Record<string, unknown>) : {}
  for (const [k, v] of Object.entries(rawMonitors)) {
    const n = Number(k)
    if (!Number.isInteger(n) || n <= 0) continue
    const label = text(v, LEN.label)
    if (label) monitors[String(n)] = label
  }

  return { servers, services, deploys, monitors }
}
