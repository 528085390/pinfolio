import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { hashToken, newApiToken, newSessionToken } from './tokens.js'

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const TOUCH_THROTTLE_MS = 60_000

export type SessionRow = {
  id: string
  ua: string
  ip: string
  createdAt: string
  lastSeenAt: string
  expiresAt: string
}

export function createSession(
  db: DatabaseSync,
  opts: { ua?: string; ip?: string; now?: number; ttlMs?: number } = {},
): { id: string; token: string; expiresAt: string } {
  const now = opts.now ?? Date.now()
  const ttl = opts.ttlMs ?? SESSION_TTL_MS
  const id = randomBytes(16).toString('hex')
  const token = newSessionToken()
  const created = new Date(now).toISOString()
  const expires = new Date(now + ttl).toISOString()
  db.prepare(
    'INSERT INTO sessions (id, token_hash, created_at, last_seen_at, expires_at, ua, ip) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, hashToken(token), created, created, expires, opts.ua ?? '', opts.ip ?? '')
  return { id, token, expiresAt: expires }
}

export function findValidSession(db: DatabaseSync, token: string, now = Date.now()): SessionRow | null {
  const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hashToken(token)) as any
  if (!row) return null
  if (Date.parse(row.expires_at) <= now) return null
  return {
    id: row.id, ua: row.ua, ip: row.ip,
    createdAt: row.created_at, lastSeenAt: row.last_seen_at, expiresAt: row.expires_at,
  }
}

/**
 * 滑动续期；同一会话 60 秒内不重复写 last_seen（返回 false 表示什么都没写）。
 *
 * ip 变了要立刻写：反代没配好时老会话存的可能是 127.0.0.1，配好之后设备列表得自己纠正过来，
 * 不能等到 30 天后重登（手机 IP 也会随网络变，同样按最新一次访问记）。
 */
export function touchSession(db: DatabaseSync, id: string, now = Date.now(), ttlMs = SESSION_TTL_MS, ip?: string): boolean {
  const row = db.prepare('SELECT last_seen_at, ip FROM sessions WHERE id = ?').get(id) as any
  if (!row) return false
  let wrote = false
  if (ip && ip !== row.ip) {
    db.prepare('UPDATE sessions SET ip = ? WHERE id = ?').run(ip, id)
    wrote = true
  }
  if (now - Date.parse(row.last_seen_at) >= TOUCH_THROTTLE_MS) {
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?')
      .run(new Date(now).toISOString(), new Date(now + ttlMs).toISOString(), id)
    wrote = true
  }
  return wrote
}

export function deleteSession(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

export function deleteOtherSessions(db: DatabaseSync, keepId: string): void {
  db.prepare('DELETE FROM sessions WHERE id <> ?').run(keepId)
}

export function listSessions(db: DatabaseSync, now = Date.now()): SessionRow[] {
  const rows = db.prepare('SELECT * FROM sessions ORDER BY last_seen_at DESC').all() as any[]
  return rows
    .filter((r) => Date.parse(r.expires_at) > now)
    .map((r) => ({
      id: r.id, ua: r.ua, ip: r.ip,
      createdAt: r.created_at, lastSeenAt: r.last_seen_at, expiresAt: r.expires_at,
    }))
}

export function getSetting(db: DatabaseSync, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any
  return row ? String(row.value) : null
}

export function setSetting(db: DatabaseSync, key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}

export function deleteSetting(db: DatabaseSync, key: string): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key)
}

// ---- API token（脚本 / e2e 用，只存 hash，明文只在创建时返回一次）----
export type ApiTokenRow = { id: string; name: string; createdAt: string; lastUsedAt: string | null }

export function createApiToken(db: DatabaseSync, name: string): { id: string; name: string; token: string } {
  const id = randomBytes(16).toString('hex')
  const { token, hash } = newApiToken()
  db.prepare('INSERT INTO api_tokens (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(id, name, hash, new Date().toISOString())
  return { id, name, token }
}

export function listApiTokens(db: DatabaseSync): ApiTokenRow[] {
  const rows = db.prepare('SELECT id, name, created_at, last_used_at FROM api_tokens ORDER BY created_at DESC').all() as any[]
  return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, lastUsedAt: r.last_used_at ?? null }))
}

export function deleteApiToken(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM api_tokens WHERE id = ?').run(id)
}
