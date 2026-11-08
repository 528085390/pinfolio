import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { probePort } from '../../server/monitor/probes/port.ts'
import type { MonitorRow } from '../../server/monitor/types.ts'

function createBaseMonitor(overrides: Partial<MonitorRow> = {}): MonitorRow {
  return {
    id: 2,
    name: 'TCP Port Test',
    type: 'port',
    group_name: '',
    active: 1,
    interval: 60,
    timeout: 5,
    maxretries: 1,
    url: null,
    keyword: null,
    invert_keyword: 0,
    accepted_statuscodes: '200-299',
    hostname: '127.0.0.1',
    port: 0,
    ssh_username: null,
    ssh_password: null,
    ssh_private_key: null,
    ssh_passphrase: null,
    ssh_auth_method: null,
    ssh_command: null,
    push_token: null,
    outbound_mode: 'follow',
    policy_json: null,
    description: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

test('probePort: missing hostname or port returns status 0', async () => {
  const outbound = { mode: 'direct' as const, proxy: null, reason: 'follow:global' }
  {
    const m = createBaseMonitor({ hostname: null, port: 8080 })
    const res = await probePort(m, outbound)
    assert.equal(res.status, 0)
    assert.match(res.msg, /Missing hostname or port/i)
  }
  {
    const m = createBaseMonitor({ hostname: '127.0.0.1', port: null })
    const res = await probePort(m, outbound)
    assert.equal(res.status, 0)
    assert.match(res.msg, /Missing hostname or port/i)
  }
})

test('probePort: connects to active TCP server and measures latency', async () => {
  const server = net.createServer((socket) => {
    // Keep connection alive until client closes
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as AddressInfo).port
  const outbound = { mode: 'direct' as const, proxy: null, reason: 'follow:global' }

  try {
    const monitor = createBaseMonitor({ hostname: '127.0.0.1', port, timeout: 2 })
    const res = await probePort(monitor, outbound)
    assert.equal(res.status, 1)
    assert.ok(typeof res.ping === 'number' && res.ping >= 0)
    assert.equal(res.msg, '连接成功')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('probePort: closed port returns status 0 with error message', async () => {
  // Find an unused closed port
  const tempServer = net.createServer()
  await new Promise<void>((resolve) => tempServer.listen(0, '127.0.0.1', () => resolve()))
  const unusedPort = (tempServer.address() as AddressInfo).port
  await new Promise<void>((resolve) => tempServer.close(() => resolve()))

  const outbound = { mode: 'direct' as const, proxy: null, reason: 'follow:global' }
  const monitor = createBaseMonitor({ hostname: '127.0.0.1', port: unusedPort, timeout: 1 })
  const res = await probePort(monitor, outbound)

  assert.equal(res.status, 0)
  assert.equal(res.ping, null)
  assert.match(res.msg, /ECONNREFUSED|connect/i)
})

test('probePort: proxy mode without proxy config returns status 0', async () => {
  const outbound = { mode: 'proxy' as const, proxy: null, reason: 'pinned:proxy' }
  const monitor = createBaseMonitor({ hostname: '127.0.0.1', port: 8080 })
  const res = await probePort(monitor, outbound)
  assert.equal(res.status, 0)
  assert.match(res.msg, /代理/i)
})
