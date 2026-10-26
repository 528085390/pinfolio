import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS, migrate } from '../../server/migrations.js'
import {
  createSession, findValidSession, touchSession, deleteSession, listSessions,
  getSetting, setSetting, deleteSetting,
} from '../../server/auth/store.js'

const fresh = () => {
  const db = new DatabaseSync(':memory:')
  migrate(db, MIGRATIONS)
  return db
}

test('会话：创建后能用 token 找到，库里只存 hash', () => {
  const db = fresh()
  const s = createSession(db, { ua: 'iPhone', ip: '10.0.0.2', now: 1000 })
  const row = db.prepare('SELECT * FROM sessions').get() as any
  assert.notEqual(row.token_hash, s.token)
  assert.equal(row.token_hash.length, 64)
  const found = findValidSession(db, s.token, 1000)
  assert.ok(found)
  assert.equal(found!.id, s.id)
  assert.equal(found!.ua, 'iPhone')
})

test('会话：过期后找不到', () => {
  const db = fresh()
  const s = createSession(db, { now: 1000, ttlMs: 5000 })
  assert.ok(findValidSession(db, s.token, 5000))
  assert.equal(findValidSession(db, s.token, 6001), null)
})

test('会话：随便给个 token 找不到', () => {
  const db = fresh()
  assert.equal(findValidSession(db, 'nope', 1000), null)
})

test('会话：touch 在节流窗口内不重复写库，超过才顺延', () => {
  const db = fresh()
  const s = createSession(db, { now: 1000, ttlMs: 60_000 })
  assert.equal(touchSession(db, s.id, 1000 + 30_000, 60_000), false)
  assert.equal(touchSession(db, s.id, 1000 + 61_000, 60_000), true)
  const row = db.prepare('SELECT expires_at FROM sessions WHERE id = ?').get(s.id) as any
  // 第二次 touch 的 now 是 1000 + 61_000，过期时间 = now + ttl
  assert.equal(row.expires_at, new Date(1000 + 61_000 + 60_000).toISOString())
})

test('会话：IP 变了立刻写（不受 60 秒节流限制），没变不写', () => {
  const db = fresh()
  const s = createSession(db, { now: 1000, ip: '127.0.0.1' })
  // 节流窗口内，但 IP 变了 → 要写
  assert.equal(touchSession(db, s.id, 1000 + 5_000, 60_000, '120.1.2.3'), true)
  assert.equal((db.prepare('SELECT ip FROM sessions WHERE id = ?').get(s.id) as any).ip, '120.1.2.3')
  // IP 没变、还在节流窗口 → 什么都不写
  assert.equal(touchSession(db, s.id, 1000 + 6_000, 60_000, '120.1.2.3'), false)
})

test('会话：删除后失效，列表不含', () => {
  const db = fresh()
  const a = createSession(db, { now: 1000, ua: 'A' })
  const b = createSession(db, { now: 1000, ua: 'B' })
  assert.equal(listSessions(db, 1000).length, 2)
  deleteSession(db, a.id)
  assert.equal(findValidSession(db, a.token, 1000), null)
  assert.equal(listSessions(db, 1000).length, 1)
})

test('设置：读写删', () => {
  const db = fresh()
  assert.equal(getSetting(db, 'k'), null)
  setSetting(db, 'k', 'v1')
  assert.equal(getSetting(db, 'k'), 'v1')
  setSetting(db, 'k', 'v2')
  assert.equal(getSetting(db, 'k'), 'v2')
  deleteSetting(db, 'k')
  assert.equal(getSetting(db, 'k'), null)
})
