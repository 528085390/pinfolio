import { request } from './http'

// 主机指标：数据由 6 台机各自的 systemd timer 推到 my-server，本服务每 5 分钟拉回来。
// 增 / 暂停 / 删都走写接口，服务端写回 data/metrics.json（唯一真相），成功后直接把新快照回给前端。
export type HostDisk = { path: string; total: number; used: number; pct: number }
export type HostTop = { comm: string; rss_kb: number }
/** [时间戳(秒), CPU%, 内存%] */
export type HostSeriesPoint = [number, number, number]
/** 某个 unit 对应的观测项（Kuma 的 id + 全名）；点 chip 就用这个 id 跳过去高亮 */
export type UnitMonitor = { id: number; name: string }

export type Host = {
  id: string
  label: string
  note: string
  online: boolean
  /** 已暂停：不拉取、不算离线、卡片灰掉但保留 */
  paused?: boolean
  /** unit → 观测项；没配映射或观测项已删时是空对象（chip 就不可点） */
  unitMonitors?: Record<string, UnitMonitor>
  /** 距最近一次上报的秒数；null = 一次都没收到 */
  staleSec: number | null
  series: HostSeriesPoint[]
  host?: string
  ts?: number
  uptime_s?: number
  kernel?: string
  os?: string
  cores?: number
  load?: number[]
  cpu_pct?: number
  mem?: { total_kb: number; avail_kb: number; used_pct: number; swap_total_kb?: number; swap_used_pct?: number }
  disk?: HostDisk[]
  failed_units?: number
  units?: Record<string, string>
  top?: HostTop[]
}

export type HostsPayload = {
  hosts: Host[]
  updatedAt: string
  polledAt?: string | null
  pollOk?: number
  pollFailed?: { id: string; error: string }[]
  samples?: number
  /** 删除时顺手清掉的历史样本行数 */
  purged?: number
  /** 彻底删时一起收掉的观测项数量（加主机顺带建的那些） */
  monitorsDeleted?: number
  /** 没收掉的观测项 id：Kuma 那边报错了，得手动去观测台删 */
  monitorsFailed?: number[]
  /** 添加主机时顺带建观测项的结果（没勾观测项就是 null） */
  provision?: ProvisionResult | null
  error?: string
}

export type HostSummary = { total: number; online: number; stale: number; paused: number }

/** 建观测项的结果：ok=false 时主机照样加上了，只是观测项没建成 */
export type ProvisionResult = {
  ok: boolean
  groupId?: number
  groupName?: string
  monitors?: { id: number; name: string; unit?: string }[]
  error?: string
}

/** 添加主机时顺带要建的观测项（都是可选的） */
export type HostServiceInput = { unit: string; user: string; keyPath: string }

export type HostInput = {
  id: string
  label?: string
  note?: string
  /** 采集端的 WATCH_UNITS（决定卡片上的服务 chip） */
  units?: string
  /** 采集端的 DISK_PATHS */
  disks?: string
  /** 主机地址（IP / 域名），建观测项时用 */
  address?: string
  port?: number
  http?: { url: string; keyword?: string }
  services?: HostServiceInput[]
}

/** 「接入这台机器」：带 token 的安装命令，只在 /hosts/:id/onboard 出现 */
export type HostOnboard = {
  hostId: string
  label: string
  address: string | null
  units: string[]
  disks: string[]
  installUrl: string
  ingestUrl: string
  command: string
  ready: boolean
  firstSampleAt: string | null
  staleSec: number | null
}
export type HostPatch = { paused?: boolean; label?: string; note?: string }

export const hostsApi = {
  get: () => request<HostsPayload>('/hosts'),
  // 写接口都要 application/json（服务端用它挡 CSRF），没有参数也得带个空 body
  refresh: () => request<HostsPayload>('/hosts/refresh', { method: 'POST', body: JSON.stringify({}) }),
  add: (body: HostInput) => request<HostsPayload>('/hosts', { method: 'POST', body: JSON.stringify(body) }),
  // 接入指引：安装命令里有采集 token，所以单独一支，列表接口不带
  onboard: (id: string) => request<HostOnboard>('/hosts/' + encodeURIComponent(id) + '/onboard'),
  patch: (id: string, body: HostPatch) =>
    request<HostsPayload>('/hosts/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(body) }),
  // 服务端要求手输 id 确认（?confirm=），purge=1 连历史样本一起删
  remove: (id: string, opts: { purge?: boolean } = {}) =>
    request<HostsPayload>(
      '/hosts/' + encodeURIComponent(id) + '?confirm=' + encodeURIComponent(id) + (opts.purge ? '&purge=1' : ''),
      { method: 'DELETE' },
    ),
}
