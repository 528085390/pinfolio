// 观测页状态判定（web/pages/monitors/status.ts）
// 运行：pnpm test:unit
import test from 'node:test'
import assert from 'node:assert/strict'
import { STATUS, TONE, TONE_RE, pct, tone, typeLabel } from '../../web/pages/monitors/status.js'

const m = (msg: string, status: number | null) => ({ msg, status }) as never

test('心跳消息带四态前缀时以颜色为准', () => {
  assert.deepEqual(tone(m('[绿] 续火花成功', 1)), { label: '成功', color: 'var(--ok)' })
  assert.deepEqual(tone(m('[黄] 部分成功', 1)), { label: '部分成功', color: 'var(--warn)' })
  assert.deepEqual(tone(m('[红] 失败', 0)), { label: '失败', color: 'var(--danger)' })
  assert.deepEqual(tone(m('[灰] 未运行', 1)), { label: '未运行', color: 'var(--muted)' })
})

test('前缀优先于状态码（灰 + up 也显示未运行）', () => {
  assert.equal(tone(m('[灰] 跳过', 1))?.label, '未运行')
})

test('没有前缀时退回 Kuma 状态码', () => {
  assert.deepEqual(tone(m('OK', 1)), { label: '正常', color: 'var(--ok)' })
  assert.deepEqual(tone(m('', 0)), { label: '故障', color: 'var(--danger)' })
  assert.deepEqual(tone(m('', 2)), { label: '待定', color: 'var(--warn)' })
  assert.deepEqual(tone(m('', 3)), { label: '维护', color: 'var(--muted)' })
})

test('状态码为 null 且没有前缀 = 无数据', () => {
  assert.equal(tone(m('', null)), null)
})

test('前缀必须在开头（前面有字就不算）', () => {
  assert.equal(tone(m('提示 [绿] 成功', 1))?.label, '正常')
  assert.equal(TONE_RE.test(' [绿] 前导空格'), false)
})

test('未知状态码不炸，回 null', () => {
  assert.equal(tone(m('', 99)), null)
  assert.equal(STATUS[99], undefined)
})

test('TONE 表就是四色', () => {
  assert.deepEqual(Object.keys(TONE), ['绿', '黄', '红', '灰'])
})

test('pct：null 破折号，99.95% 以上不留小数', () => {
  assert.equal(pct(null), '—')
  assert.equal(pct(1), '100%')
  assert.equal(pct(0.9996), '100%')
  assert.equal(pct(0.9995), '100%')
  assert.equal(pct(0.994), '99.4%')
  assert.equal(pct(0), '0.0%')
  assert.equal(pct(0.5), '50.0%')
})

test('typeLabel：已知类型转中文/大写，未知原样返回', () => {
  assert.equal(typeLabel('http'), 'HTTP')
  assert.equal(typeLabel('port'), 'TCP')
  assert.equal(typeLabel('keyword'), '关键词')
  assert.equal(typeLabel('grpc'), 'gRPC')
  assert.equal(typeLabel('weird'), 'weird')
})
