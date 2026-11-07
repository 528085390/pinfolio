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
