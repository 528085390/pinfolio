import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { getSetting, setSetting } from './auth/store.js'

// 公网映射（frp / 任意反代）的探活：设置页填了公网地址后，本机每 60s 请求一次
// <公网地址>/api/health，返回的实例 id 必须等于自己，才能确认「这条路通到的是我」。
const KEY_URL = 'tunnel.public_url'
const KEY_ID = 'tunnel.instance_id'

export type TunnelStatus = {
  publicUrl: string
  instanceId: string
  online: boolean | null
  checkedAt: string | null
  okAt: string | null
  latencyMs: number | null
  error: string | null
}

let last: Pick<TunnelStatus, 'online' | 'checkedAt' | 'okAt' | 'latencyMs' | 'error'> = {
  online: null, checkedAt: null, okAt: null, latencyMs: null, error: null,
}

// 只接受 http/https；去掉结尾斜杠，保留子路径（/pinfolio）
export function normalizePublicUrl(raw: unknown): string {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  let u: URL
  try {
    u = new URL(text)
  } catch {
    throw new Error('地址格式不对，示例：https://example.com/pinfolio')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('只支持 http / https')
  return (u.origin + u.pathname).replace(/\/+$/, '')
}

export function instanceId(database: DatabaseSync): string {
  const cur = getSetting(database, KEY_ID)
  if (cur) return cur
  const id = randomUUID()
  setSetting(database, KEY_ID, id)
  return id
}

export function getPublicUrl(database: DatabaseSync): string {
  return getSetting(database, KEY_URL) ?? ''
}

export function setPublicUrl(database: DatabaseSync, raw: unknown): string {
  const clean = normalizePublicUrl(raw)
  setSetting(database, KEY_URL, clean)
  if (!clean) last = { online: null, checkedAt: null, okAt: null, latencyMs: null, error: null }
  return clean
}

export function getTunnel(database: DatabaseSync): TunnelStatus {
  return { publicUrl: getPublicUrl(database), instanceId: instanceId(database), ...last }
}

export async function checkTunnel(database: DatabaseSync, timeoutMs = 5000): Promise<TunnelStatus> {
  const url = getPublicUrl(database)
  const checkedAt = new Date().toISOString()
  if (!url) {
    last = { online: null, checkedAt, okAt: null, latencyMs: null, error: null }
    return getTunnel(database)
  }
  const started = Date.now()
  try {
    const res = await fetch(url + '/api/health', {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'pinfolio-tunnel-probe' },
    })
    const body = (await res.json().catch(() => null)) as any
    const latencyMs = Date.now() - started
    if (!res.ok) throw new Error('HTTP ' + res.status)
    if (!body || body.ok !== true) throw new Error('健康检查返回异常')
    if (body.id !== instanceId(database)) throw new Error('公网地址指向的不是这台机器')
    last = { online: true, checkedAt, okAt: checkedAt, latencyMs, error: null }
  } catch (e: any) {
    const msg = e?.name === 'TimeoutError' ? '超时（' + timeoutMs + 'ms）' : String(e?.message ?? e)
    last = { online: false, checkedAt, okAt: last.okAt, latencyMs: null, error: msg }
  }
  return getTunnel(database)
}
