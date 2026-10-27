import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS, migrate } from '../../server/migrations.js'
import { DESKTOP_UA, ensureDesktopSession, clearDesktopSession } from '../../server/desktop-session.js'
import { findValidSession, getSetting } from '../../server/auth/store.js'

const fresh = () => {
  const db = new DatabaseSync(':memory:')
  migrate(db, MIGRATIONS)
  return db
}

const countSessions = (db: DatabaseSync) =>
  Number((db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as any).n)

test('桌面会话：连调两次只留一条，设置指向新的那条', () => {
  const db = fresh()
  const first = ensureDesktopSession(db, { ip: '127.0.0.1' })
  assert.equal(countSessions(db), 1)
  assert.equal(getSetting(db, 'desktop_session_id'), first.id)

  const second = ensureDesktopSession(db, { ip: '127.0.0.1' })
  assert.equal(countSessions(db), 1, '旧会话要被删掉，不能两条并存')
  assert.equal(getSetting(db, 'desktop_session_id'), second.id)
  assert.notEqual(second.id, first.id, '每次都发新 id')
  assert.notEqual(second.token, first.token, '不复用旧 token（旧的可能已经泄露给别的窗口）')
  assert.equal(findValidSession(db, first.token), null, '旧 token 立刻失效')
})

test('桌面会话：返回的 token 真能查到会话，且能被当作登录态', () => {
  const db = fresh()
  const s = ensureDesktopSession(db, { ip: '127.0.0.1', now: 1_700_000_000_000 })
  const found = findValidSession(db, s.token, 1_700_000_000_000)
  assert.ok(found, 'token 必须能查到会话（库里只存 hash）')
  assert.equal(found!.id, s.id)
  assert.equal(found!.ua, DESKTOP_UA, '会话 UA 要能一眼认出是桌面端发的')
  assert.equal(found!.ip, '127.0.0.1')
  assert.equal(s.id, found!.id)
  assert.match(s.id, /^[0-9a-f]{32}$/)
  assert.ok(s.token.length >= 32)
})

test('桌面会话：清掉之后表空、设置也没了，重复清不抛', () => {
  const db = fresh()
  const s = ensureDesktopSession(db, { ip: '127.0.0.1' })
  clearDesktopSession(db)
  assert.equal(countSessions(db), 0)
  assert.equal(getSetting(db, 'desktop_session_id'), null)
  assert.equal(findValidSession(db, s.token), null)
  // 幂等：没有会话 / 没有设置时再清一次也不能抛
  assert.doesNotThrow(() => clearDesktopSession(db))
  assert.doesNotThrow(() => clearDesktopSession(fresh()))
})

test('桌面会话：设置里留着一条已经不存在的旧 id，照样能建新的', () => {
  const db = fresh()
  const s = ensureDesktopSession(db, { ip: '127.0.0.1' })
  // 模拟「设置还在，但会话行已经被别处删了」（重装 / 手动清库）
  db.prepare('DELETE FROM sessions WHERE id = ?').run(s.id)
  const again = ensureDesktopSession(db, { ip: '127.0.0.1' })
  assert.equal(countSessions(db), 1)
  assert.equal(getSetting(db, 'desktop_session_id'), again.id)
  assert.ok(findValidSession(db, again.token))
})
