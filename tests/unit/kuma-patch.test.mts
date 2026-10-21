// 观测台 PATCH 的校验与归一化（server/kuma/patch.ts）与 HTTP 小工具（server/kuma/http.ts）
// 这些规则原来埋在 routes.ts 里，一个都测不到；拆出来就是为了钉住边界。
// 运行：pnpm test:unit
import test from 'node:test'
import assert from 'node:assert/strict'
import { asInt, buildMonitorPatch, normalizeForKuma, policyNameRefs } from '../../server/kuma/patch.js'
import { isJsonContentType, kumaErrorStatus } from '../../server/kuma/http.js'

const bean = (over: Record<string, any> = {}) => ({
  id: 7, name: 'app-api', description: '网关', interval: 60, timeout: 20,
  maxretries: 0, retryInterval: 60, showMsg: false, type: 'http',
  accepted_statuscodes: ['200-299'], conditions: [], policyJson: null,
  ...over,
})

const beans = (over: Record<string, any> = {}) => ({
  7: bean(),
  8: bean({ id: 8, name: 'app-manager', interval: 120 }),
  ...over,
})

/** 成功时取 next，失败时把 error/status 一起回出来，方便断言 */
const run = (body: Record<string, unknown>, base = bean(), all = beans()) => buildMonitorPatch(body, base, all)

/* ---------------- asInt ---------------- */

test('asInt：空值回 null，数字四舍五入，垃圾值回 null', () => {
  assert.equal(asInt(undefined), null)
  assert.equal(asInt(null), null)
  assert.equal(asInt(''), null)
  assert.equal(asInt('60'), 60)
  assert.equal(asInt('60.6'), 61)
  assert.equal(asInt(59.4), 59)
  assert.equal(asInt('abc'), null)
  assert.equal(asInt(Infinity), null)
})

/* ---------------- 名字 ---------------- */

test('名字：空 / 超长 / 重名 都是 400', () => {
  assert.deepEqual(run({ name: '   ' }), { error: '名字不能为空', status: 400 })
  assert.deepEqual(run({ name: 'x'.repeat(121) }), { error: '名字最长 120 字', status: 400 })
  assert.deepEqual(run({ name: 'app-manager' }), { error: '已经有同名观测项：app-manager', status: 400 })
})

test('名字：改回自己不算重名（不会撞 400）', () => {
  const res = run({ name: ' app-api ' }) as any
  assert.equal(res.next.name, 'app-api')
})

test('名字：策略按名字引用旧名时拒绝改名（409）', () => {
  const all = beans({
    9: bean({ id: 9, name: 'biz', policyJson: JSON.stringify({ rules: [{ monitorStatus: { name: 'app-api' } }] }) }),
  })
  const res = run({ name: 'app-api-2' }, bean(), all) as any
  assert.equal(res.status, 409)
  assert.match(res.error, /有策略按名字引用了「app-api」/)
  assert.match(res.error, /观测项 #9/)
})

test('名字：策略里引用的是别人的名字时不拦', () => {
  const all = beans({
    9: bean({ id: 9, name: 'biz', policyJson: JSON.stringify({ rules: [{ monitorStatus: { name: 'someone-else' } }] }) }),
  })
  const res = run({ name: 'app-api-2' }, bean(), all) as any
  assert.equal(res.next.name, 'app-api-2')
})

/* ---------------- 介绍 ---------------- */

test('介绍：trim 后落库，超 500 字拒绝', () => {
  assert.equal((run({ description: '  新的介绍  ' }) as any).next.description, '新的介绍')
  assert.deepEqual(run({ description: 'x'.repeat(501) }), { error: '介绍最长 500 字', status: 400 })
  assert.equal((run({ description: 'x'.repeat(500) }) as any).next.description.length, 500)
})

/* ---------------- 频率 / 超时 / 重试 ---------------- */

test('频率：20–86400 边界，越界或非数字拒绝', () => {
  // 注意：bean 的 timeout 是 20，interval=20 会撞「超时必须小于频率」，所以这里把 timeout 一起调小
  assert.equal((run({ interval: 20, timeout: 10 }) as any).next.interval, 20)
  assert.equal((run({ interval: 86400 }) as any).next.interval, 86400)
  assert.deepEqual(run({ interval: 19 }), { error: '检查频率要在 20–86400 秒之间', status: 400 })
  assert.deepEqual(run({ interval: 86401 }), { error: '检查频率要在 20–86400 秒之间', status: 400 })
  assert.deepEqual(run({ interval: 'abc' }), { error: '检查频率要在 20–86400 秒之间', status: 400 })
})

test('超时：1–120 边界', () => {
  assert.equal((run({ timeout: 1 }) as any).next.timeout, 1)
  assert.equal((run({ timeout: 120, interval: 300 }) as any).next.timeout, 120)
  assert.deepEqual(run({ timeout: 0 }), { error: '超时要在 1–120 秒之间', status: 400 })
  assert.deepEqual(run({ timeout: 121 }), { error: '超时要在 1–120 秒之间', status: 400 })
})

test('重试间隔 1–3600、次数 0–10', () => {
  assert.equal((run({ retryInterval: 1 }) as any).next.retryInterval, 1)
  assert.equal((run({ retryInterval: 3600 }) as any).next.retryInterval, 3600)
  assert.deepEqual(run({ retryInterval: 0 }), { error: '重试间隔要在 1–3600 秒之间', status: 400 })
  assert.deepEqual(run({ retryInterval: 3601 }), { error: '重试间隔要在 1–3600 秒之间', status: 400 })
  assert.equal((run({ maxretries: 0 }) as any).next.maxretries, 0)
  assert.equal((run({ maxretries: 10 }) as any).next.maxretries, 10)
  assert.deepEqual(run({ maxretries: -1 }), { error: '重试次数要在 0–10 之间', status: 400 })
  assert.deepEqual(run({ maxretries: 11 }), { error: '重试次数要在 0–10 之间', status: 400 })
})

test('超时必须小于频率：只改名也会用合并后的值校验', () => {
  assert.deepEqual(run({ timeout: 60 }), { error: '超时（60s）必须小于检查频率（60s）', status: 400 })
  // bean 本身 timeout 20 / interval 60，只改 interval=20 就撞上
  assert.deepEqual(run({ interval: 20 }), { error: '超时（20s）必须小于检查频率（20s）', status: 400 })
  // 同时把 timeout 调小就通过
  assert.equal((run({ interval: 20, timeout: 10 }) as any).next.timeout, 10)
})

/* ---------------- showMsg ---------------- */

test('showMsg：只认 true 与 1，其余落成 false；不传就不碰', () => {
  assert.equal((run({ showMsg: true }) as any).next.showMsg, true)
  assert.equal((run({ showMsg: 1 }) as any).next.showMsg, true)
  assert.equal((run({ showMsg: 'true' }) as any).next.showMsg, false)
  assert.equal((run({ showMsg: 0 }) as any).next.showMsg, false)
  // bean 里本来没有 showMsg（Kuma 的 toJSON 不返回它）→ 不传 showMsg 时 next 里也没有，
  // 由路由从状态页补（buildMonitorPatch 不负责这件事）
  const noShow = run({ name: 'app-api' }, bean({ showMsg: undefined })) as any
  assert.equal(noShow.next.showMsg, undefined)
})

/* ---------------- 归一化 ---------------- */

test('归一化：accepted_statuscodes 转字符串数组，空值回 200-299', () => {
  const res = run({}, bean({ accepted_statuscodes: [200, 301] })) as any
  assert.deepEqual(res.next.accepted_statuscodes, ['200', '301'])
  assert.deepEqual((run({}, bean({ accepted_statuscodes: [] })) as any).next.accepted_statuscodes, ['200-299'])
  assert.deepEqual((run({}, bean({ accepted_statuscodes: null })) as any).next.accepted_statuscodes, ['200-299'])
})

test('归一化：conditions 必须是数组，policyJson 空→null / 对象→字符串 / 其它→String', () => {
  assert.deepEqual((run({}, bean({ conditions: null })) as any).next.conditions, [])
  const pol = { rules: [{ every: 300 }] }
  assert.equal((run({}, bean({ policyJson: pol })) as any).next.policyJson, JSON.stringify(pol))
  assert.equal((run({}, bean({ policyJson: '' })) as any).next.policyJson, null)
  assert.equal((run({}, bean({ policyJson: null })) as any).next.policyJson, null)
  assert.equal((run({}, bean({ policyJson: 42 })) as any).next.policyJson, '42')
})

test('归一化：policy_json（下划线）也认，统一写成 policyJson', () => {
  const res = run({}, bean({ policyJson: undefined, policy_json: '{"a":1}' })) as any
  assert.equal(res.next.policyJson, '{"a":1}')
})

test('normalizeForKuma 就地改并返回同一个对象', () => {
  const next: Record<string, any> = { accepted_statuscodes: [200], conditions: null, policyJson: undefined }
  const out = normalizeForKuma(next)
  assert.equal(out, next)
  assert.deepEqual(out.accepted_statuscodes, ['200'])
})

/* ---------------- policyNameRefs ---------------- */

test('policyNameRefs：字符串/对象两种 policyJson 都能扫出来，坏 JSON 跳过', () => {
  const all = {
    1: bean({ id: 1, policyJson: '{"monitorStatus":{"name":"a"}}' }),
    2: bean({ id: 2, policyJson: { rules: [{ monitorStatus: { name: 'a' } }, { monitorStatus: { name: 'b' } }] } }),
    3: bean({ id: 3, policyJson: '{坏掉的' }),
    4: bean({ id: 4, policyJson: null }),
  }
  const refs = policyNameRefs(all)
  assert.deepEqual(refs.get('a'), [1, 2])
  assert.deepEqual(refs.get('b'), [2])
  assert.equal(refs.size, 2)
})

test('policyNameRefs：beans 的 key 不是 id 时回落到 key 数字', () => {
  const refs = policyNameRefs({ 11: { policyJson: { monitorStatus: { name: 'x' } } } })
  assert.deepEqual(refs.get('x'), [11])
})

/* ---------------- http.ts ---------------- */

test('isJsonContentType：认大小写与 charset，缺省 false', () => {
  assert.equal(isJsonContentType('application/json'), true)
  assert.equal(isJsonContentType('Application/JSON; charset=utf-8'), true)
  assert.equal(isJsonContentType('text/plain'), false)
  assert.equal(isJsonContentType(''), false)
  assert.equal(isJsonContentType(null), false)
  assert.equal(isJsonContentType(undefined), false)
})

test('kumaErrorStatus：notfound / 消息里带 not found / reading null → 404，其余 502', () => {
  assert.equal(kumaErrorStatus({ code: 'notfound' }), 404)
  assert.equal(kumaErrorStatus(new Error('Monitor not found')), 404)
  assert.equal(kumaErrorStatus(new Error("Cannot read properties of null (reading 'id')")), 404)
  assert.equal(kumaErrorStatus(new Error('connect ECONNREFUSED 127.0.0.1:3001')), 502)
  assert.equal(kumaErrorStatus(null), 502)
})
