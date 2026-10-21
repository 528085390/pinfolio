import test from 'node:test'
import assert from 'node:assert/strict'
import { mapBeat, toIso, toneChar } from '../../server/kuma/beat.js'

test('toneChar：四种前缀', () => {
  assert.equal(toneChar('[绿] 正常'), '绿')
  assert.equal(toneChar('[黄] 慢'), '黄')
  assert.equal(toneChar('[红] 挂了'), '红')
  assert.equal(toneChar('[灰] 跳过'), '灰')
})

test('toneChar：允许前导空白，没有前缀给 null', () => {
  assert.equal(toneChar('  [红] 挂了'), '红')
  assert.equal(toneChar('正常'), null)
  assert.equal(toneChar(''), null)
  assert.equal(toneChar(null), null)
  assert.equal(toneChar(undefined), null)
})

test('toneChar：不在开头的不算', () => {
  assert.equal(toneChar('没事 [绿]'), null)
})

test('toIso：Kuma 的无时区 UTC 串按 UTC 解析', () => {
  assert.equal(toIso('2026-10-19 08:35:24.131'), '2026-10-19T08:35:24.131Z')
  assert.equal(toIso('2026-10-19T08:35:24'), '2026-10-19T08:35:24.000Z')
  assert.equal(toIso('2026-10-19 08:35:24.5'), '2026-10-19T08:35:24.500Z')
})

test('toIso：空值和乱码给 null', () => {
  assert.equal(toIso(''), null)
  assert.equal(toIso(null), null)
  assert.equal(toIso('昨天'), null)
})

test('mapBeat：字段归一 + 四态', () => {
  assert.deepEqual(mapBeat({ status: 1, time: '2026-10-19 08:35:24', msg: '  [绿] ok  ', ping: 12 }), {
    status: 1,
    time: '2026-10-19T08:35:24.000Z',
    msg: '[绿] ok',
    ping: 12,
    tone: '绿',
  })
})

test('mapBeat：空对象全给默认值', () => {
  assert.deepEqual(mapBeat({}), { status: null, time: null, msg: '', ping: null, tone: null })
})
