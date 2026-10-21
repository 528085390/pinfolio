// 资产抽屉的表单逻辑（web/components/asset-drawer/form.ts）
// 运行：pnpm test:unit
import test from 'node:test'
import assert from 'node:assert/strict'
import { blank, buildPayload, parseTags, toForm } from '../../web/components/asset-drawer/form.js'

test('blank：登记新资产时的默认值', () => {
  assert.deepEqual(blank(), {
    name: '', kind: 'device', status: 'active', location: '', vendor: '', serial: '',
    price: '', currency: 'CNY', purchasedAt: '', expiresAt: '', url: '', notes: '', custom: {},
  })
})

test('toForm：后端缺省字段的兜底', () => {
  const f = toForm({ id: 1, name: 'x' } as any)
  assert.equal(f.kind, 'device')
  assert.equal(f.status, 'active')
  assert.equal(f.currency, 'CNY')
  assert.equal(f.price, '')
  assert.equal(f.purchasedAt, '')
  assert.deepEqual(f.custom, {})
})

test('toForm：price 数字转字符串，0 保留成 "0"', () => {
  assert.equal(toForm({ id: 1, name: 'x', price: 200 } as any).price, '200')
  assert.equal(toForm({ id: 1, name: 'x', price: 0 } as any).price, '0')
  assert.equal(toForm({ id: 1, name: 'x', price: null } as any).price, '')
})

test('toForm：custom 是浅拷贝，不改后端对象', () => {
  const src = { id: 1, name: 'x', custom: { ip: '1.2.3.4' } } as any
  const f = toForm(src)
  f.custom.ip = '5.6.7.8'
  assert.equal(src.custom.ip, '1.2.3.4')
})

test('parseTags：空格 / 中英文逗号都能分隔，去掉前导 #，空项丢掉', () => {
  assert.deepEqual(parseTags('服务器 阿里云'), ['服务器', '阿里云'])
  assert.deepEqual(parseTags('服务器,阿里云，京东'), ['服务器', '阿里云', '京东'])
  assert.deepEqual(parseTags('#服务器  #阿里云'), ['服务器', '阿里云'])
  assert.deepEqual(parseTags('   '), [])
  assert.deepEqual(parseTags(''), [])
})

test('buildPayload：字符串 trim、空价格与空日期转 null', () => {
  const p = buildPayload({ ...blank(), name: '  wb2  ', location: ' 机房 ', price: '', purchasedAt: '', expiresAt: '' }, '')
  assert.equal(p.name, 'wb2')
  assert.equal(p.location, '机房')
  assert.equal(p.price, null)
  assert.equal(p.purchasedAt, null)
  assert.equal(p.expiresAt, null)
  assert.deepEqual(p.tags, [])
})

test('buildPayload：价格字符串转数字，标签从输入框解析', () => {
  const p = buildPayload({ ...blank(), name: 'x', price: '199.5', expiresAt: '2027-01-01' }, '#服务器 阿里云')
  assert.equal(p.price, 199.5)
  assert.equal(p.expiresAt, '2027-01-01')
  assert.deepEqual(p.tags, ['服务器', '阿里云'])
})

test('buildPayload：备注不做 trim、custom 原样带过去', () => {
  const p = buildPayload({ ...blank(), name: 'x', notes: '  保留缩进  ', custom: { ip: '1.2.3.4' } }, '')
  assert.equal(p.notes, '  保留缩进  ')
  assert.deepEqual(p.custom, { ip: '1.2.3.4' })
})
