import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickClientIp } from '../../server/auth/middleware.js'

test('客户端 IP 取 X-Forwarded-For 的最后一段（反代追加在最前，第一段客户端可伪造）', () => {
  assert.equal(pickClientIp('1.2.3.4'), '1.2.3.4')
  assert.equal(pickClientIp('9.9.9.9, 203.0.113.7'), '203.0.113.7')
  assert.equal(pickClientIp('9.9.9.9, 8.8.8.8, 203.0.113.7'), '203.0.113.7')
})

test('空值与空白段退回 null', () => {
  assert.equal(pickClientIp(undefined), null)
  assert.equal(pickClientIp(null), null)
  assert.equal(pickClientIp(''), null)
  assert.equal(pickClientIp('   '), null)
  assert.equal(pickClientIp(' , , '), null)
})

test('两段里的空段被忽略，仍然取最后一个有效值', () => {
  assert.equal(pickClientIp('1.2.3.4, , 203.0.113.7'), '203.0.113.7')
  assert.equal(pickClientIp('1.2.3.4, 203.0.113.7, '), '203.0.113.7')
})
