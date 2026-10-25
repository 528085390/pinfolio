// 应用外壳的标题与副标题（web/app/titles.ts）
// 运行：pnpm test:unit
import test from 'node:test'
import assert from 'node:assert/strict'
import { pageSubtitle, pageTitle } from '../../web/app/titles.js'

const stats = (o: Partial<{ notes: number; archived: number; assets: number; active: number }> = {}) => ({
  notes: 3, archived: 0, notesDone: 0, notesPending: 3, assets: 17, active: 17,
  totalValue: 200, expiringSoon: 1, expired: 0, expiring: 1, ...o,
}) as any

test('pageTitle：六个页面各有标题', () => {
  assert.equal(pageTitle('notes'), '便签')
  assert.equal(pageTitle('mail'), '邮件')
  assert.equal(pageTitle('assets'), '资产台账')
  assert.equal(pageTitle('monitors'), '观测台')
  assert.equal(pageTitle('hosts'), '主机')
  assert.equal(pageTitle('settings'), '设置')
})

test('pageSubtitle：便签页带条数，有归档才追加归档数', () => {
  assert.equal(pageSubtitle('notes', { stats: stats(), mailSum: null, mon: null }), '3 条便签')
  assert.equal(pageSubtitle('notes', { stats: stats({ notes: 8, archived: 2 }), mailSum: null, mon: null }), '8 条便签 · 2 条归档')
  assert.equal(pageSubtitle('notes', { stats: null, mailSum: null, mon: null }), '')
})

test('pageSubtitle：邮件页有汇总给三个数，没有就给静态说明（不显示 0）', () => {
  assert.equal(
    pageSubtitle('mail', { stats: null, mailSum: { accounts: 2, unseen: 5, total: 120 }, mon: null }),
    '2 个邮箱 · 5 封未读 · 共 120 封',
  )
  assert.equal(pageSubtitle('mail', { stats: null, mailSum: null, mon: null }), '多邮箱合并收件箱 · 只读')
})

test('pageSubtitle：资产页件数与在用数', () => {
  assert.equal(pageSubtitle('assets', { stats: stats(), mailSum: null, mon: null }), '17 件资产 · 17 件在用')
  assert.equal(pageSubtitle('assets', { stats: null, mailSum: null, mon: null }), '')
})

test('pageSubtitle：观测页四段拼接（异常数 / 24h 可用率按需出现）', () => {
  const mon = (o: any = {}) => ({ up: 18, total: 19, down: 1, uptime24: 0.9876, ...o })
  assert.equal(
    pageSubtitle('monitors', { stats: null, mailSum: null, mon: mon() }),
    '18/19 正常 · 1 异常 · 24h 98.8%',
  )
  assert.equal(pageSubtitle('monitors', { stats: null, mailSum: null, mon: mon({ down: 0, uptime24: null }) }), '18/19 正常')
  assert.equal(pageSubtitle('monitors', { stats: null, mailSum: null, mon: mon({ down: 0, uptime24: 1 }) }), '18/19 正常 · 24h 100.0%')
  assert.equal(pageSubtitle('monitors', { stats: null, mailSum: null, mon: null }), 'Kuma 探测后端 · 每 30 秒刷新')
})

test('pageSubtitle：主机页在线数，陈旧台数按需出现', () => {
  assert.equal(pageSubtitle('hosts', { stats: null, mailSum: null, mon: null, host: { total: 6, online: 6, stale: 0, paused: 0 } }), '6/6 在线')
  assert.equal(pageSubtitle('hosts', { stats: null, mailSum: null, mon: null, host: { total: 6, online: 5, stale: 1, paused: 0 } }), '5/6 在线 · 1 台陈旧')
  assert.equal(pageSubtitle('hosts', { stats: null, mailSum: null, mon: null, host: { total: 6, online: 4, stale: 0, paused: 2 } }), '4/6 在线 · 2 台暂停')
  assert.equal(pageSubtitle('hosts', { stats: null, mailSum: null, mon: null, host: null }), '服务器指标 · 每 5 分钟采集')
})

test('pageSubtitle：设置页固定一句', () => {
  assert.equal(pageSubtitle('settings', { stats: stats(), mailSum: null, mon: null }), '字段、标签、账号与安全')
})
