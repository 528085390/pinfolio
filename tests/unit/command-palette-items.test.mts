// 命令面板的纯逻辑（web/components/command-palette/items.ts）
// 运行：pnpm test:unit
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assetSub, moveSel, noteLabel, noteSub, paletteHint,
} from '../../web/components/command-palette/items.js'

test('noteLabel：连续空白压成一个空格，超长截到 70 字', () => {
  assert.equal(noteLabel('第一行\n\n第二行\t 缩进'), '第一行 第二行 缩进')
  assert.equal(noteLabel(''), '')
  const long = 'a'.repeat(100)
  assert.equal(noteLabel(long).length, 70)
})

test('noteSub：有标签就列 #标签，没有就写「便签」', () => {
  assert.equal(noteSub([]), '便签')
  assert.equal(noteSub([{ name: '运维' }, { name: '账号' }]), '#运维 #账号')
})

test('assetSub：类型中文名 + 位置；没位置只有类型名', () => {
  assert.equal(assetSub({ kind: 'server', location: '机房 A' }), '服务器 · 机房 A')
  assert.equal(assetSub({ kind: 'domain', location: '' }), '域名')
  assert.equal(assetSub({ kind: 'other', location: null as any }), '其他')
})

test('assetSub：不认识的类型给 undefined（实测行为，别改成「其他」）', () => {
  assert.equal(assetSub({ kind: 'unknown' as any, location: '' }), 'undefined')
})

test('moveSel：上下夹在 0..length-1', () => {
  assert.equal(moveSel(0, 1, 3), 1)
  assert.equal(moveSel(2, 1, 3), 2)
  assert.equal(moveSel(0, -1, 3), 0)
  assert.equal(moveSel(1, -1, 3), 0)
  assert.equal(moveSel(5, 0, 3), 5)
})

test('moveSel：长度为 0 时按 ↓ 会变成 -1（实测行为，别改成 0）', () => {
  assert.equal(moveSel(0, 1, 0), -1)
  assert.equal(moveSel(0, -1, 0), 0)
})

test('paletteHint：没输入时标题是「命令」，有结果时是「结果」', () => {
  assert.deepEqual(paletteHint('', false, 5), { group: '命令', empty: '' })
  assert.deepEqual(paletteHint('  ', false, 5), { group: '命令', empty: '' })
  assert.deepEqual(paletteHint(' wb ', false, 2), { group: '结果', empty: '' })
})

test('paletteHint：搜不到且没在搜时才出空态，文案里带去掉空白的词', () => {
  assert.deepEqual(paletteHint(' zzz ', false, 0), { group: '', empty: '没有找到「zzz」' })
  assert.deepEqual(paletteHint('zzz', true, 0), { group: '', empty: '' })
  assert.deepEqual(paletteHint('', false, 0), { group: '', empty: '' })
})
