// 「立即观测」配方的纯逻辑（server/kuma/recipe.ts）
// 运行：pnpm test:unit
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_TIMEOUT_S, STEP_LABEL, clip, normalizeSteps, parseRules, resolveFromRules, statusText, timeoutOf,
} from '../../server/kuma/recipe.js'

const mon = (over: Record<string, any> = {}) => ({ id: 7, name: 'app-api', type: 'http', ...over })

/* ---------------- parseRules ---------------- */

test('parseRules：顶层数组与 { recipes: [] } 都认', () => {
  assert.deepEqual(parseRules([{ id: 1 }]), [{ id: 1 }])
  assert.deepEqual(parseRules({ recipes: [{ id: 2 }] }), [{ id: 2 }])
})

test('parseRules：坏结构一律当没配方', () => {
  assert.deepEqual(parseRules(null), [])
  assert.deepEqual(parseRules(undefined), [])
  assert.deepEqual(parseRules('oops'), [])
  assert.deepEqual(parseRules({ recipes: 'x' }), [])
  assert.deepEqual(parseRules({ nope: [] }), [])
})

test('parseRules：丢掉不是对象的条目（null / 数字 / 字符串）', () => {
  assert.deepEqual(parseRules([null, 1, 'x', { id: 3 }]), [{ id: 3 }])
})

/* ---------------- normalizeSteps ---------------- */

test('normalizeSteps：补默认 label，未知类型给「步骤：x」', () => {
  const steps = normalizeSteps([{ type: 'http' }, { type: 'weird' }])
  assert.equal(steps[0].label, STEP_LABEL.http)
  assert.equal(steps[1].label, '步骤：weird')
})

test('normalizeSteps：自带的 label 优先，空字符串不算', () => {
  assert.equal(normalizeSteps([{ type: 'http', label: '自己写的' }])[0].label, '自己写的')
  assert.equal(normalizeSteps([{ type: 'http', label: '' }])[0].label, STEP_LABEL.http)
})

test('normalizeSteps：hint 只认字符串，其他字段原样保留', () => {
  const s = normalizeSteps([{ type: 'command', argv: ['node', 'x.cjs'], hint: 42 }])[0]
  assert.equal(s.hint, undefined)
  assert.deepEqual(s.argv, ['node', 'x.cjs'])
  assert.equal(normalizeSteps([{ type: 'http', hint: '说明' }])[0].hint, '说明')
})

test('normalizeSteps：没有字符串 type 的条目被丢掉；非数组回空', () => {
  assert.deepEqual(normalizeSteps([{ type: 1 }, {}, null, { type: 'http' }] as any).map((s) => s.type), ['http'])
  assert.deepEqual(normalizeSteps(undefined), [])
  assert.deepEqual(normalizeSteps('x' as any), [])
})

/* ---------------- resolveFromRules ---------------- */

test('配方命中：source=config、步骤归一、没有置灰原因', () => {
  const r = resolveFromRules([{ id: 7, steps: [{ type: 'kuma-check' }] }], mon())
  assert.equal(r.source, 'config')
  assert.equal(r.disabledReason, null)
  assert.equal(r.steps.length, 1)
  assert.equal(r.steps[0].label, STEP_LABEL['kuma-check'])
})

test('按 id 优先于按名字：两条都命中时用 id 那条', () => {
  const rules = [
    { name: 'app-api', steps: [{ type: 'http', url: 'http://by-name' }] },
    { id: 7, steps: [{ type: 'http', url: 'http://by-id' }] },
  ]
  const r = resolveFromRules(rules, mon())
  assert.equal(r.steps[0].url, 'http://by-id')
})

test('id 不中时按名字兜底（改名不会悄悄换动作，但旧名字仍可用）', () => {
  const r = resolveFromRules([{ name: 'app-api', steps: [{ type: 'command', argv: ['x'] }] }], mon({ id: 99 }))
  assert.equal(r.source, 'config')
  assert.equal(r.steps[0].type, 'command')
})

test('配方自己写的 disabledReason 优先', () => {
  const r = resolveFromRules([{ id: 7, disabledReason: '手工置灰', steps: [{ type: 'http' }] }], mon())
  assert.equal(r.disabledReason, '手工置灰')
})

test('配方里有不认识的步骤类型 → 置灰并点名', () => {
  const r = resolveFromRules([{ id: 7, steps: [{ type: 'kuma-check' }, { type: 'rm-rf' }] }], mon())
  assert.match(String(r.disabledReason), /不认识的步骤类型：rm-rf/)
})

test('配方里没有步骤 → 置灰', () => {
  assert.equal(resolveFromRules([{ id: 7, steps: [] }], mon()).disabledReason, '配方里没有步骤')
  assert.equal(resolveFromRules([{ id: 7 }], mon()).disabledReason, '配方里没有步骤')
})

test('推送型没配方：source=none、没步骤、置灰原因点名 monitor-actions.json', () => {
  const r = resolveFromRules([], mon({ type: 'push' }))
  assert.equal(r.source, 'none')
  assert.deepEqual(r.steps, [])
  assert.match(String(r.disabledReason), /推送型观测项由外部心跳驱动/)
  assert.match(String(r.disabledReason), /monitor-actions\.json/)
})

test('非推送型没配方：默认让 Kuma 探一次，不置灰', () => {
  const r = resolveFromRules([], mon({ type: 'http' }))
  assert.equal(r.source, 'default')
  assert.equal(r.disabledReason, null)
  assert.equal(r.steps.length, 1)
  assert.equal(r.steps[0].type, 'kuma-check')
  assert.match(String(r.steps[0].hint), /重启检查循环/)
})

test('推送型只要配了配方就照配方跑（不再置灰）', () => {
  const r = resolveFromRules([{ id: 7, steps: [{ type: 'command', argv: ['x'] }] }], mon({ type: 'push' }))
  assert.equal(r.source, 'config')
  assert.equal(r.disabledReason, null)
})

/* ---------------- timeoutOf ---------------- */

test('timeoutOf：按类型取默认秒数', () => {
  assert.equal(timeoutOf({ type: 'kuma-check', label: '' }, 60_000), 25_000)
  assert.equal(timeoutOf({ type: 'http', label: '' }, 60_000), 15_000)
  assert.equal(timeoutOf({ type: 'command', label: '' }, 60_000), 30_000)
  assert.equal(timeoutOf({ type: '未知', label: '' }, 60_000), 15_000)
})

test('timeoutOf：配方里的 timeout 覆盖默认值', () => {
  assert.equal(timeoutOf({ type: 'command', label: '', timeout: 5 }, 60_000), 5_000)
  assert.equal(timeoutOf({ type: 'command', label: '', timeout: '5' }, 60_000), 5_000)
})

test('timeoutOf：timeout 不是正数就回默认值', () => {
  for (const bad of [0, -5, '', 'abc', null, undefined, NaN]) {
    assert.equal(timeoutOf({ type: 'http', label: '', timeout: bad as any }, 60_000), DEFAULT_TIMEOUT_S.http * 1000)
  }
})

test('timeoutOf：不超过剩余预算，但不低于 1 秒', () => {
  assert.equal(timeoutOf({ type: 'command', label: '' }, 5_000), 5_000)
  assert.equal(timeoutOf({ type: 'command', label: '' }, 200), 1_000)
})

/* ---------------- clip / statusText ---------------- */

test('clip：压成一行、去首尾空白，超长加省略号', () => {
  assert.equal(clip('  a \n  b  '), 'a b')
  assert.equal(clip(null), '')
  assert.equal(clip(undefined), '')
  assert.equal(clip(42), '42')
  const long = clip('x'.repeat(400), 300)
  assert.equal(long.length, 301)
  assert.equal(long.endsWith('…'), true)
})

test('statusText：0/1/2/3 说人话，其余「未知」', () => {
  assert.equal(statusText(1), '正常')
  assert.equal(statusText(0), '故障')
  assert.equal(statusText(2), '待定')
  assert.equal(statusText(3), '维护')
  assert.equal(statusText(9), '未知')
})
