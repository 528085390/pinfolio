import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTH_PROBE_ATTEMPTS, AUTH_PROBE_DELAY_MS, AUTH_PROBE_TIMEOUT_MS,
  describeError, probeWithRetry,
} from '../../desktop/auth-probe.js'
import type { ProbeDeps } from '../../desktop/auth-probe.js'

// auth-probe 是纯模块：不 import electron，全部依赖由 ProbeDeps 注入（fetch / sleep / log），
// 所以这里能完全离线地测「有界重试 + 每次请求超时 + 失败诊断」。
//
// 一条安全语义压过全部重试逻辑：**只有 fetch 自己抛错（连接层失败 / 超时）才重试**；
// 一旦拿到响应而状态码不是 401，说明鉴权被削弱，必须立刻硬失败 —— 宁可启动失败，
// 也不能开一个裸奔窗口。所以下面每个测试都同时数 fetch 次数与 sleep 次数。

const URL = 'http://127.0.0.1:10080'

/** 记录调用次数的假 deps：responses 按顺序吐；元素是 Error 就抛（模拟连接层失败） */
function fakeDeps(script: Array<{ status: number } | Error>) {
  const calls: Array<{ url: string; init: any }> = []
  const slept: number[] = []
  const logs: string[] = []
  let i = 0

  const deps: ProbeDeps = {
    fetch: (async (url: any, init: any) => {
      calls.push({ url: String(url), init })
      const step = script[Math.min(i, script.length - 1)]
      i += 1
      if (step instanceof Error) throw step
      return { status: step.status } as Response
    }) as unknown as typeof fetch,
    sleep: async (ms: number) => {
      slept.push(ms)
    },
    log: (msg: string) => {
      logs.push(msg)
    },
  }

  return { deps, calls, slept, logs }
}

test('常量：10 次 × 300ms 间隔，每次请求 2s 超时', () => {
  assert.equal(AUTH_PROBE_ATTEMPTS, 10)
  assert.equal(AUTH_PROBE_DELAY_MS, 300)
  assert.equal(AUTH_PROBE_TIMEOUT_MS, 2000)
})

test('一次就 401 → resolve，log 恰好一次且文本含 auth guard ok', async () => {
  const { deps, calls, slept, logs } = fakeDeps([{ status: 401 }])
  await probeWithRetry(URL, deps)

  assert.equal(calls.length, 1)
  assert.equal(slept.length, 0)
  assert.equal(logs.length, 1)
  assert.match(logs[0], /auth guard ok/)
  assert.equal(logs[0], 'auth guard ok: /api/notes without cookie -> 401')
})

test('前 2 次抛错、第 3 次 401 → fetch 3 次、sleep 2 次（每次 300），最终 resolve', async () => {
  const { deps, calls, slept, logs } = fakeDeps([
    new Error('fetch failed'),
    new Error('fetch failed'),
    { status: 401 },
  ])
  await probeWithRetry(URL, deps)

  assert.equal(calls.length, 3)
  assert.deepEqual(slept, [300, 300])
  const failLogs = logs.filter((l) => /次连接失败/.test(l))
  assert.equal(failLogs.length, 2)
  assert.match(failLogs[0], /第 1\/10 次连接失败/)
  assert.match(failLogs[1], /第 2\/10 次连接失败/)
  assert.match(logs[logs.length - 1], /auth guard ok/)
})

test('一直抛错 → fetch 恰好 10 次、sleep 恰好 9 次，reject 且文本含 10 次', async () => {
  const err = new Error('fetch failed')
  const { deps, calls, slept, logs } = fakeDeps([err])
  await assert.rejects(
    () => probeWithRetry(URL, deps),
    (e: any) => {
      assert.ok(e instanceof Error)
      assert.match(e.message, /10 次/)
      assert.match(e.message, /fetch failed/)
      return true
    },
  )

  assert.equal(calls.length, 10)
  assert.equal(slept.length, 9)
  assert.equal(slept.filter((ms) => ms === 300).length, 9)
  assert.equal(logs.filter((l) => /次连接失败/.test(l)).length, 10)
})

for (const status of [200, 302, 403, 404, 500]) {
  test('状态码 ' + status + ' → 立刻 reject，fetch 1 次、sleep 0 次（绝不重试）', async () => {
    const { deps, calls, slept } = fakeDeps([{ status }])
    await assert.rejects(
      () => probeWithRetry(URL, deps),
      (e: any) => {
        assert.ok(e instanceof Error)
        assert.match(e.message, /401/)
        assert.ok(e.message.includes(String(status)), '错误文本应带实际状态码：' + e.message)
        return true
      },
    )
    assert.equal(calls.length, 1)
    assert.equal(slept.length, 0)
  })
}

test('401 之后不再继续请求（fetch 计数 = 1）', async () => {
  const { deps, calls } = fakeDeps([{ status: 401 }, { status: 401 }, { status: 401 }])
  await probeWithRetry(URL, deps)
  assert.equal(calls.length, 1)
})

test('请求的 URL 是 url + /api/notes', async () => {
  const { deps, calls } = fakeDeps([{ status: 401 }])
  await probeWithRetry(URL, deps)
  assert.equal(calls[0].url, URL + '/api/notes')
})

test('每次请求都带 signal（AbortSignal 实例，用于 2s 超时）', async () => {
  const { deps, calls } = fakeDeps([{ status: 401 }])
  await probeWithRetry(URL, deps)

  assert.ok(calls[0].init, '必须传 init')
  assert.ok(calls[0].init.signal instanceof AbortSignal, 'signal 必须是 AbortSignal')
})

test('describeError：沿 cause 链给出两层，并带上诊断字段', () => {
  const inner = Object.assign(new Error('connect ECONNREFUSED'), {
    code: 'ECONNREFUSED',
    syscall: 'connect',
    address: '127.0.0.1',
    port: 10080,
  })
  const outer = new Error('outer', { cause: inner })
  const text = describeError(outer)

  assert.match(text, /outer/)
  assert.match(text, /ECONNREFUSED/)
  assert.ok(text.includes(' <- '), '层与层之间用 " <- " 连接：' + text)
  assert.match(text, /code=ECONNREFUSED/)
  assert.match(text, /syscall=connect/)
  assert.match(text, /address=127\.0\.0\.1/)
  assert.match(text, /port=10080/)
  assert.ok(!text.includes('\n'), '必须单行：' + text)
})

test('describeError：非 Error 入参也给出可读文本，不是 [object Object]', () => {
  assert.equal(describeError('boom'), 'boom')
  assert.equal(describeError(42), '42')
  assert.equal(describeError(undefined), 'undefined')
  assert.equal(describeError(null), 'null')

  const plain = describeError({ code: 'ECONNREFUSED' })
  assert.ok(!plain.includes('[object Object]'), plain)
  assert.match(plain, /ECONNREFUSED/)
})

test('describeError：cause 自引用成环不会死循环，最多 5 层', { timeout: 2000 }, () => {
  const a: any = new Error('a')
  a.cause = a
  const text = describeError(a)
  assert.equal(typeof text, 'string')
  assert.ok(text.length > 0)

  // 5 层深链也只输出 5 层，第 6 层不被展开
  let node: any = new Error('L5')
  for (let i = 4; i >= 1; i--) node = new Error('L' + i, { cause: node })
  node = new Error('L0', { cause: node })
  const chain = describeError(node)
  assert.match(chain, /L0/)
  assert.match(chain, /L4/)
  assert.ok(!chain.includes('L5'), '最多 5 层：' + chain)
})

test('describeError：永不抛（怪对象也能出文本）', { timeout: 2000 }, () => {
  const hostile = {
    get cause(): any {
      throw new Error('cause getter 炸了')
    },
    toJSON() {
      throw new Error('toJSON 炸了')
    },
  }
  const text = describeError(hostile)
  assert.equal(typeof text, 'string')
  assert.ok(text.length > 0)
})
