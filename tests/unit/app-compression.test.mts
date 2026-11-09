import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../../server/app.js'

test('Hono compress: 当客户端带 Accept-Encoding: gzip 时返回 gzip 压缩头', async () => {
  const app = createApp()
  const res = await app.request('/api/health', {
    headers: { 'Accept-Encoding': 'gzip' },
  })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-encoding'), 'gzip')
})

test('Hono compress: 当客户端不带 Accept-Encoding 时不返回压缩头', async () => {
  const app = createApp()
  const res = await app.request('/api/health')
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-encoding'), null)
})
