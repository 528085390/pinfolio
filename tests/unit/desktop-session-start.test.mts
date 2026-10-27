import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 必须在任何 server/* 被 import 之前设：db.ts 是模块级单例（import 即开库）
process.env.PINBOARD_DATA = mkdtempSync(join(tmpdir(), 'pinfolio-desktop-session-'))
const { startServer } = await import('../../server/app.js')
const { db } = await import('../../server/db.js')
const { findValidSession, getSetting } = await import('../../server/auth/store.js')

const countSessions = () =>
  Number((db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as any).n)

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
  const after = await fetch(h.url + '/api/notes', { headers: { cookie: 'pb_session=' + session!.token } })
    .then((r) => r.status, () => 0)
  assert.notEqual(after, 200, '旧票在关掉服务之后不能还能用')
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
