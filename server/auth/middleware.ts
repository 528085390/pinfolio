import type { Context, Next } from 'hono'
import { db } from '../db.js'
import { findValidSession, touchSession } from './store.js'
import { hashToken } from './tokens.js'

export const COOKIE_NAME = 'pb_session'

export function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (!k) continue
    try { out[k] = decodeURIComponent(v) } catch { out[k] = v }
  }
  return out
}

// 白名单：静态资源不经过这里（挂在 app 上），所以只需要列 /api 下的公开路由。
const PUBLIC: Array<[string, string]> = [
  ['GET', '/api/health'],
  ['POST', '/api/auth/login'],
  ['GET', '/api/auth/state'],
  ['POST', '/api/auth/setup'],
]

export function isPublic(method: string, path: string): boolean {
  return PUBLIC.some(([m, p]) => m === method && p === path)
}

// 退出登录不带 body，豁免 JSON Content-Type 校验（踢下线本身无害）。
const NO_BODY_OK: Array<[string, string]> = [['POST', '/api/auth/logout']]

function findApiToken(token: string): string | null {
  const row = db.prepare('SELECT id FROM api_tokens WHERE token_hash = ?').get(hashToken(token)) as any
  if (!row) return null
  db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), row.id)
  return String(row.id)
}

/** 所有 /api/* 的守卫：白名单放行，Bearer 或会话 cookie 二选一。 */
export async function authMiddleware(c: Context, next: Next) {
  const method = c.req.method
  const path = c.req.path
  if (isPublic(method, path)) return next()

  const bearer = c.req.header('authorization') ?? ''
  if (bearer.toLowerCase().startsWith('bearer ')) {
    const token = bearer.slice(7).trim()
    if (token && findApiToken(token)) {
      c.set('authKind', 'token')
      return next()
    }
    return c.json({ error: 'unauthorized' }, 401)
  }

  // CSRF：写接口只收 JSON（跨站表单发不出这个 Content-Type）
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const ct = (c.req.header('content-type') ?? '').toLowerCase()
    const exempt = NO_BODY_OK.some(([m, p]) => m === method && p === path)
    if (!exempt && !ct.includes('application/json')) return c.json({ error: 'unsupported media type' }, 415)
  }

  const token = parseCookies(c.req.header('cookie') ?? '')[COOKIE_NAME]
  const session = token ? findValidSession(db, token) : null
  if (!session) return c.json({ error: 'unauthorized' }, 401)

  touchSession(db, session.id)
  c.set('sessionId', session.id)
  return next()
}

export function clientIp(c: Context): string {
  if (process.env.TRUST_PROXY === '1') {
    const xff = c.req.header('x-forwarded-for')
    if (xff) return xff.split(',')[0].trim()
  }
  const incoming = (c.env as any)?.incoming
  return incoming?.socket?.remoteAddress ?? 'unknown'
}

export function isHttps(c: Context): boolean {
  if (process.env.TRUST_PROXY === '1') {
    if ((c.req.header('x-forwarded-proto') ?? '').toLowerCase() === 'https') return true
  }
  try { return new URL(c.req.url).protocol === 'https:' } catch { return false }
}
