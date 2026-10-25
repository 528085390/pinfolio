import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideConfigured, FORK_FIELDS, flavorOf, isConfigured } from '../../server/kuma/meta.js'

// 纯函数单测：风味判定与「配没配」都只看入参，不连网络、不碰库。
// 运行时那层（kumaFlavor 的缓存与失败降级）靠真机验证，见 spec 06 的验收段。

test('flavorOf：拿不到列表时按 upstream', () => {
  assert.equal(flavorOf(null), 'upstream')
  assert.equal(flavorOf(undefined), 'upstream')
  assert.equal(flavorOf('boom'), 'upstream')
  assert.equal(flavorOf(42), 'upstream')
})

test('flavorOf：空对象 / 空数组 / 字段缺失都按 upstream', () => {
  assert.equal(flavorOf({}), 'upstream')
  assert.equal(flavorOf([]), 'upstream')
  assert.equal(flavorOf({ monitors: [] }), 'upstream')
  assert.equal(flavorOf([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]), 'upstream')
})

test('flavorOf：任意一条带 fork 扩展字段就算 fork', () => {
  assert.equal(flavorOf([{ id: 1 }, { id: 2, [FORK_FIELDS[0]]: '{}' }]), 'fork')
  // 字段存在但值为空也算 fork —— 看的是「有没有这个字段」
  assert.equal(flavorOf([{ [FORK_FIELDS[0]]: null }]), 'fork')
})

test('flavorOf：也接受对象形态（id -> bean）', () => {
  assert.equal(flavorOf({ 1: { id: 1 }, 2: { id: 2, [FORK_FIELDS[0]]: '{}' } }), 'fork')
  assert.equal(flavorOf({ 1: { id: 1 } }), 'upstream')
})

test('flavorOf：列表里混进 null / 字符串不会炸', () => {
  assert.equal(flavorOf([null, 'x', 1, { id: 3 }]), 'upstream')
  assert.equal(flavorOf([null, { [FORK_FIELDS[0]]: '{}' }]), 'fork')
})

test('flavorOf：显式 override 优先于探测结果', () => {
  assert.equal(flavorOf([{ [FORK_FIELDS[0]]: '{}' }], 'upstream'), 'upstream')
  assert.equal(flavorOf([{ id: 1 }], 'fork'), 'fork')
  // 大小写与空白都不敏感
  assert.equal(flavorOf([{ id: 1 }], ' FORK '), 'fork')
  // 认不出来的值等于没指定，照常看字段
  assert.equal(flavorOf([{ [FORK_FIELDS[0]]: '{}' }], 'auto'), 'fork')
  assert.equal(flavorOf([{ id: 1 }], 'nonsense'), 'upstream')
})

test('isConfigured：有地址或有口令都算配了', () => {
  assert.equal(isConfigured({ url: 'http://127.0.0.1:3001' }), true)
  assert.equal(isConfigured({ pass: 'secret' }), true)
  assert.equal(isConfigured({ url: 'http://kuma:3001', pass: 'secret' }), true)
})

test('decideConfigured：显式配置了就算配了，哪怕此刻连不上', () => {
  assert.equal(decideConfigured({ url: 'http://kuma:3001' }, false), true)
  assert.equal(decideConfigured({ pass: 'secret' }, false), true)
})

test('decideConfigured：没配置但默认地址上读得到状态页，也算配了', () => {
  assert.equal(decideConfigured({}, true), true)
  assert.equal(decideConfigured({}, false), false)
  assert.equal(decideConfigured({ url: '  ', pass: ' ' }, false), false)
})

test('isConfigured：都没有（或只有空白）算没配', () => {
  assert.equal(isConfigured({}), false)
  assert.equal(isConfigured(), false)
  assert.equal(isConfigured({ url: '   ', pass: '' }), false)
})
