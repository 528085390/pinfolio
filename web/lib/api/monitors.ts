import { request } from './http'

export type Monitor = {
  id: number; name: string; type: string; group: string
  status: number | null; time: string | null; ping: number | null; msg: string
  /** 观测项固定说明，卡片名悬停显示；空串 = 没配 */
  description: string
  /** 为真时把本次心跳消息常显成「本次观测情况」一行 */
  showMsg: boolean
  /** Kuma 里是否启用（false = 已暂停，卡片上要打标） */
  active: boolean
  /** 基础检查间隔（秒） */
  interval: number
  uptime24: number | null; beats: number[]; downCount: number; lastDown: string | null
  /** 与 beats 一一对应：该拍消息前缀的四态字符（绿/黄/红/灰），普通监视器为 null */
  beatTones?: (string | null)[]
  /** 与 beats 一一对应：该拍的时间（ISO）；色条悬停提示用 */
  beatTimes?: (string | null)[]
  /** 与 beats 一一对应：该拍的心跳消息；色条悬停提示用 */
  beatMsgs?: string[]
  /** 与 beats 一一对应：该拍的响应毫秒；色条悬停提示用 */
  beatPings?: (number | null)[]
  link: { url: string; label: string } | null
}
export type MonitorGroup = { id: number; name: string; monitors: Monitor[] }
export type MonitorSummary = { total: number; up: number; down: number; pending: number; uptime24: number | null }
export type MonitorsPayload = {
  kuma: { base: string; slug: string; title: string }
  updatedAt: string
  summary: MonitorSummary
  groups: MonitorGroup[]
  stale?: boolean
  error?: string
}

export type MonitorBeat = {
  status: number | null; time: string | null; msg: string; ping: number | null
  /** 消息前缀的四态字符（绿/黄/红/灰），普通观测项为 null */
  tone: string | null
}
export type MonitorActionStep = { type: string; label: string; hint?: string }
export type MonitorAction = {
  /** config = monitor-actions.json 里配了；default = 默认「让 Kuma 立刻探一次」；none = 没有可执行动作 */
  source: 'config' | 'default' | 'none'
  steps: MonitorActionStep[]
  disabledReason: string | null
}
/** 立即观测跑完一步之后回显的一行（阶段 3 用）。 */
export type MonitorActionStepResult = { type: string; label: string; ok: boolean; detail: string; ms: number }
export type MonitorDetail = {
  monitor: Monitor & { timeout: number; maxretries: number; retryInterval: number; target: string; policy: { name: string; summary: string } | null }
  latest: MonitorBeat | null
  beats: MonitorBeat[]
  action: MonitorAction
  link: { url: string; label: string } | null
}

export const monitorsApi = {
  get: (fresh?: boolean) => request<MonitorsPayload>('/monitors' + (fresh ? '?fresh=1' : '')),
  detail: (id: number) => request<MonitorDetail>('/monitors/' + id),
  update: (
    id: number,
    b: { name?: string; description?: string; interval?: number; showMsg?: boolean; timeout?: number; maxretries?: number; retryInterval?: number },
  ) => request<{ ok: boolean; monitor?: Monitor }>('/monitors/' + id, { method: 'PATCH', body: JSON.stringify(b) }),
  // 写接口都要求 application/json（服务端用它挡 CSRF），所以即使没有参数也要带个空 body
  pause: (id: number) => request<{ ok: boolean; active: boolean }>('/monitors/' + id + '/pause', { method: 'POST', body: JSON.stringify({}) }),
  resume: (id: number) => request<{ ok: boolean; active: boolean }>('/monitors/' + id + '/resume', { method: 'POST', body: JSON.stringify({}) }),
  remove: (id: number, confirm: string) =>
    request<{ ok: boolean; backup?: string | null }>('/monitors/' + id + '?confirm=' + encodeURIComponent(confirm), { method: 'DELETE' }),
  check: (id: number) =>
    request<{ ok: boolean; steps: MonitorActionStepResult[]; latest?: any }>('/monitors/' + id + '/check', { method: 'POST', body: JSON.stringify({}) }),
}
