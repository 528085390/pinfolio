import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { MIGRATIONS, migrate } from '../../server/migrations.js'
import { checkTunnel, getTunnel, instanceId, normalizePublicUrl, setPublicUrl } from '../../server/tunnel-core.js'

function fresh() {
  const db = new DatabaseSync(':memory:')
  migrate(db, MIGRATIONS)
  return db
}

// 起一个假公网端点，按给定 body 回 /api/health
async function fakePublic(body: unknown) {
  const srv = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
  const { port } = srv.address() as AddressInfo
  return { url: 'http://127.0.0.1:' + port, close: () => new Promise<void>((r) => srv.close(() => r())) }
}

test('公网地址规范化：去空格与结尾斜杠，保留子路径', () => {
  assert.equal(normalizePublicUrl(' https://example.com/pinfolio/ '), 'https://example.com/pinfolio')
  assert.equal(normalizePublicUrl('http://1.2.3.4'), 'http://1.2.3.4')
  assert.equal(normalizePublicUrl('https://example.com//'), 'https://example.com')
  assert.equal(normalizePublicUrl(''), '')
  assert.equal(normalizePublicUrl(null), '')
  assert.throws(() => normalizePublicUrl('ftp://example.com'), /http/)
  assert.throws(() => normalizePublicUrl('example.com'), /地址格式/)
})

test('实例 id 生成一次后固定', () => {
  const db = fresh()
  const id = instanceId(db)
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-/)
  assert.equal(instanceId(db), id)
  assert.equal(getTunnel(db).instanceId, id)
})

test('没配地址时不探活，状态是未检测', async () => {
  const db = fresh()
  const st = await checkTunnel(db)
  assert.equal(st.publicUrl, '')
  assert.equal(st.online, null)
  assert.equal(st.error, null)
})

test('探活：公网地址指向自己 → 在线并记录延迟', async () => {
  const db = fresh()
  const srv = await fakePublic({ ok: true, id: instanceId(db) })
  try {
    setPublicUrl(db, srv.url + '/')
    assert.equal(getTunnel(db).publicUrl, srv.url)
    const st = await checkTunnel(db)
    assert.equal(st.online, true)
    assert.equal(st.error, null)
    assert.equal(typeof st.latencyMs, 'number')
    assert.ok(st.okAt)
  } finally {
    await srv.close()
  }
})

test('探活：返回的不是这台机器 → 离线并说明原因', async () => {
  const db = fresh()
  const srv = await fakePublic({ ok: true, id: 'another-instance' })
  try {
    setPublicUrl(db, srv.url)
    const st = await checkTunnel(db)
    assert.equal(st.online, false)
    assert.match(st.error ?? '', /不是这台机器/)
  } finally {
    await srv.close()
  }
})

test('探活：连不上 → 离线且保留上次正常时间', async () => {
  const db = fresh()
  const srv = await fakePublic({ ok: true, id: instanceId(db) })
  setPublicUrl(db, srv.url)
  const ok = await checkTunnel(db)
  assert.equal(ok.online, true)
  await srv.close()
  const st = await checkTunnel(db, 1500)
  assert.equal(st.online, false)
  assert.equal(st.okAt, ok.okAt)
  assert.ok(st.error)
})
