import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashPassword, verifyPassword } from '../../server/auth/password.js'
import { hashToken, newApiToken, newSessionToken } from '../../server/auth/tokens.js'
import { LoginLimiter } from '../../server/auth/limiter.js'

test('密码哈希：正确密码通过、错误密码拒绝', () => {
  const stored = hashPassword('correct horse')
  assert.match(stored, /^scrypt\$/)
  assert.equal(verifyPassword('correct horse', stored), true)
  assert.equal(verifyPassword('wrong', stored), false)
})

test('密码哈希：每次加盐不同', () => {
  assert.notEqual(hashPassword('x'), hashPassword('x'))
})

test('密码哈希：损坏的存储值一律拒绝，不抛错', () => {
  for (const bad of ['', 'plain', 'scrypt$only', 'md5$a$b', 'scrypt$$', 'scrypt$!!!$???']) {
    assert.equal(verifyPassword('x', bad), false)
  }
})

test('会话 token 随机且 hash 稳定、不可逆', () => {
  const a = newSessionToken()
  const b = newSessionToken()
  assert.notEqual(a, b)
  assert.equal(hashToken(a), hashToken(a))
  assert.notEqual(hashToken(a), a)
  assert.match(hashToken(a), /^[0-9a-f]{64}$/)
})

test('API token 带 pb_ 前缀，hash 与 token 对应', () => {
  const { token, hash } = newApiToken()
  assert.ok(token.startsWith('pb_'))
  assert.equal(hash, hashToken(token))
})

test('登录限流：5 次失败封 30 秒，再失败翻倍到 60 秒', () => {
  const lim = new LoginLimiter()
  const ip = '1.2.3.4'
  const now = 1_000_000
  for (let i = 0; i < 4; i++) {
    lim.fail(ip, now)
    assert.equal(lim.check(ip, now).allowed, true)
  }
  lim.fail(ip, now)
  const blocked = lim.check(ip, now)
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.retryAfterMs, 30_000)
  assert.equal(lim.check(ip, now + 30_001).allowed, true)
  lim.fail(ip, now + 30_001)
  assert.equal(lim.check(ip, now + 30_001).retryAfterMs, 60_000)
})

test('登录限流：成功登录清零', () => {
  const lim = new LoginLimiter()
  const ip = '9.9.9.9'
  for (let i = 0; i < 4; i++) lim.fail(ip, 0)
  lim.succeed(ip)
  for (let i = 0; i < 4; i++) lim.fail(ip, 0)
  assert.equal(lim.check(ip, 0).allowed, true)
})

test('登录限流：窗口过后计数重新开始', () => {
  const lim = new LoginLimiter()
  const ip = '5.5.5.5'
  for (let i = 0; i < 4; i++) lim.fail(ip, 0)
  lim.fail(ip, 15 * 60_000 + 1)
  assert.equal(lim.check(ip, 15 * 60_000 + 1).allowed, true)
})
