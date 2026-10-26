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

export const servicesApi = {
  get: () => request<ServicesPayload>('/services'),
}
