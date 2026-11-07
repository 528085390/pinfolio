import { performance } from 'node:perf_hooks'
import { Client } from 'ssh2'
import { createSocksSocket } from '../outbound.ts'
import type { MonitorRow, ResolvedOutbound, ProbeResult } from '../types.ts'

const MAX_OUTPUT_LENGTH = 200
const MAX_CAPTURE_LENGTH = 4096

/**
 * Shorten command output to single-line string with maximum length.
 */
export function shorten(text: string | null | undefined): string {
  const singleLine = (text || '').replace(/\s+/g, ' ').trim()
  if (singleLine.length > MAX_OUTPUT_LENGTH) {
    return singleLine.substring(0, MAX_OUTPUT_LENGTH) + '...'
  }
  return singleLine
}

/**
 * Format raw ssh2 error into human readable message.
 */
export function describeError(err: any, host: string, port: number | string): string {
  if (err && err.level === 'client-authentication') {
    return `Authentication failed for ${host}:${port} — check username, password or private key`
  }

  switch (err && err.code) {
    case 'ECONNREFUSED':
      return `Connection refused — ${host}:${port} actively rejected the connection`
    case 'ENOTFOUND':
      return `Host not found — cannot resolve hostname "${host}"`
    case 'ECONNRESET':
      return `Connection reset by remote host ${host}:${port}`
    case 'ETIMEDOUT':
      return `Connection timed out — ${host}:${port} did not respond in time`
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return `Network unreachable — cannot reach ${host}:${port}`
    default:
      return (err && err.message) || `SSH connection to ${host}:${port} failed`
  }
}

/**
 * Build connection options for ssh2 Client.
 */
export async function buildConnectOptions(
  monitor: MonitorRow,
  timeoutMs: number,
  outbound: ResolvedOutbound
): Promise<{ options: any; sock: any | null }> {
  const options: any = {
    host: monitor.hostname,
    port: monitor.port || 22,
    username: monitor.ssh_username,
    readyTimeout: timeoutMs,
  }

  if (monitor.ssh_auth_method === 'privateKey') {
    if (!monitor.ssh_private_key) {
      throw new Error('SSH private key is required for key-based authentication')
    }
    options.privateKey = monitor.ssh_private_key
    if (monitor.ssh_passphrase) {
      options.passphrase = monitor.ssh_passphrase
    }
  } else {
    if (!monitor.ssh_password) {
      throw new Error('SSH password is required for password authentication')
    }
    options.password = monitor.ssh_password
  }

  let sock: any = null
  if (outbound.mode === 'proxy') {
    if (!outbound.proxy) {
      throw new Error('出站模式为「代理」但还没有配置代理服务器')
    }
    sock = await createSocksSocket(outbound.proxy, options.host, options.port, timeoutMs)
    options.sock = sock
  }

  return { options, sock }
}

/**
 * Probe a remote server over SSH, execute command and verify exit code.
 */
export async function probeSsh(
  monitor: MonitorRow,
  outbound: ResolvedOutbound
): Promise<ProbeResult> {
  const command = (monitor.ssh_command || '').trim()
  if (!command) {
    return {
      status: 0,
      ping: null,
      msg: 'SSH command is required.',
    }
  }
  if (command.includes('\u0000')) {
    return {
      status: 0,
      ping: null,
      msg: 'SSH command must not contain NUL bytes.',
    }
  }

  const host = monitor.hostname
  if (!host) {
    return {
      status: 0,
      ping: null,
      msg: 'Hostname is required.',
    }
  }
  const port = monitor.port || 22

  const timeoutSeconds = monitor.timeout && monitor.timeout > 0 ? monitor.timeout : 10
  const timeoutMs = timeoutSeconds * 1000
  const startTime = performance.now()

  let sock: any = null
  try {
    const built = await buildConnectOptions(monitor, timeoutMs, outbound)
    sock = built.sock
    const options = built.options

    return await new Promise<ProbeResult>((resolve) => {
      const client = new Client()
      let settled = false
      let timer: any = null

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        try {
          client.end()
        } catch {
          // ignore error closing already closed client
        }
      }

      const fail = (err: any) => {
        if (settled) return
        settled = true
        sock?.destroy()
        cleanup()
        const ping = Math.round(performance.now() - startTime)
        const errMsg = typeof err === 'string' ? err : err?.message || String(err)
        resolve({
          status: 0,
          ping,
          msg: errMsg,
        })
      }

      const succeed = (msg: string) => {
        if (settled) return
        settled = true
        cleanup()
        const ping = Math.round(performance.now() - startTime)
        resolve({
          status: 1,
          ping,
          msg,
        })
      }

      // Safety timeout
      timer = setTimeout(() => {
        sock?.destroy()
        fail(new Error(`SSH check timed out after ${timeoutSeconds}s`))
      }, timeoutMs + 5000)

      client.on('ready', () => {
        client.exec(command, (execError: any, stream: any) => {
          if (execError) {
            fail(new Error(`SSH exec failed: ${execError.message}`))
            return
          }

          let stdout = ''
          let stderr = ''

          stream.on('data', (data: any) => {
            if (stdout.length < MAX_CAPTURE_LENGTH) {
              stdout += data.toString()
            }
          })
          stream.stderr.on('data', (data: any) => {
            if (stderr.length < MAX_CAPTURE_LENGTH) {
              stderr += data.toString()
            }
          })
          stream.on('close', (code: number, signal?: string) => {
            const out = shorten(stdout)
            const errOut = shorten(stderr)
            if (code === 0) {
              succeed(out ? `exit 0: ${out}` : 'exit 0')
            } else {
              const summary = errOut || out
              const reason = summary
                ? `exit ${code}: ${summary}`
                : `command exited with code ${code}${signal ? ` (${signal})` : ''}`
              fail(new Error(reason))
            }
          })
        })
      })

      client.on('error', (err: any) => {
        sock?.destroy()
        fail(new Error(describeError(err, host, port)))
      })

      try {
        client.connect(options)
      } catch (err: any) {
        fail(new Error(describeError(err, host, port)))
      }
    })
  } catch (err: any) {
    sock?.destroy()
    return {
      status: 0,
      ping: null,
      msg: err?.message || String(err),
    }
  }
}
