import net from 'node:net'
import tls from 'node:tls'
import dns from 'node:dns'
import { SocksClient } from 'socks'
import { ProxyAgent, Agent } from 'undici'
import type { OutboundConfig, ResolvedOutbound } from './types.ts'

/**
 * Resolve outbound routing (direct or proxy) based on monitor pin and global setting.
 */
export function resolveOutbound(
  monitorMode: string | null | undefined,
  global: OutboundConfig
): ResolvedOutbound {
  if (monitorMode === 'direct') {
    return {
      mode: 'direct',
      proxy: null,
      reason: 'pinned:direct',
    }
  }

  if (monitorMode === 'proxy') {
    return {
      mode: 'proxy',
      proxy: global.proxy,
      reason: 'pinned:proxy',
    }
  }

  // 'follow' or null / undefined
  return {
    mode: global.mode,
    proxy: global.mode === 'proxy' ? global.proxy : null,
    reason: 'follow:global',
  }
}

/**
 * Establish a connected TCP socket through a SOCKS5 proxy tunnel.
 */
export async function createSocksSocket(
  proxyUrl: string,
  targetHost: string,
  targetPort: number,
  timeoutMs: number = 10000
): Promise<net.Socket> {
  if (!proxyUrl) {
    throw new Error('出站模式为「代理」但还没有配置代理服务器')
  }

  const url = new URL(proxyUrl)
  const protocol = url.protocol.replace(':', '')

  if (protocol !== 'socks5' && protocol !== 'socks5h') {
    throw new Error(`Unsupported proxy protocol: ${protocol}. Expected socks5 or socks5h`)
  }

  const port = parseInt(url.port, 10)
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid proxy port: ${url.port}`)
  }

  const proxy: any = {
    host: url.hostname,
    port,
    type: 5,
  }

  if (url.username || url.password) {
    proxy.userId = decodeURIComponent(url.username || '')
    proxy.password = decodeURIComponent(url.password || '')
  }

  let destination = { host: targetHost, port: targetPort }
  if (protocol === 'socks5') {
    // socks5: resolve host via local DNS
    const { address } = await dns.promises.lookup(targetHost, { family: 0 })
    destination = { host: address, port: targetPort }
  }

  try {
    const { socket } = await SocksClient.createConnection({
      proxy,
      destination,
      command: 'connect',
      timeout: timeoutMs,
    })
    return socket
  } catch (e: any) {
    const message = e?.message || String(e)
    if (e?.code === 'ETIMEDOUT' || /timed?\s*out/i.test(message)) {
      throw new Error(`代理不可用：${protocol} ${proxy.host}:${proxy.port} 连接超时（${timeoutMs}ms）`)
    }
    throw new Error(`代理不可用：${protocol} ${proxy.host}:${proxy.port} ${message}`)
  }
}

/**
 * Get HTTP dispatcher (undici Agent or ProxyAgent) for native fetch based on resolved outbound.
 */
export function getHttpDispatcher(outbound: ResolvedOutbound): any {
  if (outbound.mode !== 'proxy' || !outbound.proxy) {
    return undefined
  }

  if (outbound.proxy.startsWith('socks5:') || outbound.proxy.startsWith('socks5h:')) {
    // SOCKS proxy dispatcher for undici fetch
    const connector: any = (opts: any, cb: any) => {
      createSocksSocket(outbound.proxy!, opts.hostname, parseInt(opts.port, 10), 15000)
        .then((sock) => {
          if (opts.protocol === 'https:') {
            const tlsSocket = tls.connect({
              socket: sock,
              servername: opts.servername || opts.hostname,
            })
            tlsSocket.on('error', (err) => cb(err, null))
            tlsSocket.on('secureConnect', () => cb(null, tlsSocket))
          } else {
            cb(null, sock)
          }
        })
        .catch((err) => cb(err, null))
    }

    return new Agent({
      connect: connector,
    })
  }

  return new ProxyAgent(outbound.proxy)
}

/** 只支持这四种（socks5h 默认：DNS 也交给代理解，避免本机解析泄漏） */
export type ProxyProtocol = 'socks5h' | 'socks5' | 'http' | 'https'

/** 读侧（GET）的代理形状：密码只回布尔 */
export type ProxyCfg = {
  protocol: ProxyProtocol
  host: string
  port: number
  username: string
  hasPassword: boolean
}

/**
 * 写侧（POST）的负载：username 与 password 都是三态 —— 要么是字符串（本次设置），
 * 要么键不存在（保留旧值），要么是 null（清空）。
 */
export type OutboundPayload = {
  mode: 'direct' | 'proxy'
  proxy: null | (Omit<ProxyCfg, 'hasPassword' | 'username'> & {
    username?: string | null
    password?: string | null
  })
}

export type OutboundValidation = { ok: true; value: OutboundPayload } | { ok: false; error: string }

const PROTOCOLS: readonly string[] = ['socks5h', 'socks5', 'http', 'https']

/* ---- 错误文案：逐字照抄 spec §3.3 的设置页提示 ---- */
const ERR_MODE = '出站模式只能是 direct 或 proxy'
const ERR_PROTOCOL = '不支持该代理协议（支持 socks5h / socks5 / http / https）'
const ERR_HOST = '代理主机格式不对（只填主机或 IP，不要带 http:// 或端口）'
const ERR_PORT = '代理端口必须是 1–65535 的整数'
const errInvalid = (field: string) => `代理不可用：配置无效（${field}），请检查 设置 → 出站模式`

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/**
 * 校验 POST /api/outbound 的请求体。
 */
export function validateOutboundBody(body: unknown): OutboundValidation {
  const b = asRecord(body)
  if (!b) return { ok: false, error: ERR_MODE }

  if (b.mode === 'direct') return { ok: true, value: { mode: 'direct', proxy: null } }
  if (b.mode !== 'proxy') return { ok: false, error: ERR_MODE }

  const raw = asRecord(b.proxy)
  if (!raw) return { ok: false, error: errInvalid('代理') }

  const protocol = typeof raw.protocol === 'string' ? raw.protocol.trim().toLowerCase() : ''
  if (!PROTOCOLS.includes(protocol)) return { ok: false, error: ERR_PROTOCOL }

  const host = typeof raw.host === 'string' ? raw.host.trim() : ''
  if (!host || /\s/.test(host) || host.includes('/') || host.includes(':') || SCHEME.test(host)) {
    return { ok: false, error: ERR_HOST }
  }

  const port = raw.port
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: ERR_PORT }
  }

  if (raw.username !== undefined && raw.username !== null && typeof raw.username !== 'string') {
    return { ok: false, error: errInvalid('账号') }
  }

  if (raw.password !== undefined && raw.password !== null && typeof raw.password !== 'string') {
    return { ok: false, error: errInvalid('密码') }
  }

  const proxy: Omit<ProxyCfg, 'hasPassword' | 'username'> & { username?: string; password?: string } = {
    protocol: protocol as ProxyProtocol,
    host,
    port,
  }
  if (typeof raw.username === 'string') {
    proxy.username = raw.username
  } else if (raw.username === null) {
    proxy.username = ''
  }
  if (typeof raw.password === 'string') {
    proxy.password = raw.password
  } else if (raw.password === null) {
    proxy.password = ''
  }
  return { ok: true, value: { mode: 'proxy', proxy } }
}

/**
 * 合并代理设置。
 */
export function mergeProxySettings(current: any, incoming: any): any {
  const cur = asRecord(current) ?? {}
  const inc = asRecord(incoming) ?? {}
  const keep = (k: string) => inc[k] === undefined || inc[k] === null

  const protocol = keep('protocol') ? cur.protocol : inc.protocol
  const host = keep('host') ? cur.host || '' : inc.host
  const port = Number(keep('port') ? cur.port || 0 : inc.port)
  const username = keep('username') ? cur.username : inc.username

  return {
    protocol: protocol || 'socks5h',
    host,
    port,
    username: username === undefined || username === null ? '' : String(username),
    password:
      inc.password === undefined
        ? cur.password === undefined || cur.password === null
          ? ''
          : String(cur.password)
        : inc.password === null
          ? ''
          : String(inc.password),
  }
}

/** 给人看的一句话：`socks5h 127.0.0.1:10808`。永远不含账号密码，也不加方括号。 */
export function describe(p: ProxyCfg): string {
  const protocol = String(p?.protocol || '')
  const host = String(p?.host || '')
  const port = Number(p?.port || 0)
  return `${protocol} ${host}:${port}`
}

