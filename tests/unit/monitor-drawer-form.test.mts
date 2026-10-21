// 观测项抽屉的表单逻辑（web/components/monitor-drawer/form.ts 与 display.ts）
// 运行：pnpm test:unit
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPatch, canSaveForm, confirmMatches, emptyForm, runDisabledOf, sameForm, toForm, validateForm,
} from '../../web/components/monitor-drawer/form.js'
import { toneOf } from '../../web/components/monitor-drawer/display.js'

const detail = (over: Record<string, any> = {}) => ({
  monitor: {
    id: 7, name: 'app-api', description: '网关', interval: 60, timeout: 20,
    maxretries: 0, retryInterval: 60, showMsg: false,
    type: 'http', target: 'http://127.0.0.1:7863/healthz', group: '本机', policy: null,
    ...over,
  },
}) as any

test('emptyForm：新建时的默认值', () => {
  assert.deepEqual(emptyForm(), {
    name: '', description: '', interval: 60, timeout: 20, maxretries: 0, retryInterval: 60, showMsg: false,
  })
})

test('toForm：只取可改的那几个字段，target/policy 不进表单', () => {
  const f = toForm(detail())
  assert.deepEqual(f, {
    name: 'app-api', description: '网关', interval: 60, timeout: 20, maxretries: 0, retryInterval: 60, showMsg: false,
  })
  assert.equal('target' in f, false)
})

test('sameForm：全等为 true，任一字段不同为 false', () => {
  const a = emptyForm()
  assert.equal(sameForm(a, { ...a }), true)
  for (const key of ['name', 'description', 'interval', 'timeout', 'maxretries', 'retryInterval', 'showMsg'] as const) {
    const b = { ...a, [key]: typeof a[key] === 'boolean' ? !a[key] : (a[key] as number) + 1 }
    assert.equal(sameForm(a, b), false, key)
  }
})

test('buildPatch：没改就返回空对象', () => {
  const f = emptyForm()
  assert.deepEqual(buildPatch(f, { ...f }), {})
})

test('buildPatch：只带改过的字段', () => {
  const base = { ...emptyForm(), name: 'a', interval: 60 }
  const form = { ...base, name: '  b  ', interval: 300 }
  assert.deepEqual(buildPatch(form, base), { name: 'b', interval: 300 })
})

test('buildPatch：名字与介绍提交前 trim', () => {
  const base = { ...emptyForm(), name: 'a', description: 'x' }
  const form = { ...base, name: ' a ', description: '  x  ' }
  // trim 之后和 base 一样，等于没改
  assert.deepEqual(buildPatch(form, base), {})
})

test('buildPatch：布尔字段改成 true 会带上', () => {
  const base = emptyForm()
  assert.deepEqual(buildPatch({ ...base, showMsg: true }, base), { showMsg: true })
})

test('validateForm：默认值只有名字不合法（名字必填，实测行为）', () => {
  assert.deepEqual(validateForm(emptyForm()), { nameOk: false, intervalOk: true, timeoutOk: true })
  assert.deepEqual(validateForm({ ...emptyForm(), name: 'app-api' }), { nameOk: true, intervalOk: true, timeoutOk: true })
})

test('validateForm：名字 1–120 字', () => {
  assert.equal(validateForm({ ...emptyForm(), name: '   ' }).nameOk, false)
  assert.equal(validateForm({ ...emptyForm(), name: 'a'.repeat(120) }).nameOk, true)
  assert.equal(validateForm({ ...emptyForm(), name: 'a'.repeat(121) }).nameOk, false)
})

test('validateForm：频率 20–86400 秒', () => {
  assert.equal(validateForm({ ...emptyForm(), interval: 19 }).intervalOk, false)
  assert.equal(validateForm({ ...emptyForm(), interval: 20 }).intervalOk, true)
  assert.equal(validateForm({ ...emptyForm(), interval: 86400, timeout: 20 }).intervalOk, true)
  assert.equal(validateForm({ ...emptyForm(), interval: 86401 }).intervalOk, false)
  assert.equal(validateForm({ ...emptyForm(), interval: Number.NaN }).intervalOk, false)
})

test('validateForm：超时 1–120 且必须小于频率', () => {
  assert.equal(validateForm({ ...emptyForm(), timeout: 0 }).timeoutOk, false)
  assert.equal(validateForm({ ...emptyForm(), timeout: 1 }).timeoutOk, true)
  assert.equal(validateForm({ ...emptyForm(), timeout: 120, interval: 300 }).timeoutOk, true)
  assert.equal(validateForm({ ...emptyForm(), timeout: 121 }).timeoutOk, false)
  assert.equal(validateForm({ ...emptyForm(), timeout: 60, interval: 60 }).timeoutOk, false)
})

test('toneOf：没有心跳 = 无数据', () => {
  assert.equal(toneOf(null), null)
  assert.equal(toneOf({ status: null }), null)
})

test('toneOf：四态前缀优先', () => {
  assert.equal(toneOf({ tone: '绿', status: 0 })?.label, '成功')
  assert.equal(toneOf({ tone: '红', status: 1 })?.label, '失败')
})

test('toneOf：没有四态就看 Kuma 状态码', () => {
  assert.equal(toneOf({ tone: null, status: 1 })?.label, '正常')
  assert.equal(toneOf({ status: 3 })?.label, '维护')
  assert.equal(toneOf({ status: 9 }), null)
})

test('toneOf：认不出的四态字符直接算无数据（实测行为，别改成回退状态码）', () => {
  assert.equal(toneOf({ tone: '紫', status: 1 }), null)
})

test('canSaveForm：没改动 / 校验不过 / 保存中 都不能点', () => {
  const base = { ...emptyForm(), name: 'app-api' }
  assert.equal(canSaveForm(base, base, false), false)
  assert.equal(canSaveForm({ ...base, name: '改名' }, base, false), true)
  assert.equal(canSaveForm({ ...base, name: '改名' }, base, true), false)
  assert.equal(canSaveForm({ ...base, name: '' }, base, false), false)
  assert.equal(canSaveForm({ ...base, name: '改名', interval: 10 }, base, false), false)
  assert.equal(canSaveForm({ ...base, name: '改名', timeout: 999 }, base, false), false)
})

test('canSaveForm：没有基准（详情没读到）时一律不能点', () => {
  assert.equal(canSaveForm({ ...emptyForm(), name: 'x' }, null, false), false)
})

test('runDisabledOf：没配方 / 配方置灰 / 正在跑 / 已暂停 都不能点', () => {
  const m = { active: true } as any
  const action = { steps: [], source: 'config' } as any
  assert.equal(runDisabledOf(action, m, false), false)
  assert.equal(runDisabledOf(undefined, m, false), true)
  assert.equal(runDisabledOf({ ...action, disabledReason: '没配配方' }, m, false), true)
  assert.equal(runDisabledOf(action, m, true), true)
  assert.equal(runDisabledOf(action, { active: false } as any, false), true)
  assert.equal(runDisabledOf(action, undefined, false), true)
})

test('confirmMatches：去掉首尾空白后必须完全一样', () => {
  const m = { name: ' app-api ' } as any
  assert.equal(confirmMatches(m, 'app-api'), true)
  assert.equal(confirmMatches(m, '  app-api  '), true)
  assert.equal(confirmMatches(m, 'wb2ap'), false)
  assert.equal(confirmMatches(m, ''), false)
  assert.equal(confirmMatches(undefined, 'app-api'), false)
})
