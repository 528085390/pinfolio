import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// 必须在任何 server/* 被 import 之前设：db.ts 是模块级单例（import 即开库）
process.env.PINBOARD_DATA = mkdtempSync(join(tmpdir(), "pinfolio-start-"))
const { startServer, resolveListenOptions } = await import("../../server/app.js")

test("resolveListenOptions：默认只绑回环 7788", () => {
  assert.deepEqual(resolveListenOptions(undefined, {}), { hostname: "127.0.0.1", port: 7788, desktopAutoLogin: false })
})

test("resolveListenOptions：desktopAutoLogin 只允许回环地址", () => {
  assert.throws(() => resolveListenOptions({ hostname: "0.0.0.0", desktopAutoLogin: true }, {}), /回环/)
  assert.doesNotThrow(() => resolveListenOptions({ hostname: "127.0.0.1", desktopAutoLogin: true }))
})

test("startServer：port 0 回传真实端口，close 可重复调用", async () => {
  const h = await startServer({ port: 0 })
  assert.ok(h.port > 0)
  assert.equal(h.url, "http://127.0.0.1:" + h.port)
  const res = await fetch(h.url + "/api/health")
  assert.equal(res.status, 200)
  await h.close()
  await h.close()          // 幂等，不得抛
  await assert.rejects(fetch(h.url + "/api/health"))
})

test("startServer：Web 形态未登录仍是 401", async () => {
  const h = await startServer({ port: 0 })
  const res = await fetch(h.url + "/api/notes")
  assert.equal(res.status, 401)
  await h.close()
})
