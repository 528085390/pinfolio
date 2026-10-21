import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addrList, addrText, bytes } from '../../web/components/mail-reader/text.js'

test('addrText：名字和地址都有时写成「名字 <地址>」', () => {
  assert.equal(addrText({ name: '张三', address: 'a@b.com' }), '张三 <a@b.com>')
})

test('addrText：只有一半时只写那一半', () => {
  assert.equal(addrText({ name: '', address: 'a@b.com' }), 'a@b.com')
  assert.equal(addrText({ name: '张三', address: '' }), '张三')
  assert.equal(addrText(null), '')
  assert.equal(addrText(undefined), '')
  assert.equal(addrText({ name: '', address: '' }), '')
})

test('addrList：空列表写「（无）」而不是空串', () => {
  assert.equal(addrList(undefined), '（无）')
  assert.equal(addrList([]), '（无）')
})

test('addrList：多人用中文逗号连起来，空项被丢掉', () => {
  const out = addrList([
    { name: '张三', address: 'a@b.com' },
    { name: '', address: 'c@d.com' },
    { name: '', address: '' },
  ])
  assert.equal(out, '张三 <a@b.com>，c@d.com')
})

test('bytes：0 / 空值不出单位', () => {
  assert.equal(bytes(0), '')
})

test('bytes：小于 10 KB 留一位小数，10 KB 以上取整', () => {
  assert.equal(bytes(512), '512 B')
  assert.equal(bytes(2048), '2.0 KB')
  assert.equal(bytes(20480), '20 KB')
})

test('bytes：超过 1 MB 用 MB 并留一位小数', () => {
  assert.equal(bytes(3 * 1024 * 1024), '3.0 MB')
})
