import test from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluatePolicy,
  parsePolicy,
  explainPolicy,
  POLICY_PRESETS,
  type PolicyContext,
} from '../../server/monitor/policy.ts'

test('evaluatePolicy: returns baseInterval and gate=true for null, empty, or invalid policy', () => {
  assert.deepEqual(evaluatePolicy(null, 60), { gate: true, interval: 60 })
  assert.deepEqual(evaluatePolicy('', 60), { gate: true, interval: 60 })
  assert.deepEqual(evaluatePolicy('invalid-json', 60), { gate: true, interval: 60 })
  assert.deepEqual(evaluatePolicy('{}', 120), { gate: true, interval: 120 })
  assert.deepEqual(evaluatePolicy('{"v": 2}', 60), { gate: true, interval: 60 }) // unsupported version
})

test('evaluatePolicy: evaluates business-hours preset and time rules', () => {
  const policy = JSON.stringify(POLICY_PRESETS['business-hours'])

  // business-hours 预设钉死 Asia/Shanghai，所以这里用绝对时刻：14:30 上海 == 06:30 UTC。
  // 结论不应随 runner 的进程时区变化（此前在 UTC runner 上被判成夜间，CI 因此红）。
  const dayDate = new Date('2026-11-06T06:30:00.000Z')
  const dayRes = evaluatePolicy(policy, 60, { now: dayDate })
  assert.equal(dayRes.gate, true)
  assert.equal(dayRes.interval, 60)

  // 03:15 上海 == 前一天 19:15 UTC
  const nightDate = new Date('2026-11-05T19:15:00.000Z')
  const nightRes = evaluatePolicy(policy, 60, { now: nightDate })
  assert.equal(nightRes.gate, true)
  assert.equal(nightRes.interval, 1200)

  // Direct preset name string support
  const presetRes = evaluatePolicy('business-hours', 60, { now: dayDate })
  assert.equal(presetRes.gate, true)
  assert.equal(presetRes.interval, 60)
})

test('evaluatePolicy: policy without timeZone reads the time window in the local clock', () => {
  const localPolicy = JSON.stringify({
    v: 1,
    interval: {
      default: 1200,
      rules: [{ when: { time: { from: '08:00', to: '23:00' } }, interval: 60 }],
    },
  })

  // 用本地字段构造，任何时区下都是“本地 14:30 / 03:15”
  const dayLocal = new Date(2026, 10, 6, 14, 30)
  assert.equal(evaluatePolicy(localPolicy, 60, { now: dayLocal }).interval, 60)

  const nightLocal = new Date(2026, 10, 6, 3, 15)
  assert.equal(evaluatePolicy(localPolicy, 60, { now: nightLocal }).interval, 1200)
})

test('evaluatePolicy: timeZone decides how the window is read, atom-level wins over policy-level', () => {
  const instant = new Date('2026-11-06T06:30:00.000Z') // 上海 14:30 / UTC 06:30
  const rules = [{ when: { time: { from: '08:00', to: '23:00' } }, interval: 60 }]

  const shanghai = JSON.stringify({
    v: 1,
    timeZone: 'Asia/Shanghai',
    interval: { default: 1200, rules },
  })
  assert.equal(evaluatePolicy(shanghai, 60, { now: instant }).interval, 60)

  const utc = JSON.stringify({
    v: 1,
    timeZone: 'UTC',
    interval: { default: 1200, rules },
  })
  assert.equal(evaluatePolicy(utc, 60, { now: instant }).interval, 1200)

  // atom 级 timeZone 覆盖根级
  const overridden = JSON.stringify({
    v: 1,
    timeZone: 'Asia/Shanghai',
    interval: {
      default: 1200,
      rules: [{ when: { time: { from: '08:00', to: '23:00', timeZone: 'UTC' } }, interval: 60 }],
    },
  })
  assert.equal(evaluatePolicy(overridden, 60, { now: instant }).interval, 1200)

  // 非法 timeZone → 整条策略非法，退回 baseInterval（宁可不生效，也不按错时区观测）
  const badTz = JSON.stringify({ v: 1, timeZone: 'Mars/Olympus', interval: { default: 600 } })
  assert.deepEqual(evaluatePolicy(badTz, 60), { gate: true, interval: 60 })
})

test('evaluatePolicy: evaluates adaptive intervals based on selfStatus', () => {
  const policy = JSON.stringify(POLICY_PRESETS['adaptive-5-1'])

  // Normal status UP -> default interval 300s
  const upRes = evaluatePolicy(policy, 60, { selfStatus: 1 })
  assert.equal(upRes.gate, true)
  assert.equal(upRes.interval, 300)

  // Broken status DOWN -> 60s
  const downRes = evaluatePolicy(policy, 60, { selfStatus: 0 })
  assert.equal(downRes.gate, true)
  assert.equal(downRes.interval, 60)

  // Broken status string 'DOWN' -> 60s
  const downStrRes = evaluatePolicy(policy, 60, { selfStatus: 'DOWN' })
  assert.equal(downStrRes.gate, true)
  assert.equal(downStrRes.interval, 60)
})

test('evaluatePolicy: evaluates gate conditions (llm-on-api-up)', () => {
  const policy = JSON.stringify(POLICY_PRESETS['llm-on-api-up'])

  // Dependency #3 is UP
  const upCtx: PolicyContext = {
    monitorsStatus: { 3: 1 },
  }
  const passRes = evaluatePolicy(policy, 600, upCtx)
  assert.equal(passRes.gate, true)
  assert.equal(passRes.interval, 600)

  // Dependency #3 is DOWN (0)
  const downCtx: PolicyContext = {
    monitorsStatus: { 3: 0 },
  }
  const failRes = evaluatePolicy(policy, 600, downCtx)
  assert.equal(failRes.gate, false)
  assert.equal(failRes.status, 3) // MAINTENANCE
  assert.equal(failRes.interval, 300) // recheck interval
  assert.match(failRes.reason || '', /依赖 #3 = UP/)

  // Dependency #3 is missing
  const missingCtx: PolicyContext = {
    monitorsStatus: {},
  }
  const missingRes = evaluatePolicy(policy, 600, missingCtx)
  assert.equal(missingRes.gate, false)
  assert.equal(missingRes.status, 3)
})

test('evaluatePolicy: supports complex conditions (all, any, not, selfDownCount, selfPingMs)', () => {
  const customPolicy = {
    v: 1,
    interval: {
      default: 60,
      rules: [
        {
          when: {
            all: [
              { selfStatus: 'UP' },
              { selfPingMs: { gte: 500 } },
            ],
          },
          interval: 10,
        },
        {
          when: {
            selfDownCount: { gte: 3 },
          },
          interval: 15,
        },
      ],
    },
  }

  const json = JSON.stringify(customPolicy)

  // UP and high ping (600ms) -> 10s
  const highPingRes = evaluatePolicy(json, 60, { selfStatus: 'UP', selfPingMs: 600 })
  assert.equal(highPingRes.interval, 10)

  // UP and normal ping (50ms) -> 60s
  const normalPingRes = evaluatePolicy(json, 60, { selfStatus: 'UP', selfPingMs: 50 })
  assert.equal(normalPingRes.interval, 60)

  // Down 3 times -> 15s
  const downCountRes = evaluatePolicy(json, 60, { selfStatus: 'DOWN', selfDownCount: 3 })
  assert.equal(downCountRes.interval, 15)
})
