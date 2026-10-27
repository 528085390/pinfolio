// 设置页「出站模式」卡片的纯逻辑（web/pages/settings/outbound.ts）
// 重点盯三态：password / username 的「缺键 / null / 字符串」在前端不能被写错，
// 写错就是「用户没动密码 → 密码被清空」这类静默数据损失。
// 运行：node --import tsx --test tests/unit/*.test.mts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PROTOCOLS, buildOutboundPayload, changedAtText, formFromCfg, outboundSummary, proxyLine, savedNotice, testNotice,
} from '../../web/pages/settings/outbound.js'
import { translate } from '../../shared/i18n/core.js'
import { en } from '../../shared/i18n/en/index.js'

const has = (o: any, k: string) => Object.prototype.hasOwnProperty.call(o, k)

// GET /api/outbound 的真实形状（密码只回布尔）
const cfgProxy = {
  mode: 'proxy' as const,
  proxy: { protocol: 'socks5h' as const, host: '127.0.0.1', port: 10808, username: 'u', hasPassword: true },
  changedAt: '2026-10-27T10:00:00.000Z',
}

test('PROTOCOLS：四项全列，socks5h 排第一（默认）', () => {
  assert.deepEqual(PROTOCOLS, ['socks5h', 'socks5', 'http', 'https'])
})

test('formFromCfg：hasPassword=true 时密码框留空 —— 绝不回显密码', () => {
  const f = formFromCfg(cfgProxy)
  assert.equal(f.mode, 'proxy')
  assert.equal(f.protocol, 'socks5h')
  assert.equal(f.host, '127.0.0.1')
  assert.equal(f.port, '10808')
  assert.equal(f.username, 'u')
  assert.equal(f.password, '')
  assert.equal(f.clearPassword, false)
  assert.equal(f.usernameTouched, false)
  // 连请求体里也不许出现 password 键（不是「出现空串」，是不出现）
  const p: any = buildOutboundPayload(f)
  assert.equal(has(p.proxy, 'password'), false)
})

test('formFromCfg：直连时仍把已存的代理配置带进表单（变灰但看得见）', () => {
  const f = formFromCfg({ mode: 'direct', proxy: cfgProxy.proxy, changedAt: null })
  assert.equal(f.mode, 'direct')
  assert.equal(f.host, '127.0.0.1')
  assert.equal(f.port, '10808')
})

test('formFromCfg：没有代理 / 没有响应时给安全默认值', () => {
  const f = formFromCfg(null)
  assert.equal(f.mode, 'direct')
  assert.equal(f.protocol, 'socks5h')
  assert.equal(f.host, '')
  assert.equal(f.port, '')
  assert.equal(f.password, '')
  assert.equal(f.clearPassword, false)
})

test('buildOutboundPayload · 密码不动：请求体里没有 password 键', () => {
  const p: any = buildOutboundPayload(formFromCfg(cfgProxy))
  assert.equal(has(p.proxy, 'password'), false)
  assert.deepEqual(p.proxy, { protocol: 'socks5h', host: '127.0.0.1', port: 10808 })
})

test('buildOutboundPayload · 点了清除密码：password 送 null', () => {
  const f = formFromCfg(cfgProxy)
  f.clearPassword = true
  const p: any = buildOutboundPayload(f)
  assert.equal(has(p.proxy, 'password'), true)
  assert.equal(p.proxy.password, null)
})

test('buildOutboundPayload · 填了新密码：password 送字符串', () => {
  const f = formFromCfg(cfgProxy)
  f.password = 'n3w pass'
  const p: any = buildOutboundPayload(f)
  assert.equal(p.proxy.password, 'n3w pass')
})

test('buildOutboundPayload · 清除后又填了密码：以新密码为准（别把 null 一起送）', () => {
  const f = formFromCfg(cfgProxy)
  f.clearPassword = true
  f.password = 'abc'
  const p: any = buildOutboundPayload(f)
  assert.equal(p.proxy.password, 'abc')
})

test('buildOutboundPayload · 直连：只有 mode，不带 proxy（后端保证不清已存配置）', () => {
  const f = formFromCfg(cfgProxy)
  f.mode = 'direct'
  const p: any = buildOutboundPayload(f)
  assert.deepEqual(p, { mode: 'direct' })
  assert.equal(has(p, 'proxy'), false)
})

test('buildOutboundPayload · username 三态：没动不带键 / 清空送 null / 填了送字符串', () => {
  const a: any = buildOutboundPayload(formFromCfg(cfgProxy))
  assert.equal(has(a.proxy, 'username'), false)

  const f2 = formFromCfg(cfgProxy)
  f2.username = ''
  f2.usernameTouched = true
  const b: any = buildOutboundPayload(f2)
  assert.equal(has(b.proxy, 'username'), true)
  assert.equal(b.proxy.username, null)

  const f3 = formFromCfg(cfgProxy)
  f3.username = 'newuser'
  f3.usernameTouched = true
  const c: any = buildOutboundPayload(f3)
  assert.equal(c.proxy.username, 'newuser')
})

test('buildOutboundPayload · 主机去首尾空格、端口转数字，坏端口不送 NaN', () => {
  const f = formFromCfg(cfgProxy)
  f.host = '  10.0.0.2  '
  f.port = '1080'
  const p: any = buildOutboundPayload(f)
  assert.equal(p.proxy.host, '10.0.0.2')
  assert.equal(p.proxy.port, 1080)

  const bad = formFromCfg(cfgProxy)
  bad.port = ''
  const q: any = buildOutboundPayload(bad)
  assert.equal(q.proxy.port, 0)
  assert.equal(Number.isNaN(q.proxy.port), false)
})

test('proxyLine：协议 host:port，不含账号密码', () => {
  assert.equal(proxyLine(cfgProxy.proxy), 'socks5h 127.0.0.1:10808')
})

test('outboundSummary：直连 / 经代理 / 经代理但没配', () => {
  assert.equal(outboundSummary(null), '出站：直连')
  assert.equal(outboundSummary({ mode: 'direct', proxy: cfgProxy.proxy, changedAt: null }), '出站：直连')
  assert.equal(outboundSummary(cfgProxy), '出站：经代理 socks5h 127.0.0.1:10808')
  assert.equal(outboundSummary({ mode: 'proxy', proxy: null, changedAt: null }), '出站：经代理（还没配代理）')
})

test('savedNotice：带 N；0 项时不写「0 个观测项」', () => {
  assert.equal(savedNotice(3), '已切换，正在重新探测 3 个观测项…')
  assert.equal(savedNotice(0), '已切换（没有需要重探的观测项）')
})

test('testNotice：排上了给条数，排不上说清楚', () => {
  assert.equal(testNotice(5), '已排队重探 5 个观测项，几秒后看观测台')
  assert.equal(testNotice(0), '没有可重探的观测项')
})

test('changedAtText：没切过 / 刚切过 / 更早', () => {
  assert.equal(changedAtText(null), '')
  const now = new Date('2026-10-27T12:00:00.000Z').getTime()
  assert.equal(changedAtText('2026-10-27T11:59:30.000Z', now), '上次切换：刚刚')
  assert.equal(changedAtText('2026-10-27T11:30:00.000Z', now), '上次切换：30 分钟前')
  assert.ok(changedAtText('2026-10-26T11:30:00.000Z', now).startsWith('上次切换：'))
  assert.equal(changedAtText('不是时间', now), '')
})

// spec §10.5 的 18 个逻辑键（+ 卡片上其它中文文案）都得有英文译文：界面上不许出现中文残留，
// 源码里也不许硬编码英文（中文字面量进 t()，译文进 shared/i18n/en/settings.ts）。
const CARD_COPY = [
  '出站模式', '直连', '经代理', '协议', '代理主机', '端口', '用户名', '密码',
  '可空', '已保存，留空表示不修改', '清除密码', '撤销清除', '保存后清除已存密码',
  '测试连通', '测试中…',
  '正在读取出站设置…', '还没读取出站设置：保存与测试连通先禁用，免得把真实出站误切成直连', '出站：直连', '出站：经代理 {proxy}', '出站：经代理（还没配代理）',
  '已切换，正在重新探测 {n} 个观测项…', '已切换（没有需要重探的观测项）',
  '已排队重探 {n} 个观测项，几秒后看观测台', '没有可重探的观测项',
  '经代理的绿色只代表机器存活，不代表国内直连可用',
  '通知推送（webhook / 邮件）不受此开关影响，仍走直连',
  '跟随全局', '钉：直连', '钉：代理',
  '上次切换：刚刚', '上次切换：{n} 分钟前', '上次切换：{time}',
]

test('i18n：卡片文案在英文字典里都接上了（缺一条就等于界面上留中文）', () => {
  const missing = CARD_COPY.filter((k) => typeof en[k] !== 'string')
  assert.deepEqual(missing, [], '缺英文译文：' + missing.join(' / '))
})

test('i18n：切到英文后两条灰字也翻（spec §10.1 第 4 点要求它们必须出现）', () => {
  const a = translate(en, 'en', '经代理的绿色只代表机器存活，不代表国内直连可用')
  const b = translate(en, 'en', '通知推送（webhook / 邮件）不受此开关影响，仍走直连')
  assert.equal(/[\u3400-\u9fff]/.test(a), false)
  assert.equal(/[\u3400-\u9fff]/.test(b), false)
})
