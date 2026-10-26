import { request } from './http'

/** 部署的种类：项目 / 系统服务 / 站点 / 脚本 / 定时任务 */
export type DeployKind = 'project' | 'service' | 'site' | 'script' | 'task'

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

/** GET /api/services：data/services.json 的解析结果 + 文件路径（空态里给用户看） */
export type ServicesPayload = {
  servers: ServerRec[]
  services: ServiceRec[]
  deploys: DeployRec[]
  /** 观测项 id → 短名；缺了前端显示「观测项 12」 */
  monitors: Record<string, string>
  file: string
}

/** 加 / 改服务器时提交的字段（id 与名字必填，其余可空） */
export type ServerInput = {
  id: string
  name: string
  vendor?: string
  ip?: string
  user?: string
  note?: string
  doc?: string
  monitors?: number[]
}

/** 加 / 改服务时提交的字段 */
export type ServiceInput = {
  id: string
  name: string
  kind?: DeployKind
  summary?: string
  doc?: string
}

/** 加 / 改部署时提交的字段：server + service 是这条部署的身份（没有单独的 id） */
export type DeployInput = {
  server: string
  service: string
  path: string
  runtime?: string
  port?: string
  monitor?: number[]
  url?: string
  note?: string
}

/** 选中观测项时把名字一起带上：服务端会写进文件的 monitors 表（文件自己就能说明 id 是啥） */
type Named = { monitorNames?: Record<string, string> }

const enc = encodeURIComponent
/** 部署没有自己的 id：用 server:service 当 key，服务端按它定位这一条 */
export const deployKey = (server: string, service: string) => server + ':' + service

export const servicesApi = {
  get: () => request<ServicesPayload>('/services'),

  // 写接口都返回整份 payload：页面拿到直接替换，不用再拉一次
  addServer: (body: ServerInput & Named) => request<ServicesPayload>('/services/servers', { method: 'POST', body: JSON.stringify(body) }),
  patchServer: (id: string, body: Partial<ServerInput> & Named) =>
    request<ServicesPayload>('/services/servers/' + enc(id), { method: 'PATCH', body: JSON.stringify(body) }),
  // 删除要手输 id 确认（服务端拿 ?confirm= 跟路径里的 id 比对）
  removeServer: (id: string) =>
    request<ServicesPayload>('/services/servers/' + enc(id) + '?confirm=' + enc(id), { method: 'DELETE' }),

  addService: (body: ServiceInput) => request<ServicesPayload>('/services/catalog', { method: 'POST', body: JSON.stringify(body) }),
  patchService: (id: string, body: Partial<ServiceInput>) =>
    request<ServicesPayload>('/services/catalog/' + enc(id), { method: 'PATCH', body: JSON.stringify(body) }),
  removeService: (id: string) =>
    request<ServicesPayload>('/services/catalog/' + enc(id) + '?confirm=' + enc(id), { method: 'DELETE' }),

  addDeploy: (body: DeployInput & Named) => request<ServicesPayload>('/services/deploys', { method: 'POST', body: JSON.stringify(body) }),
  patchDeploy: (key: string, body: Partial<DeployInput> & Named) =>
    request<ServicesPayload>('/services/deploys/' + enc(key), { method: 'PATCH', body: JSON.stringify(body) }),
  removeDeploy: (key: string) =>
    request<ServicesPayload>('/services/deploys/' + enc(key) + '?confirm=' + enc(key), { method: 'DELETE' }),
}
