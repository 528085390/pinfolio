import test from 'node:test'
import assert from 'node:assert/strict'
import { extractTags, tagColor, TAG_COLORS, PRESET_TAGS } from '../../server/tags.js'

test('extractTags：空格分隔的标签', () => {
  assert.deepEqual(extractTags('今天 #工作 和 #学习'), ['工作', '学习'])
})

test('extractTags：行首也算边界', () => {
  assert.deepEqual(extractTags('#开头 后面'), ['开头'])
})

test('extractTags：中文标点算边界', () => {
  assert.deepEqual(extractTags('（#待办）、#想法。#阅读'), ['待办', '想法', '阅读'])
})

test('extractTags：重复只留一次', () => {
  assert.deepEqual(extractTags('#工作 #工作 #学习'), ['工作', '学习'])
})

test('extractTags：URL 里的 #anchor 不算标签', () => {
  assert.deepEqual(extractTags('看 https://example.com/a#frag 这个'), [])
})

test('extractTags：允许连字符、下划线、斜杠', () => {
  assert.deepEqual(extractTags('#node-js/v2 #a_b'), ['node-js/v2', 'a_b'])
})

test('extractTags：空文本', () => {
  assert.deepEqual(extractTags(''), [])
})

test('tagColor：同名同色、必在调色板内', () => {
  assert.equal(tagColor('工作'), tagColor('工作'))
  assert.ok(TAG_COLORS.includes(tagColor('工作')))
  assert.ok(TAG_COLORS.includes(tagColor('an-english-tag')))
})

test('PRESET_TAGS：12 个，颜色都是 6 位十六进制', () => {
  assert.equal(PRESET_TAGS.length, 12)
  for (const [, color] of PRESET_TAGS) assert.match(color, /^#[0-9a-f]{6}$/)
})
