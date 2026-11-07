import { performance } from 'node:perf_hooks'
import { getHttpDispatcher } from '../outbound.ts'
import type { MonitorRow, ResolvedOutbound, ProbeResult } from '../types.ts'

/**
 * Check if the HTTP status code falls into the accepted status codes list or range.
 */
export function isStatusAccepted(status: number, acceptedCodesStr?: string | null): boolean {
  if (!acceptedCodesStr || !acceptedCodesStr.trim()) {
    // Default range is 200-299
    return status >= 200 && status <= 299
  }

  const trimmed = acceptedCodesStr.trim()
  let tokens: string[] = []

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        tokens = parsed.map(String)
      }
    } catch {
      tokens = [trimmed]
    }
  } else {
    tokens = trimmed.split(',').map((s) => s.trim()).filter(Boolean)
  }

  for (const token of tokens) {
    const range = token.split('-').map((s) => parseInt(s.trim(), 10))
    if (range.length === 1 && !isNaN(range[0])) {
      if (status === range[0]) return true
    } else if (range.length === 2 && !isNaN(range[0]) && !isNaN(range[1])) {
      if (status >= range[0] && status <= range[1]) return true
    }
  }

  return false
}

/**
 * Probe an HTTP endpoint using native fetch.
 */
export async function probeHttp(
  monitor: MonitorRow,
  outbound: ResolvedOutbound
): Promise<ProbeResult> {
  if (!monitor.url || !monitor.url.trim()) {
    return {
      status: 0,
      ping: null,
      msg: 'Missing URL',
    }
  }

  const timeoutMs = (monitor.timeout && monitor.timeout > 0 ? monitor.timeout : 10) * 1000
  const startTime = performance.now()

  try {
    const dispatcher = getHttpDispatcher(outbound)
    const fetchOptions: any = {
      signal: AbortSignal.timeout(timeoutMs),
    }
    if (dispatcher) {
      fetchOptions.dispatcher = dispatcher
    }

    const res = await fetch(monitor.url, fetchOptions)
    const ping = Math.round(performance.now() - startTime)

    // Validate status code
    const accepted = isStatusAccepted(res.status, monitor.accepted_statuscodes)
    if (!accepted) {
      const statusMsg = res.statusText ? `${res.status} - ${res.statusText}` : `${res.status}`
      return {
        status: 0,
        ping,
        msg: statusMsg,
      }
    }

    // Validate keyword if configured
    if (monitor.keyword) {
      const text = await res.text()
      const found = text.includes(monitor.keyword)

      if (monitor.invert_keyword) {
        if (found) {
          return {
            status: 0,
            ping,
            msg: `Found keyword "${monitor.keyword}" (inverted)`,
          }
        }
      } else {
        if (!found) {
          return {
            status: 0,
            ping,
            msg: `Keyword "${monitor.keyword}" not found`,
          }
        }
      }
    }

    const okMsg = res.statusText ? `${res.status} - ${res.statusText}` : `${res.status}`
    return {
      status: 1,
      ping,
      msg: okMsg,
    }
  } catch (err: any) {
    return {
      status: 0,
      ping: null,
      msg: err?.message || String(err),
    }
  }
}
