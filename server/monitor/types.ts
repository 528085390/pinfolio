export type MonitorType = 'http' | 'port' | 'ssh' | 'push'

export enum MonitorStatus {
  DOWN = 0,
  UP = 1,
  PENDING = 2,
  MAINTENANCE = 3,
}

export type OutboundMode = 'direct' | 'proxy' | 'follow' | null

export interface ProbeResult {
  status: number // 1 = UP, 0 = DOWN, 2 = PENDING, 3 = MAINTENANCE
  ping: number | null // latency in ms
  msg: string
}

export interface OutboundConfig {
  mode: 'direct' | 'proxy'
  proxy: string | null // e.g. "socks5h://127.0.0.1:1080"
}

export interface ResolvedOutbound {
  mode: 'direct' | 'proxy'
  proxy: string | null
  reason: string
}

export type MonitorRow = {
  id: number
  name: string
  type: MonitorType
  group_name: string
  active: number
  interval: number
  timeout: number
  maxretries: number
  url: string | null
  keyword: string | null
  invert_keyword: number
  accepted_statuscodes: string
  hostname: string | null
  port: number | null
  ssh_username: string | null
  ssh_password: string | null
  ssh_private_key: string | null
  ssh_passphrase: string | null
  ssh_auth_method: string | null
  ssh_command: string | null
  push_token: string | null
  outbound_mode: OutboundMode
  policy_json: string | null
  description: string
  created_at: string
  updated_at: string
}

export type HeartbeatRow = {
  id: number
  monitor_id: number
  status: number
  ping: number | null
  msg: string
  time: string
  duration: number
  down_count: number
}
