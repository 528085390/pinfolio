import test from 'node:test'
import assert from 'node:assert/strict'
import { daysBetween, expiry, fullTime, money, relativeTime } from '../../web/lib/format.js'

function ymd(d: Date) {
  const p = (n: number) => (n < 10 ? '0' + n : String(n))
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

test('money：整数带千分位、小数两位、空值空串', () => {
  assert.equal(money(1234, 'CNY'), '¥1,234')
  assert.equal(money(12.5, 'USD'), '$12.50')
  assert.equal(money(5, 'XYZ'), 'XYZ 5')
  assert.equal(money(null, 'CNY'), '')
  assert.equal(money(undefined, 'CNY'), '')
})

test('daysBetween：今天 0、明天 1、昨天 -1', () => {
  const t = new Date()
  const tomorrow = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)
  const yesterday = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1)
  assert.equal(daysBetween(ymd(t)), 0)
  assert.equal(daysBetween(ymd(tomorrow)), 1)
  assert.equal(daysBetween(ymd(yesterday)), -1)
  assert.equal(daysBetween('不是日期'), null)
})

test('expiry：今天到期 / 快到期 / 还早 / 已过期', () => {
  const t = new Date()
  const at = (offset: number) => ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() + offset))
  assert.deepEqual(expiry(at(0)), { text: '今天到期', tone: 'bad', days: 0 })
  assert.deepEqual(expiry(at(10)), { text: '10 天后到期', tone: 'warn', days: 10 })
  assert.deepEqual(expiry(at(40)), { text: '还剩 40 天', tone: 'ok', days: 40 })
  assert.deepEqual(expiry(at(-2)), { text: '已过期 2 天', tone: 'bad', days: -2 })
  assert.equal(expiry(null), null)
  assert.equal(expiry('不是日期'), null)
})

test('fullTime：本地时间 YYYY-MM-DD HH:mm', () => {
  const d = new Date(2026, 0, 5, 9, 7)
  assert.equal(fullTime(d.toISOString()), '2026-01-05 09:07')
})

test('relativeTime：刚刚 / 分钟 / 小时 / 天', () => {
  const now = Date.now()
  assert.equal(relativeTime(new Date(now - 30 * 1000).toISOString()), '刚刚')
  assert.equal(relativeTime(new Date(now - 5 * 60 * 1000).toISOString()), '5 分钟前')
  assert.equal(relativeTime(new Date(now - 3 * 3600 * 1000).toISOString()), '3 小时前')
  assert.equal(relativeTime(new Date(now - 2 * 86400 * 1000).toISOString()), '2 天前')
  const old = new Date(now - 10 * 86400 * 1000)
  assert.equal(relativeTime(old.toISOString()), ymd(old))
})
