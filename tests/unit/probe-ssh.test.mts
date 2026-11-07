import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  describeError,
  buildConnectOptions,
  probeSsh,
} from '../../server/monitor/probes/ssh.ts'
import { handlePush } from '../../server/monitor/probes/push.ts'
import type { MonitorRow } from '../../server/monitor/types.ts'

function createBaseMonitor(overrides: Partial<MonitorRow> = {}): MonitorRow {
  return {
    id: 3,
    name: 'SSH Test',
    type: 'ssh',
    group_name: '',
    active: 1,
    interval: 60,
    timeout: 5,
    maxretries: 1,
    url: null,
    keyword: null,
    invert_keyword: 0,
    accepted_statuscodes: '200-299',
    hostname: 'test.example.com',
    port: 22,
    ssh_username: 'deploy',
    ssh_password: 'secret-password',
    ssh_private_key: null,
    ssh_passphrase: null,
    ssh_auth_method: 'password',
    ssh_command: 'uptime',
    push_token: null,
    outbound_mode: 'follow',
    policy_json: null,
    description: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

test('describeError formats SSH errors into friendly user messages', () => {
  const host = '192.168.1.10'
  const port = 22

  // 1. client-authentication
  const authErr = { level: 'client-authentication', message: 'All configured authentication methods failed' }
  assert.equal(
    describeError(authErr, host, port),
    `Authentication failed for ${host}:${port} — check username, password or private key`
  )

  // 2. ECONNREFUSED
  const connRefused = { code: 'ECONNREFUSED' }
  assert.equal(
    describeError(connRefused, host, port),
    `Connection refused — ${host}:${port} actively rejected the connection`
  )

  // 3. ENOTFOUND
  const notFound = { code: 'ENOTFOUND' }
  assert.equal(
    describeError(notFound, host, port),
    `Host not found — cannot resolve hostname "${host}"`
  )

  // 4. ECONNRESET
  const connReset = { code: 'ECONNRESET' }
  assert.equal(
    describeError(connReset, host, port),
    `Connection reset by remote host ${host}:${port}`
  )

  // 5. ETIMEDOUT
  const timedOut = { code: 'ETIMEDOUT' }
  assert.equal(
    describeError(timedOut, host, port),
    `Connection timed out — ${host}:${port} did not respond in time`
  )

  // 6. EHOSTUNREACH
  const unreach = { code: 'EHOSTUNREACH' }
  assert.equal(
    describeError(unreach, host, port),
    `Network unreachable — cannot reach ${host}:${port}`
  )

  // 7. Generic message
  const generic = { message: 'Some other SSH error' }
  assert.equal(describeError(generic, host, port), 'Some other SSH error')
})

test('buildConnectOptions builds options for password and privateKey auth', async () => {
  const outbound = { mode: 'direct' as const, proxy: null, reason: 'follow:global' }

  // 1. Password auth
  {
    const m = createBaseMonitor({ ssh_auth_method: 'password', ssh_password: 'pwd' })
    const { options } = await buildConnectOptions(m, 5000, outbound)
    assert.equal(options.host, 'test.example.com')
    assert.equal(options.port, 22)
    assert.equal(options.username, 'deploy')
    assert.equal(options.password, 'pwd')
    assert.equal(options.readyTimeout, 5000)
  }

  // 2. Private key auth
  {
    const m = createBaseMonitor({
      ssh_auth_method: 'privateKey',
      ssh_private_key: '-----BEGIN RSA PRIVATE KEY-----\nMII...',
      ssh_passphrase: 'pass',
    })
    const { options } = await buildConnectOptions(m, 5000, outbound)
    assert.equal(options.privateKey, '-----BEGIN RSA PRIVATE KEY-----\nMII...')
    assert.equal(options.passphrase, 'pass')
  }

  // 3. Missing password throws
  {
    const m = createBaseMonitor({ ssh_auth_method: 'password', ssh_password: null })
    await assert.rejects(() => buildConnectOptions(m, 5000, outbound), /password is required/i)
  }

  // 4. Missing private key throws
  {
    const m = createBaseMonitor({ ssh_auth_method: 'privateKey', ssh_private_key: null })
    await assert.rejects(() => buildConnectOptions(m, 5000, outbound), /private key is required/i)
  }
})

test('probeSsh returns status 0 on missing required parameters', async () => {
  const outbound = { mode: 'direct' as const, proxy: null, reason: 'follow:global' }

  // 1. Missing command
  {
    const m = createBaseMonitor({ ssh_command: '' })
    const res = await probeSsh(m, outbound)
    assert.equal(res.status, 0)
    assert.match(res.msg, /SSH command is required/i)
  }

  // 2. Missing hostname
  {
    const m = createBaseMonitor({ hostname: null })
    const res = await probeSsh(m, outbound)
    assert.equal(res.status, 0)
    assert.match(res.msg, /Hostname is required/i)
  }
})

test('handlePush handles status, msg, and ping correctly', () => {
  const monitor = createBaseMonitor({ type: 'push', push_token: 'tok123' })

  // 1. Default up heartbeat
  {
    const res = handlePush(monitor, {})
    assert.equal(res.status, 1)
    assert.equal(res.ping, 0)
    assert.equal(res.msg, 'Push heartbeat received')
  }

  // 2. Status down
  {
    const res = handlePush(monitor, { status: 'down', msg: 'Job failed' })
    assert.equal(res.status, 0)
    assert.equal(res.msg, 'Job failed')
  }

  // 3. Custom ping and status up
  {
    const res = handlePush(monitor, { status: 'up', ping: '250', msg: 'Backup completed in 250ms' })
    assert.equal(res.status, 1)
    assert.equal(res.ping, 250)
    assert.equal(res.msg, 'Backup completed in 250ms')
  }
})
