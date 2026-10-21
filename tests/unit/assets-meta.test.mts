// 资产页的纯逻辑（web/pages/assets/meta.ts）
// 运行：pnpm test:unit
import test from 'node:test'
import assert from 'node:assert/strict'
import { cardMeta, usedTagsOf } from '../../web/pages/assets/meta.js'

import type { Tag } from '../../web/lib/api/types.js'

const tag = (name: string, assets: number, id = 0): Tag => ({ id, name, color: '#000000', notes: 0, assets })

test('usedTagsOf：只留有资产关联的标签', () => {
  const out = usedTagsOf([tag('有', 2, 1), tag('无', 0, 2)])
  assert.deepEqual(out.map((t) => t.name), ['有'])
})

test('usedTagsOf：assets 缺省（undefined）也算 0，被过滤', () => {
  const out = usedTagsOf([{ id: 1, name: 'x', color: '#000', notes: 0 } as Tag, tag('y', 1, 2)])
  assert.deepEqual(out.map((t) => t.name), ['y'])
})

test('usedTagsOf：按数量降序', () => {
  const out = usedTagsOf([tag('少', 1, 1), tag('多', 5, 2), tag('中', 3, 3)])
  assert.deepEqual(out.map((t) => t.name), ['多', '中', '少'])
})

test('usedTagsOf：数量相同按名称升序（中文 locale）', () => {
  const out = usedTagsOf([tag('代理', 2, 1), tag('服务器', 2, 2), tag('订阅', 2, 3)])
  assert.deepEqual(out.map((t) => t.name), ['代理', '订阅', '服务器'])
})

test('usedTagsOf：不改原数组', () => {
  const input = [tag('a', 1, 1), tag('b', 2, 2)]
  const snapshot = input.map((t) => t.name)
  usedTagsOf(input)
  assert.deepEqual(input.map((t) => t.name), snapshot)
})

test('cardMeta：序列号 → 位置 → 自定义 → 供应商 的顺序', () => {
  const out = cardMeta({ serial: 'SN1', location: '机房', custom: {}, vendor: '阿里' }, [])
  assert.deepEqual(out, [
    { k: '序列号', v: 'SN1' },
    { k: '位置', v: '机房' },
    { k: '供应商', v: '阿里' },
  ])
})

test('cardMeta：空字段不占行', () => {
  assert.deepEqual(cardMeta({ serial: '', location: '', custom: {}, vendor: '' }, []), [])
})

test('cardMeta：自定义字段最多 2 个，跳过空值与 null', () => {
  const out = cardMeta(
    { serial: '', location: '', custom: { a: '1', b: '', c: null, d: '4', e: '5' }, vendor: '' },
    [],
  )
  assert.deepEqual(out, [{ k: 'a', v: '1' }, { k: 'd', v: '4' }])
})

test('cardMeta：自定义字段有定义时用 label，没有就退回 key', () => {
  const fields = [{ key: 'ip', label: '内网 IP' }]
  const out = cardMeta({ serial: '', location: '', custom: { ip: '10.0.0.1', port: 22 }, vendor: '' }, fields)
  assert.deepEqual(out, [{ k: '内网 IP', v: '10.0.0.1' }, { k: 'port', v: '22' }])
})

test('cardMeta：数字自定义字段转成字符串', () => {
  const out = cardMeta({ serial: '', location: '', custom: { port: 22 }, vendor: '' }, [])
  assert.equal(typeof out[0].v, 'string')
  assert.equal(out[0].v, '22')
})
