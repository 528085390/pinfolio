import { request } from './http'

// 公网映射（frp / 任意反代）状态，见 server/tunnel.ts
export type TunnelStatus = {
  publicUrl: string
  instanceId: string
  online: boolean | null
  checkedAt: string | null
  okAt: string | null
  latencyMs: number | null
  error: string | null
}

export const tunnelApi = {
  get: () => request<TunnelStatus>('/tunnel'),
  save: (publicUrl: string) =>
    request<TunnelStatus>('/tunnel', { method: 'POST', body: JSON.stringify({ publicUrl }) }),
  check: () => request<TunnelStatus>('/tunnel/check', { method: 'POST', body: '{}' }),
}
