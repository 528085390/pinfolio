import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// 必须在任何 server/* 被 import 之前设：db.ts 是模块级单例（import 即开库）
process.env.PINBOARD_DATA = mkdtempSync(join(tmpdir(), "pinfolio-start-"))
const { startServer, resolveListenOptions } = await import("../../server/app.js")

// —— 定时器记账：不引依赖，只把全局 setTimeout / setInterval 包一层，记录「现在还有哪些定时器活着」——
// 用途：证明二次 startServer() 不会留下双份轮询 / 双份 03:00 备份链，以及 close() 之后定时器全部停掉。
type Live = Map<unknown, "timeout" | "interval">
const live: Live = new Map()
const real = {
  setTimeout: globalThis.setTimeout.bind(globalThis),
  setInterval: globalThis.setInterval.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  clearInterval: globalThis.clearInterval.bind(globalThis),
}
let patched = false

function patchTimers() {
  if (patched) return
  patched = true
  const g = globalThis as any
  g.setTimeout = (fn: any, ms?: any, ...rest: any[]) => {
    let id: any
    const wrapped = (...args: any[]) => {
      live.delete(id) // 一次性定时器触发后自己下账，免得和「被 stop 掉」混在一起
      return typeof fn === "function" ? fn(...args) : undefined
    }
    id = real.setTimeout(wrapped, ms, ...rest)
    live.set(id, "timeout")
    return id
  }
  g.setInterval = (fn: any, ms?: any, ...rest: any[]) => {
    const id = real.setInterval(fn, ms, ...rest)
    live.set(id, "interval")
    return id
  }
  g.clearTimeout = (id: any) => { live.delete(id); return real.clearTimeout(id) }
  g.clearInterval = (id: any) => { live.delete(id); return real.clearInterval(id) }
}

function unpatchTimers() {
  if (!patched) return
  patched = false
  const g = globalThis as any
  g.setTimeout = real.setTimeout
  g.setInterval = real.setInterval
  g.clearTimeout = real.clearTimeout
  g.clearInterval = real.clearInterval
  live.clear()
}

const ids = () => [...live.keys()]
const intervals = () => ids().filter((id) => live.get(id) === "interval")
/** 两个快照是不是同一批定时器（同一批对象引用，不比内容） */
const sameTimers = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((id) => b.includes(id))

test("resolveListenOptions：默认只绑回环 7788", () => {
  assert.deepEqual(resolveListenOptions(undefined, {}), { hostname: "127.0.0.1", port: 7788, desktopAutoLogin: false })
})

test("resolveListenOptions：desktopAutoLogin 只允许回环地址", () => {
  assert.throws(() => resolveListenOptions({ hostname: "0.0.0.0", desktopAutoLogin: true }, {}), /回环/)
  assert.doesNotThrow(() => resolveListenOptions({ hostname: "127.0.0.1", desktopAutoLogin: true }))
})

test("startServer：port 0 回传真实端口，close 可重复调用", async () => {
  // hostname 显式传：不传就会回落到进程环境的 HOST，断言不该由外部环境决定
  const h = await startServer({ port: 0, hostname: "127.0.0.1" })
  assert.ok(h.port > 0)
  assert.equal(h.url, "http://127.0.0.1:" + h.port)
  assert.equal(h.port, Number(new URL(h.url).port), "url 里的端口必须就是真实监听端口")
  const res = await fetch(h.url + "/api/health")
  assert.equal(res.status, 200)
  await h.close()
  await h.close()          // 幂等，不得抛
  await assert.rejects(fetch(h.url + "/api/health"))
})

test("startServer：Web 形态未登录仍是 401", async () => {
  const h = await startServer({ port: 0, hostname: "127.0.0.1" })
  const res = await fetch(h.url + "/api/notes")
  assert.equal(res.status, 401)
  await h.close()
})

test("后台启动器：重复 start 不挂第二份，stop 之后定时器全清", async () => {
  const poll = await import("../../server/metrics/poll.js")
  const tunnel = await import("../../server/tunnel.js")
  const schedule = await import("../../server/backup/schedule.js")
  const sweep = await import("../../server/attachments/store.js")
  const { db } = await import("../../server/db.js")

  patchTimers()
  try {
    const first = [
      poll.startMetricsPoller(),
      tunnel.startTunnelProbe(),
      schedule.startBackupScheduler(db),
      sweep.startAttachmentSweep(),
    ]
    const afterFirst = ids()
    assert.equal(intervals().length, 3, "三个周期任务各挂一条 interval：指标轮询 / 公网探活 / 图片清扫")
    assert.ok(afterFirst.length > 3, "开机首跑与 03:00 备份的 timeout 也要真的挂上")

    const second = [
      poll.startMetricsPoller(),
      tunnel.startTunnelProbe(),
      schedule.startBackupScheduler(db),
      sweep.startAttachmentSweep(),
    ]
    assert.ok(sameTimers(ids(), afterFirst), "第二次 start 不得新增任何定时器（否则会有双份轮询 / 双份备份链）")

    for (const stop of [...first, ...second]) stop()
    assert.deepEqual(ids(), [], "stop 之后 4 组定时器全部清掉（含 60s / 3s 那几条首跑 timeout）")
  } finally {
    unpatchTimers()
  }
})

test("startServer 起两个实例：不挂双份定时器，close 之后全停", async () => {
  patchTimers()
  try {
    const a = await startServer({ port: 0, hostname: "127.0.0.1" })
    const afterFirst = ids()
    assert.equal(intervals().length, 3)

    const b = await startServer({ port: 0, hostname: "127.0.0.1" })
    assert.notEqual(a.port, b.port, "两个实例各自拿到独立端口")
    assert.ok(sameTimers(ids(), afterFirst), "第二个实例不得再挂一份后台定时器")

    await a.close()
    await b.close()
    assert.deepEqual(ids(), [], "close() 之后定时器全部停掉，不再往已关闭的实例里写")
  } finally {
    unpatchTimers()
  }
})
