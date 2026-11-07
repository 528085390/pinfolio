import type { MonitorRow, ProbeResult } from '../types.ts'

/**
 * Handle incoming push heartbeat query parameters and format as ProbeResult.
 */
export function handlePush(
  _monitor: MonitorRow,
  query?: { status?: string; msg?: string; ping?: string | number }
): ProbeResult {
  const statusStr = (query?.status || 'up').toLowerCase()
  const status = statusStr === 'down' ? 0 : 1

  let ping = 0
  if (query?.ping !== undefined && query?.ping !== null) {
    const parsed = typeof query.ping === 'number' ? query.ping : parseInt(query.ping, 10)
    if (!isNaN(parsed) && parsed >= 0) {
      ping = parsed
    }
  }

  const msg = query?.msg || 'Push heartbeat received'

  return {
    status,
    ping,
    msg,
  }
}
