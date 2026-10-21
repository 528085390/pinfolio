import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeProxy } from '../../server/mail/proxy.js'

test('空值 = 直连', () => {
  assert.deepEqual(normalizeProxy(''), { value: '' })
  assert.deepEqual(normalizeProxy('   '), { value: '' })
  assert.deepEqual(normalizeProxy(undefined), { value: '' })
})

test('只写 host:port 默认按 socks5', () => {
  assert.deepEqual(normalizeProxy('127.0.0.1:10808'), { value: 'socks5://127.0.0.1:10808' })
})

test('协议大小写归一', () => {
  assert.deepEqual(normalizeProxy('SOCKS5://127.0.0.1:10808'), { value: 'socks5://127.0.0.1:10808' })
})

test('账号密码保留', () => {
  assert.deepEqual(normalizeProxy('http://u:p@10.0.0.1:8080'), { value: 'http://u:p@10.0.0.1:8080' })
})

test('socks4a 也认', () => {
  assert.deepEqual(normalizeProxy('socks4a://1.2.3.4:1080'), { value: 'socks4a://1.2.3.4:1080' })
})

test('不支持的协议报错', () => {
  const r = normalizeProxy('ftp://1.2.3.4:21')
  assert.ok('error' in r)
  assert.match(r.error, /socks5/)
})

test('带路径报错', () => {
  const r = normalizeProxy('socks5://host:1080/path')
  assert.ok('error' in r)
  assert.match(r.error, /路径/)
})

test('端口越界报错', () => {
  const r = normalizeProxy('socks5://host:99999')
  assert.ok('error' in r)
})

test('缺主机名报错', () => {
  const r = normalizeProxy('socks5://')
  assert.ok('error' in r)
})
