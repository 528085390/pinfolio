import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MASONRY_GAP, MASONRY_ROW, rowSpan } from '../../web/lib/masonry.js'

test('rowSpan：正好填满一行时不多占一行', () => {
  assert.equal(rowSpan(MASONRY_ROW), 1) // 8 → ceil(20/20) = 1
  assert.equal(rowSpan(MASONRY_ROW * 2 + MASONRY_GAP), 2) // 28 → 2
  assert.equal(rowSpan(MASONRY_ROW * 3 + MASONRY_GAP * 2), 3) // 48 → 3
})

test('rowSpan：多出来的像素向上取整到下一行', () => {
  assert.equal(rowSpan(9), 2) // 9 → ceil(21/20) = 2
  assert.equal(rowSpan(27), 2)
  assert.equal(rowSpan(29), 3)
  assert.equal(rowSpan(180), 10) // 竖图卡那种高度
  assert.equal(rowSpan(288), 15)
})

test('rowSpan：高度为 0 / 负数 / NaN 都按 1 行算', () => {
  assert.equal(rowSpan(0), 1)
  assert.equal(rowSpan(-5), 1)
  assert.equal(rowSpan(Number.NaN), 1)
  assert.equal(rowSpan(Number.POSITIVE_INFINITY), 1)
})

test('rowSpan：行高或间距非法时不炸，返回 1', () => {
  assert.equal(rowSpan(100, 0, 0), 1)
  assert.equal(rowSpan(100, -8, 12), 1)
})

test('rowSpan：自定义行高间距按同一公式算', () => {
  // row=10, gap=5 → 一格 15；height=31 → ceil(36/15) = 3
  assert.equal(rowSpan(31, 10, 5), 3)
})
