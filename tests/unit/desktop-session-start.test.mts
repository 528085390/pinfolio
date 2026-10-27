import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 必须在任何 server/* 被 import 之前设：db.ts 是模块级单例（import 即开库）
process.env.PINBOARD_DATA = mkdtempSync(join(tmpdir(), 'pinfolio-desktop-session-'))
const { startServer } = await import('../../server/app.js')
const { db } = await import('../../server/db.js')
const { findValidSession, getSetting } = await import('../../server/auth/store.js')

const countSessions = () =>
  Number((db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as any).n)

// —— 定时器记账：把全局 setTimeout / setInterval 包一层，看 startServer 失败路径有没有漏定时器 ——
// 写法照 tests/unit/server-start.test.mts：不引依赖，只记「现在还有哪些定时器活着」。
const live = new Map<unknown, 'timeout' | 'interval'>()
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
      live.delete(id) // 一次性定时器触发后自己下账
      return typeof fn === 'function' ? fn(...args) : undefined
    }
    id = real.setTimeout(wrapped, ms, ...rest)
    live.set(id, 'timeout')
    return id
  }
  g.setInterval = (fn: any, ms?: any, ...rest: any[]) => {
    const id = real.setInterval(fn, ms, ...rest)
    live.set(id, 'interval')
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

/** 先借系统一个空闲端口（用完就还），好让失败路径的端口可以被定点检查 */
async function freePort(): Promise<number> {
  const s = net.createServer()
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', () => resolve()))
  const port = (s.address() as AddressInfo).port
  await new Promise<void>((resolve) => s.close(() => resolve()))
  return port
}

/** 这个端口现在能不能被抢到：抢得到就说明上一个持有人真的放手了（端口没漏） */
async function canListen(port: number): Promise<boolean> {
  const s = net.createServer()
  const ok = await new Promise<boolean>((resolve) => {
    s.once('error', () => resolve(false))
    s.listen(port, '127.0.0.1', () => resolve(true))
  })
  if (ok) await new Promise<void>((resolve) => s.close(() => resolve()))
  return ok
}

test('startServer：desktopAutoLogin 发一张票，带 cookie 直接能读到 /api/notes', async () => {
  const h = await startServer({ port: 0, hostname: '127.0.0.1', desktopAutoLogin: true })
  const session = h.desktopSession
  try {
    assert.ok(session, '开了免密就必须把会话放进 handle')
    assert.equal(typeof session!.id, 'string')
    assert.equal(typeof session!.token, 'string')
    assert.equal(getSetting(db, 'desktop_session_id'), session!.id, '设置里要记下这条会话')
    assert.ok(findValidSession(db, session!.token), 'token 真要能在库里查到')

    const anon = await fetch(h.url + '/api/notes')
    assert.equal(anon.status, 401, '不带票仍然 401：免密是发一张票，不是拆掉守卫')

    const res = await fetch(h.url + '/api/notes', { headers: { cookie: 'pb_session=' + session!.token } })
    assert.equal(res.status, 200, '拿着这张票要能直接读写便签，不走登录页')
  } finally {
    await h.close()
  }
  // 关了就别留活票
  assert.equal(getSetting(db, 'desktop_session_id'), null, 'close() 之后设置要清掉')
  assert.equal(countSessions(), 0, 'close() 之后会话表要空')

  // 换一个干净的实例验证「票真的没了」：同一个 token 再拿来用必须是 401（而不是连不上）
  const other = await startServer({ port: 0, hostname: '127.0.0.1' })
  try {
    const res = await fetch(other.url + '/api/notes', { headers: { cookie: 'pb_session=' + session!.token } })
    assert.equal(res.status, 401, '重开服务后旧票不能再登录')
  } finally {
    await other.close()
  }
})

test('startServer：不传 desktopAutoLogin 时跟今天完全一样（不发会话）', async () => {
  const h = await startServer({ port: 0, hostname: '127.0.0.1' })
  try {
    assert.equal(h.desktopSession, undefined, 'Web 形态不发会话')
    assert.equal(getSetting(db, 'desktop_session_id'), null)
    assert.equal(countSessions(), 0)
    const res = await fetch(h.url + '/api/notes')
    assert.equal(res.status, 401, '未登录仍是 401')
  } finally {
    await h.close()
  }
  assert.equal(getSetting(db, 'desktop_session_id'), null)
  assert.equal(countSessions(), 0)
})

test('startServer：发会话抛错时不漏端口 / 定时器，也不留孤儿票', async () => {
  // 让 ensureDesktopSession 的最后一步（setSetting）必炸：settings 上挂一个 ABORT 触发器。
  // getSetting 是 SELECT，不受影响，所以会话行会被真建出来 —— 正好能验证事务回滚。
  const trigger = 'desktop_session_boom'
  patchTimers()
  try {
    const timersBefore = [...live.keys()]
    // 用一个定点的端口，这样失败之后能直接验证「端口已经放手」
    const port = await freePort()
    assert.equal(await canListen(port), true, '前置：这个端口本来是空的')
    db.exec(`CREATE TRIGGER ${trigger} BEFORE INSERT ON settings BEGIN SELECT RAISE(ABORT, 'boom'); END`)
    try {
      await assert.rejects(
        startServer({ port, hostname: '127.0.0.1', desktopAutoLogin: true }),
        /boom/,
        '发会话失败要让 startServer 抛出去（不能装作起好了）',
      )
    } finally {
      db.exec(`DROP TRIGGER ${trigger}`)
    }

    // 事务回滚：没留下「设置里查不到」的孤儿票，设置也没写脏
    assert.equal(countSessions(), 0, '半途失败要整体回滚，不留孤儿会话')
    assert.equal(getSetting(db, 'desktop_session_id'), null, '设置不该留下半条记录')

    // 失败路径自己收拾干净：端口放手、4 组定时器停掉
    assert.equal(await canListen(port), true, '已 bind 的端口必须关掉，否则调用方拿不到 handle 就再也拿不回来')
    assert.deepEqual([...live.keys()], timersBefore, '挂上的后台定时器必须全部停掉')
  } finally {
    unpatchTimers()
  }

  // 收拾干净之后还能正常起（触发器已摘掉），证明失败没有把模块状态 / db 弄坏
  const h = await startServer({ port: 0, hostname: '127.0.0.1', desktopAutoLogin: true })
  try {
    assert.ok(h.desktopSession, '下一次启动照样能发会话')
    assert.ok(findValidSession(db, h.desktopSession!.token))
  } finally {
    await h.close()
  }
  assert.equal(countSessions(), 0)
})
