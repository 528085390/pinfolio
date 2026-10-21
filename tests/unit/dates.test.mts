import test from 'node:test'
import assert from 'node:assert/strict'
import { daysLeft } from '../../server/dates.js'

function ymd(d: Date) {
  const p = (n: number) => (n < 10 ? '0' + n : String(n))
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

test('daysLeft：今天 = 0', () => {
  assert.equal(daysLeft(ymd(new Date())), 0)
})

test('daysLeft：明天 = 1，昨天 = -1', () => {
  const t = new Date()
  const tomorrow = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)
  const yesterday = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1)
  assert.equal(daysLeft(ymd(tomorrow)), 1)
  assert.equal(daysLeft(ymd(yesterday)), -1)
})

test('daysLeft：30 天后', () => {
  const t = new Date()
  const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 30)
  assert.equal(daysLeft(ymd(d)), 30)
})

test('daysLeft：解析不了给 null', () => {
  assert.equal(daysLeft('2026-13-45'), null)
  assert.equal(daysLeft('不是日期'), null)
})
