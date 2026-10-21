// 设置页的纯逻辑（web/pages/settings/fields.ts）
// 运行：pnpm test:unit
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FIELD_TYPES, exportFilename, fieldDeletePrompt, fieldTypeLabel, normalizeTagName,
  parseFieldOptions, tagDeletePrompt, validateNewField,
} from '../../web/pages/settings/fields.js'

test('FIELD_TYPES：六种类型、v 唯一、都有中文名', () => {
  assert.deepEqual(FIELD_TYPES.map((t) => t.v), ['text', 'number', 'date', 'url', 'select', 'bool'])
  assert.equal(new Set(FIELD_TYPES.map((t) => t.v)).size, 6)
  assert.equal(FIELD_TYPES.every((t) => t.label.length > 0), true)
})

test('fieldTypeLabel：认识的给中文，不认识的原样回（别悄悄变「文本」）', () => {
  assert.equal(fieldTypeLabel('select'), '单选')
  assert.equal(fieldTypeLabel('bool'), '开关')
  assert.equal(fieldTypeLabel('weird'), 'weird')
  assert.equal(fieldTypeLabel(''), '')
})

test('parseFieldOptions：中英文逗号都认，去空白、丢空项', () => {
  assert.deepEqual(parseFieldOptions('月付, 季付, 年付'), ['月付', '季付', '年付'])
  assert.deepEqual(parseFieldOptions('月付，季付'), ['月付', '季付'])
  assert.deepEqual(parseFieldOptions('  a ,, b ， '), ['a', 'b'])
  assert.deepEqual(parseFieldOptions(''), [])
  assert.deepEqual(parseFieldOptions(' , ， '), [])
})

test('validateNewField：key 与显示名都要非空（只含空白算空）', () => {
  assert.equal(validateNewField('secret_at', '密钥存放位置'), null)
  assert.equal(validateNewField('', '名字'), '字段 key 和显示名都要填')
  assert.equal(validateNewField('key', '   '), '字段 key 和显示名都要填')
  assert.equal(validateNewField('  ', '  '), '字段 key 和显示名都要填')
})

test('exportFilename：pinboard-YYYY-MM-DD.json（UTC 日期）', () => {
  assert.equal(exportFilename(new Date('2026-10-21T13:05:00Z')), 'pinboard-2026-10-21.json')
  assert.equal(exportFilename(new Date('2026-01-02T23:59:59Z')), 'pinboard-2026-01-02.json')
  assert.match(exportFilename(), /^pinboard-\d{4}-\d{2}-\d{2}\.json$/)
})

test('normalizeTagName：去空白、只去掉开头一个 #', () => {
  assert.equal(normalizeTagName('  工作 '), '工作')
  assert.equal(normalizeTagName('#工作'), '工作')
  assert.equal(normalizeTagName('##工作'), '#工作')
  assert.equal(normalizeTagName('   '), '')
  assert.equal(normalizeTagName('a#b'), 'a#b')
})

test('删除确认文案带上名字', () => {
  assert.match(fieldDeletePrompt('密钥存放位置'), /删除字段「密钥存放位置」/)
  assert.match(tagDeletePrompt('工作'), /删除标签「#工作」/)
})
