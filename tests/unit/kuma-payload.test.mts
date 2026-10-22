// 观测台列表的纯拼装（server/kuma/payload.ts）
// 运行：pnpm test:unit
import test from 'node:test'
import assert from 'node:assert/strict'
import { BEAT_MSG_MAX, buildPayload, groupNameIn } from '../../server/kuma/payload.js'

const beat = (status: number, msg = '', time = '2026-10-19 08:35:24.131', ping = 12) => ({ status, msg, time, ping })

const base = {
  beans: null,
  links: [],
  base: 'http://127.0.0.1:3001',
  slug: 'obs',
  now: '2026-10-21T00:00:00.000Z',
}

test('buildPayload：空状态页给空分组与全零汇总，标题兜底「观测台」', () => {
  const p = buildPayload({ ...base, statusPage: {}, heartbeats: {} })
  assert.deepEqual(p.groups, [])
  assert.deepEqual(p.summary, { total: 0, up: 0, down: 0, pending: 0, uptime24: null })
  assert.deepEqual(p.kuma, { base: 'http://127.0.0.1:3001', slug: 'obs', title: '观测台' })
  assert.equal(p.updatedAt, '2026-10-21T00:00:00.000Z')
})

test('buildPayload：标题取状态页 config.title，分组名带进每个观测项', () => {
  const p = buildPayload({
    ...base,
    statusPage: { config: { title: '我家观测' }, publicGroupList: [{ id: 1, name: '本机', monitorList: [{ id: 7, name: 'app-api' }] }] },
    heartbeats: {},
  })
  assert.equal(p.kuma.title, '我家观测')
  assert.equal(p.groups[0].name, '本机')
  assert.equal(p.groups[0].monitors[0].group, '本机')
})

test('buildPayload：没有心跳时 status/time/ping 为 null，type 兜底 http，beats 为空', () => {
  const m = buildPayload({
    ...base,
    statusPage: { publicGroupList: [{ id: 1, name: 'g', monitorList: [{ id: 7, name: 'x' }] }] },
    heartbeats: {},
  }).groups[0].monitors[0]
  assert.equal(m.status, null)
  assert.equal(m.time, null)
  assert.equal(m.ping, null)
  assert.equal(m.msg, '')
  assert.equal(m.type, 'http')
  assert.deepEqual(m.beats, [])
  assert.deepEqual(m.beatTones, [])
  assert.equal(m.downCount, 0)
  assert.equal(m.lastDown, null)
})

test('buildPayload：最新一拍决定 status/time/ping，msg 去空白，时间转 ISO', () => {
  const m = buildPayload({
    ...base,
    statusPage: { publicGroupList: [{ id: 1, name: 'g', monitorList: [{ id: 7, name: 'x' }] }] },
    heartbeats: { heartbeatList: { '7': [beat(1), beat(0, '  502  ')] } },
  }).groups[0].monitors[0]
  assert.equal(m.status, 0)
  assert.equal(m.time, '2026-10-19T08:35:24.131Z')
  assert.equal(m.ping, 12)
  assert.equal(m.msg, '502')
  assert.deepEqual(m.beats, [1, 0])
  assert.equal(m.downCount, 1)
  assert.equal(m.lastDown, '2026-10-19T08:35:24.131Z')
})

test('buildPayload：四态字符进 beatTones，普通消息为 null', () => {
  const m = buildPayload({
    ...base,
    statusPage: { publicGroupList: [{ id: 1, name: 'g', monitorList: [{ id: 7, name: 'x' }] }] },
    heartbeats: { heartbeatList: { '7': [beat(1, '[绿] 正常'), beat(0, '超时'), beat(2, '[黄] 慢')] } },
  }).groups[0].monitors[0]
  assert.deepEqual(m.beatTones, ['绿', null, '黄'])
})

test('buildPayload：beatTimes/beatMsgs/beatPings 与 beats 一一对应（色条悬停用）', () => {
  const m = buildPayload({
    ...base,
    statusPage: { publicGroupList: [{ id: 1, name: 'g', monitorList: [{ id: 7, name: 'x' }] }] },
    heartbeats: {
      heartbeatList: {
        '7': [beat(1, '  200 - OK  ', '2026-10-19 08:35:24.131', 65), { status: 0, msg: '超时', time: '2026-10-19 09:35:24.000', ping: null }],
      },
    },
  }).groups[0].monitors[0]
  assert.deepEqual(m.beatTimes, ['2026-10-19T08:35:24.131Z', '2026-10-19T09:35:24.000Z'])
  assert.deepEqual(m.beatMsgs, ['200 - OK', '超时'])
  assert.deepEqual(m.beatPings, [65, null])
  assert.equal(m.beatTimes.length, m.beats.length)
  // 最后一拍就是卡片上「检查」那一行的时间，两边不能打架
  assert.equal(m.beatTimes[m.beatTimes.length - 1], m.time)
})

test('buildPayload：悬停消息超长截断成 BEAT_MSG_MAX + 省略号，空白消息给空串', () => {
  const long = 'x'.repeat(BEAT_MSG_MAX + 20)
  const m = buildPayload({
    ...base,
    statusPage: { publicGroupList: [{ id: 1, name: 'g', monitorList: [{ id: 7, name: 'x' }] }] },
    heartbeats: { heartbeatList: { '7': [beat(1, long), beat(1, '   ')] } },
  }).groups[0].monitors[0]
  assert.equal(m.beatMsgs[0].length, BEAT_MSG_MAX + 1)
  assert.ok(m.beatMsgs[0].endsWith('…'))
  assert.equal(m.beatMsgs[1], '')
})

test('buildPayload：beats 只留最近 beatWindow 拍，downCount/lastDown 也按窗口算', () => {
  const beats = [beat(0, '', '2026-10-19 00:00:00.000'), beat(1), beat(1), beat(1)]
  const m = buildPayload({
    ...base,
    beatWindow: 2,
    statusPage: { publicGroupList: [{ id: 1, name: 'g', monitorList: [{ id: 7, name: 'x' }] }] },
    heartbeats: { heartbeatList: { '7': beats } },
  }).groups[0].monitors[0]
  assert.deepEqual(m.beats, [1, 1])
  assert.equal(m.downCount, 0)
  // lastDown 看的是完整历史，不看窗口（页面上「上次故障」要能追溯到更早）
  assert.equal(m.lastDown, '2026-10-19T00:00:00.000Z')
})

test('buildPayload：非数字 status 记成 -1（占位，不算故障）', () => {
  const m = buildPayload({
    ...base,
    statusPage: { publicGroupList: [{ id: 1, name: 'g', monitorList: [{ id: 7, name: 'x' }] }] },
    heartbeats: { heartbeatList: { '7': [{ status: undefined as any, msg: '', time: '' } as any] } },
  }).groups[0].monitors[0]
  assert.deepEqual(m.beats, [-1])
  assert.equal(m.status, null)
  assert.equal(m.downCount, 0)
})

test('buildPayload：active/interval 从 socket bean 补，拿不到时退回 true / 60 秒', () => {
  const statusPage = { publicGroupList: [{ id: 1, name: 'g', monitorList: [{ id: 7, name: 'a' }, { id: 8, name: 'b' }] }] }
  const withBeans = buildPayload({
    ...base,
    statusPage,
    heartbeats: {},
    beans: { '7': { active: 1, interval: 300 }, '8': { active: false, interval: 0 } },
  }).groups[0].monitors
  assert.equal(withBeans[0].active, true)
  assert.equal(withBeans[0].interval, 300)
  assert.equal(withBeans[1].active, false)
  assert.equal(withBeans[1].interval, 60)

  const noBeans = buildPayload({ ...base, statusPage, heartbeats: {} }).groups[0].monitors
  assert.equal(noBeans[0].active, true)
  assert.equal(noBeans[0].interval, 60)
})

test('buildPayload：active 也认 true 而不是只认 1', () => {
  const m = buildPayload({
    ...base,
    statusPage: { publicGroupList: [{ id: 1, name: 'g', monitorList: [{ id: 7, name: 'a' }] }] },
    heartbeats: {},
    beans: { '7': { active: true, interval: 60 } },
  }).groups[0].monitors[0]
  assert.equal(m.active, true)
})

test('buildPayload：description/showMsg 取状态页的配置，showMsg 只认 true', () => {
  const ms = buildPayload({
    ...base,
    statusPage: {
      publicGroupList: [{
        id: 1, name: 'g',
        monitorList: [{ id: 7, name: 'a', description: '  本机网关  ', showMsg: true }, { id: 8, name: 'b', showMsg: 1 as any }],
      }],
    },
    heartbeats: {},
  }).groups[0].monitors
  assert.equal(ms[0].description, '本机网关')
  assert.equal(ms[0].showMsg, true)
  assert.equal(ms[1].showMsg, false)
})

test('buildPayload：uptime24 取 uptimeList 的 <id>_24，汇总只平均有值的那些', () => {
  const p = buildPayload({
    ...base,
    statusPage: {
      publicGroupList: [{ id: 1, name: 'g', monitorList: [{ id: 7, name: 'a' }, { id: 8, name: 'b' }, { id: 9, name: 'c' }] }],
    },
    heartbeats: { uptimeList: { '7_24': 1, '8_24': 0.98 } },
  })
  assert.equal(p.groups[0].monitors[0].uptime24, 1)
  assert.equal(p.groups[0].monitors[2].uptime24, null)
  assert.ok(Math.abs((p.summary.uptime24 as number) - 0.99) < 1e-9)
})

test('buildPayload：汇总按 status 数 up/down/pending（2 是待定，不算 down）', () => {
  const p = buildPayload({
    ...base,
    statusPage: { publicGroupList: [{ id: 1, name: 'g', monitorList: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }, { id: 4, name: 'd' }] }] },
    heartbeats: { heartbeatList: { '1': [beat(1)], '2': [beat(0)], '3': [beat(2)], '4': [beat(3)] } },
  })
  assert.deepEqual(p.summary, { total: 4, up: 1, down: 1, pending: 1, uptime24: null })
})

test('buildPayload：跳转链接按 id 优先、name 兜底，label 缺省用 url', () => {
  const links = [
    { name: '旧名字', url: 'http://by-name' },
    { id: 7, url: 'http://by-id', label: '管理页' },
  ]
  const m = buildPayload({
    ...base,
    links,
    statusPage: { publicGroupList: [{ id: 1, name: 'g', monitorList: [{ id: 7, name: '新名字' }, { id: 8, name: '旧名字' }] }] },
    heartbeats: {},
  }).groups[0].monitors
  assert.deepEqual(m[0].link, { url: 'http://by-id', label: '管理页' })
  assert.deepEqual(m[1].link, { url: 'http://by-name', label: 'http://by-name' })
})

test('buildPayload：没有匹配规则时 link 是 null', () => {
  const m = buildPayload({
    ...base,
    statusPage: { publicGroupList: [{ id: 1, name: 'g', monitorList: [{ id: 7, name: 'a' }] }] },
    heartbeats: {},
  }).groups[0].monitors[0]
  assert.equal(m.link, null)
})

test('groupNameIn：按分组结构找归属，找不到或没数据回空串', () => {
  const groups = [{ id: 1, name: '本机', monitorList: [{ id: 7, name: 'a' }] }, { id: 2, name: '服务器' }]
  assert.equal(groupNameIn(groups, 7), '本机')
  assert.equal(groupNameIn(groups, 99), '')
  assert.equal(groupNameIn(undefined, 7), '')
  assert.equal(groupNameIn([{ id: 2, name: '空组' }], 7), '')
})
