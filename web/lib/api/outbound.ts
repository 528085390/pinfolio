import { request } from './http'

// 全局出站模式（设置页「出站模式」卡片】，后端见 server/routes/outbound.ts）。
// 三条铁律在这层的体现：
//   1. 读侧代理只回 hasPassword 布尔，**永远没有明文密码**（后端 maskProxy 保证，这里别加 password 字段）
//   2. 写侧的 username / password 是三态：缺键 = 不修改、null = 清空、字符串 = 设置
//   3. direct 只送 { mode: 'direct' }，不带 proxy
export type OutboundMode = 'direct' | 'proxy'

/** 与 server/kuma/outbound.ts 的 ProxyProtocol 同一组（socks5h 默认：DNS 也交给代理） */
export type ProxyProtocol = 'socks5h' | 'socks5' | 'http' | 'https'

/** GET 回来的代理形状：密码只有布尔 */
export type ProxyView = {
  protocol: ProxyProtocol
  host: string
  port: number
  username: string
  hasPassword: boolean
}

export type OutboundCfg = {
  mode: OutboundMode
  /** 只切到直连时也照样回已存的配置（后端不清它），所以这里允许非 null */
  proxy: ProxyView | null
  changedAt: string | null
}

/** 写侧的代理：protocol / host / port 必给，username / password 三态 */
export type ProxyWrite = {
  protocol: ProxyProtocol
  host: string
  port: number
  username?: string | null
  password?: string | null
}

export type OutboundPayload =
  | { mode: 'direct' }
  | { mode: 'proxy'; proxy: ProxyWrite }

/** POST 的响应：新的视图 + 本轮排上的重探条数 */
export type OutboundSaveResult = OutboundCfg & { rechecking: number }

export const outboundApi = {
  get: () => request<OutboundCfg>('/outbound'),
  save: (payload: OutboundPayload) =>
    request<OutboundSaveResult>('/outbound', { method: 'POST', body: JSON.stringify(payload) }),
  /** 只重探、不改设置。返回本轮排上的条数（真跑在 kuma 侧后台） */
  recheck: () => request<{ queued: number }>('/outbound/recheck', { method: 'POST', body: '{}' }),
}
