import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { probeHttp } from '../../server/monitor/probes/http.ts'
import { resolveOutbound } from '../../server/monitor/outbound.ts'
import type { MonitorRow, OutboundConfig } from '../../server/monitor/types.ts'

function createBaseMonitor(overrides: Partial<MonitorRow> = {}): MonitorRow {
  return {
    id: 1,
    name: 'HTTP Test',
    type: 'http',
    group_name: '',
    active: 1,
    interval: 60,
    timeout: 5,
    maxretries: 1,
    url: 'http://127.0.0.1:0',
    keyword: null,
    invert_keyword: 0,
    accepted_statuscodes: '200-299',
    hostname: null,
    port: null,
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

test('resolveOutbound routes correctly for direct, proxy, and follow', () => {
  const globalProxy: OutboundConfig = {
    mode: 'proxy',
    proxy: 'socks5h://127.0.0.1:1080',
  }
  const globalDirect: OutboundConfig = {
    mode: 'direct',
    proxy: null,
  }

  // 1. Pinned direct
  const r1 = resolveOutbound('direct', globalProxy)
  assert.equal(r1.mode, 'direct')
  assert.equal(r1.reason, 'pinned:direct')

  // 2. Pinned proxy
  const r2 = resolveOutbound('proxy', globalDirect)
  assert.equal(r2.mode, 'proxy')
  assert.equal(r2.reason, 'pinned:proxy')

  // 3. Follow with global proxy
  const r3 = resolveOutbound('follow', globalProxy)
  assert.equal(r3.mode, 'proxy')
  assert.equal(r3.reason, 'follow:global')
  assert.equal(r3.proxy, 'socks5h://127.0.0.1:1080')

  // 4. Follow with global direct
  const r4 = resolveOutbound('follow', globalDirect)
  assert.equal(r4.mode, 'direct')
  assert.equal(r4.reason, 'follow:global')

  // 5. Empty / null monitorMode defaults to follow
  const r5 = resolveOutbound(null, globalProxy)
  assert.equal(r5.mode, 'proxy')
  assert.equal(r5.reason, 'follow:global')
})

test('probeHttp: missing URL returns status 0 with Missing URL', async () => {
  const monitor = createBaseMonitor({ url: null })
  const outbound = { mode: 'direct' as const, proxy: null, reason: 'follow:global' }
  const result = await probeHttp(monitor, outbound)
  assert.equal(result.status, 0)
  assert.equal(result.ping, null)
  assert.match(result.msg, /Missing URL/i)
})

test('probeHttp: validates 200 OK, non-200 status, keywords, and timeout', async () => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`)
    if (url.pathname === '/ok') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('healthy and operational')
    } else if (url.pathname === '/404') {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('not found')
    } else if (url.pathname === '/custom-status') {
      res.writeHead(302, { Location: '/ok' })
      res.end('redirect')
    } else if (url.pathname === '/hang') {
      // Don't respond to trigger timeout
      setTimeout(() => {
        if (!res.writableEnded) res.end('too late')
      }, 1000)
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('internal server error')
    }
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as AddressInfo).port
  const baseUrl = `http://127.0.0.1:${port}`
  const outbound = { mode: 'direct' as const, proxy: null, reason: 'follow:global' }

  try {
    // 1. Standard 200 OK
    {
      const monitor = createBaseMonitor({ url: `${baseUrl}/ok` })
      const res = await probeHttp(monitor, outbound)
      assert.equal(res.status, 1)
      assert.ok(typeof res.ping === 'number' && res.ping >= 0)
      assert.match(res.msg, /200/)
    }

    // 2. 404 with default accepted_statuscodes (200-299)
    {
      const monitor = createBaseMonitor({ url: `${baseUrl}/404` })
      const res = await probeHttp(monitor, outbound)
      assert.equal(res.status, 0)
      assert.match(res.msg, /404/)
    }

    // 3. 404 with accepted_statuscodes including 404
    {
      const monitor = createBaseMonitor({
        url: `${baseUrl}/404`,
        accepted_statuscodes: '200-299, 404',
      })
      const res = await probeHttp(monitor, outbound)
      assert.equal(res.status, 1)
      assert.match(res.msg, /404/)
    }

    // 4. Keyword match success
    {
      const monitor = createBaseMonitor({
        url: `${baseUrl}/ok`,
        keyword: 'healthy',
      })
      const res = await probeHttp(monitor, outbound)
      assert.equal(res.status, 1)
    }

    // 5. Keyword match failure (missing keyword)
    {
      const monitor = createBaseMonitor({
        url: `${baseUrl}/ok`,
        keyword: 'unhealthy',
      })
      const res = await probeHttp(monitor, outbound)
      assert.equal(res.status, 0)
      assert.match(res.msg, /unhealthy/i)
    }

    // 6. Invert keyword: success when keyword absent
    {
      const monitor = createBaseMonitor({
        url: `${baseUrl}/ok`,
        keyword: 'error',
        invert_keyword: 1,
      })
      const res = await probeHttp(monitor, outbound)
      assert.equal(res.status, 1)
    }

    // 7. Invert keyword: failure when keyword present
    {
      const monitor = createBaseMonitor({
        url: `${baseUrl}/ok`,
        keyword: 'healthy',
        invert_keyword: 1,
      })
      const res = await probeHttp(monitor, outbound)
      assert.equal(res.status, 0)
      assert.match(res.msg, /healthy/i)
    }

    // 8. Timeout
    {
      const monitor = createBaseMonitor({
        url: `${baseUrl}/hang`,
        timeout: 0.1, // 100ms
      })
      const res = await probeHttp(monitor, outbound)
      assert.equal(res.status, 0)
      assert.equal(res.ping, null)
      assert.match(res.msg, /time|abort/i)
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
