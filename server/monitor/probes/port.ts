import net from 'node:net'
import { performance } from 'node:perf_hooks'
import { createSocksSocket } from '../outbound.ts'
import type { MonitorRow, ResolvedOutbound, ProbeResult } from '../types.ts'

/**
 * Probe a TCP port to check connectivity and measure latency.
 */
export async function probePort(
  monitor: MonitorRow,
  outbound: ResolvedOutbound
): Promise<ProbeResult> {
  if (!monitor.hostname || !monitor.hostname.trim() || !monitor.port) {
    return {
      status: 0,
      ping: null,
      msg: 'Missing hostname or port',
    }
  }

  const timeoutMs = (monitor.timeout && monitor.timeout > 0 ? monitor.timeout : 10) * 1000
  const startTime = performance.now()

  if (outbound.mode === 'proxy') {
    if (!outbound.proxy) {
      return {
        status: 0,
        ping: null,
        msg: '出站模式为「代理」但还没有配置代理服务器',
      }
    }

    try {
      const socket = await createSocksSocket(
        outbound.proxy,
        monitor.hostname,
        monitor.port,
        timeoutMs
      )
      const ping = Math.round(performance.now() - startTime)
      socket.destroy()
      return {
        status: 1,
        ping,
        msg: '[经代理] 连接成功',
      }
    } catch (err: any) {
      return {
        status: 0,
        ping: null,
        msg: err?.message || String(err),
      }
    }
  }

  // Direct TCP connection
  return new Promise<ProbeResult>((resolve) => {
    let settled = false

    const socket = net.createConnection({
      host: monitor.hostname!,
      port: monitor.port!,
      timeout: timeoutMs,
    })

    const finish = (result: ProbeResult) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }

    socket.on('connect', () => {
      const ping = Math.round(performance.now() - startTime)
      finish({
        status: 1,
        ping,
        msg: '连接成功',
      })
    })

    socket.on('timeout', () => {
      finish({
        status: 0,
        ping: null,
        msg: `Connection timed out after ${(timeoutMs / 1000).toFixed(1)}s`,
      })
    })

    socket.on('error', (err: any) => {
      finish({
        status: 0,
        ping: null,
        msg: err?.message || String(err),
      })
    })
  })
}
