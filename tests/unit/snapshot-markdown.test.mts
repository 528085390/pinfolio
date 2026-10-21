import test from 'node:test'
import assert from 'node:assert/strict'
import { cell, countBy, fmt, indent, parseCustom, renderSnapshot } from '../../server/snapshot/markdown.js'
import type { AssetRow, FieldRow, NoteRow, TagRow } from '../../server/snapshot/rows.js'

// SNAPSHOT.md 的渲染是纯函数：吃行数据、吐 Markdown。这里锁住格式，
// 免得以后改查询或改拼接时悄悄把快照写坏（它是新会话了解项目的第一份材料）。

const asset = (over: Partial<AssetRow> = {}): AssetRow => ({
  id: 1,
  name: '测试机',
  kind: 'server',
  status: 'active',
  location: '机房 A',
  vendor: 'Dell',
  serial: 'SN123',
  price: 100,
  currency: 'CNY',
  purchased_at: '2026-01-01',
  expires_at: null,
  url: 'https://example.com',
  notes: '',
  custom: '{}',
  updated_at: '2026-10-21T13:45:00',
  tags: '服务器',
  ...over,
})

const note = (over: Partial<NoteRow> = {}): NoteRow => ({
  id: 7,
  content: '一条便签',
  pinned: 0,
  archived: 0,
  done: 0,
  asset_id: null,
  created_at: '2026-10-21T13:00:00',
  updated_at: '2026-10-21T13:00:00',
  tags: '想法',
  ...over,
})

test('fmt：空值给 —，ISO 转本地 YYYY-MM-DD HH:mm，解析不了原样回', () => {
  assert.equal(fmt(null), '—')
  assert.equal(fmt(''), '—')
  assert.equal(fmt('2026-10-21T13:45:00'), '2026-10-21 13:45')
  assert.equal(fmt('2026-01-02T03:04:05'), '2026-01-02 03:04')
  assert.equal(fmt('不是时间'), '不是时间')
})

test('cell：空值给 —，换行压成空格，竖线转义', () => {
  assert.equal(cell(null), '—')
  assert.equal(cell(undefined), '—')
  assert.equal(cell(''), '—')
  assert.equal(cell('a\nb'), 'a b')
  assert.equal(cell('a|b'), 'a\\|b')
  assert.equal(cell(0), '0')
})

test('indent：每行加两个空格，空行保持空', () => {
  assert.equal(indent('a\nb'), '  a\n  b')
  assert.equal(indent('a\n\nb'), '  a\n\n  b')
})

test('parseCustom：合法对象原样，非法与空回 {}', () => {
  assert.deepEqual(parseCustom('{"ip":"1.2.3.4"}'), { ip: '1.2.3.4' })
  assert.deepEqual(parseCustom(''), {})
  assert.deepEqual(parseCustom('null'), {})
  assert.deepEqual(parseCustom('{坏'), {})
})

test('countBy：按字段归类，保留首次出现顺序', () => {
  assert.equal(
    countBy([{ s: '在用' }, { s: '闲置' }, { s: '在用' }], (r) => r.s),
    '在用 2 / 闲置 1',
  )
  assert.equal(countBy([], (r: any) => r.s), '')
})

test('renderSnapshot：空库四处「暂无」+ 概览全 0', () => {
  const out = renderSnapshot({ assets: [], notes: [], tags: [], fields: [], lastChange: null, now: '2026-10-21T13:45:00' })
  assert.match(out, /^# 便签夹快照（pinboard）/)
  assert.match(out, /生成时间：2026-10-21 13:45/)
  assert.match(out, /数据最后变更：—/)
  assert.match(out, /- 资产 \*\*0\*\* 条/)
  assert.match(out, /（暂无资产）/)
  assert.match(out, /（暂无便签）/)
  assert.match(out, /（暂无标签）/)
  assert.match(out, /（暂无自定义字段）/)
})

test('renderSnapshot：概览统计未完成/已完成/置顶/归档', () => {
  const out = renderSnapshot({
    assets: [asset()],
    notes: [note({ id: 1, pinned: 1 }), note({ id: 2, done: 1 }), note({ id: 3, archived: 1 })],
    tags: [],
    fields: [],
    lastChange: '2026-10-21T13:45:00',
    now: '2026-10-21T14:00:00',
  })
  assert.match(out, /- 便签 \*\*3\*\* 条：未完成 1 \/ 已完成 1 \/ 置顶 1 \/ 归档 1/)
})

test('renderSnapshot：资产总表用中文类型/状态，IP 从 custom 里取', () => {
  const out = renderSnapshot({
    assets: [asset({ custom: '{"ip":"10.0.0.1"}' })],
    notes: [],
    tags: [],
    fields: [],
    lastChange: null,
    now: '2026-10-21T14:00:00',
  })
  assert.match(out, /\| 1 \| 测试机 \| 服务器 \| 在用 \| 机房 A \| 10\.0\.0\.1 \| — \| 服务器 \|/)
})

test('renderSnapshot：资产详情里自定义字段用中文 label，备注多行缩进', () => {
  const fields: FieldRow[] = [{ key: 'rack', label: '机柜', type: 'text', options: '[]' }]
  const out = renderSnapshot({
    assets: [asset({ custom: '{"rack":"R12","ip":"10.0.0.1"}', notes: '第一行\n第二行' })],
    notes: [],
    tags: [],
    fields,
    lastChange: null,
    now: '2026-10-21T14:00:00',
  })
  assert.match(out, /- 机柜（rack）：R12/)
  assert.match(out, /- ip：10\.0\.0\.1/)
  assert.match(out, /第一行\n  第二行/)
  assert.match(out, /- 价格：CNY 100/)
})

test('renderSnapshot：便签小节带置顶/归档/完成标记与关联资产', () => {
  const out = renderSnapshot({
    assets: [],
    notes: [note({ pinned: 1, done: 1, asset_id: 5 })],
    tags: [],
    fields: [],
    lastChange: null,
    now: '2026-10-21T14:00:00',
  })
  assert.match(out, /### #7　置顶　已完成　关联资产 #5　2026-10-21 13:00/)
  assert.match(out, /- 标签：想法/)
})

test('renderSnapshot：标签总览与自定义字段表', () => {
  const tags: TagRow[] = [{ name: '服务器', notes: 2, assets: 3 }]
  const fields: FieldRow[] = [{ key: 'rack', label: '机柜', type: 'select', options: '["R1","R2"]' }]
  const out = renderSnapshot({ assets: [], notes: [], tags, fields, lastChange: null, now: '2026-10-21T14:00:00' })
  assert.match(out, /\| 服务器 \| 2 \| 3 \|/)
  assert.match(out, /\| rack \| 机柜 \| select \| R1 \/ R2 \|/)
})

test('renderSnapshot：字段 options 坏掉时该格留空，不抛错', () => {
  const fields: FieldRow[] = [{ key: 'x', label: 'X', type: 'text', options: '{坏' }]
  const out = renderSnapshot({ assets: [], notes: [], tags: [], fields, lastChange: null, now: '2026-10-21T14:00:00' })
  assert.match(out, /\| x \| X \| text \| — \|/)
})

test('renderSnapshot：不传 now 也能出时间（用当前时间）', () => {
  const out = renderSnapshot({ assets: [], notes: [], tags: [], fields: [], lastChange: null })
  assert.match(out, /生成时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
})
