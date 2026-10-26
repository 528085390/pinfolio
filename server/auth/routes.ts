import { Hono } from 'hono'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { db } from '../db.js'
import {
  createApiToken, createSession, deleteApiToken, deleteOtherSessions, deleteSession, findValidSession,
  getSetting, listApiTokens, listSessions, setSetting,
} from './store.js'
import { hashPassword, verifyPassword } from './password.js'
import { LoginLimiter } from './limiter.js'
import { COOKIE_NAME, clientIp, isHttps, parseCookies } from './middleware.js'
import { t } from '../i18n.js'

const limiter = new LoginLimiter()
const MAX_AGE = 30 * 24 * 60 * 60

function currentSession(c: Context) {
  const token = getCookie(c, COOKIE_NAME) || parseCookies(c.req.header('cookie') ?? '')[COOKIE_NAME]
  return token ? findValidSession(db, token) : null
}

function startSession(c: Context) {
  const s = createSession(db, { ua: c.req.header('user-agent') ?? '', ip: clientIp(c) })
  setCookie(c, COOKIE_NAME, s.token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: MAX_AGE,
    secure: isHttps(c),
  })
  return s
}

export const authRoute = new Hono()

authRoute.get('/state', (c) => {
  const hasPassword = Boolean(getSetting(db, 'password_hash'))
  return c.json({ setupRequired: !hasPassword, authed: Boolean(currentSession(c)) })
})

authRoute.post('/setup', async (c) => {
  if (getSetting(db, 'password_hash')) return c.json({ error: 'already initialized' }, 409)
  const body = await c.req.json().catch(() => ({})) as { password?: string }
  const password = String(body.password ?? '')
  if (password.length < 8) return c.json({ error: t('密码至少 8 位') }, 400)
  setSetting(db, 'password_hash', hashPassword(password))
  startSession(c)
  return c.json({ ok: true })
})

authRoute.post('/login', async (c) => {
  const ip = clientIp(c)
  const gate = limiter.check(ip)
  if (!gate.allowed) {
    c.header('Retry-After', String(Math.ceil(gate.retryAfterMs / 1000)))
    return c.json({ error: t('尝试过于频繁，请稍后再试') }, 429)
  }
  const stored = getSetting(db, 'password_hash')
  if (!stored) return c.json({ error: t('尚未设置密码') }, 400)
  const body = await c.req.json().catch(() => ({})) as { password?: string }
  if (!verifyPassword(String(body.password ?? ''), stored)) {
    limiter.fail(ip)
    return c.json({ error: t('密码不对') }, 401)
  }
  limiter.succeed(ip)
  startSession(c)
  return c.json({ ok: true })
})

authRoute.post('/logout', (c) => {
  const token = getCookie(c, COOKIE_NAME)
  if (token) {
    const s = findValidSession(db, token)
    if (s) deleteSession(db, s.id)
  }
  deleteCookie(c, COOKIE_NAME, { path: '/' })
  return c.json({ ok: true })
})

authRoute.post('/password', async (c) => {
  const me = currentSession(c)
  if (!me) return c.json({ error: 'unauthorized' }, 401)
  const stored = getSetting(db, 'password_hash')
  const body = await c.req.json().catch(() => ({})) as { current?: string; next?: string }
  if (!stored || !verifyPassword(String(body.current ?? ''), stored)) return c.json({ error: t('当前密码不对') }, 401)
  const next = String(body.next ?? '')
  if (next.length < 8) return c.json({ error: t('新密码至少 8 位') }, 400)
  setSetting(db, 'password_hash', hashPassword(next))
  deleteOtherSessions(db, me.id)
  return c.json({ ok: true })
})

authRoute.get('/tokens', (c) => {
  if (!currentSession(c)) return c.json({ error: 'unauthorized' }, 401)
  return c.json(listApiTokens(db))
})

authRoute.post('/tokens', async (c) => {
  if (!currentSession(c)) return c.json({ error: 'unauthorized' }, 401)
  const body = await c.req.json().catch(() => ({})) as { name?: string }
  const name = String(body.name ?? '').trim() || 'token'
  return c.json(createApiToken(db, name))
})

authRoute.delete('/tokens/:id', (c) => {
  if (!currentSession(c)) return c.json({ error: 'unauthorized' }, 401)
  deleteApiToken(db, c.req.param('id'))
  return c.json({ ok: true })
})

// ---- 设备管理（设置页用；需要已登录）----
authRoute.get('/sessions', (c) => {
  const me = currentSession(c)
  if (!me) return c.json({ error: 'unauthorized' }, 401)
  return c.json(listSessions(db).map((s) => ({ ...s, current: s.id === me.id })))
})

authRoute.delete('/sessions/:id', (c) => {
  const me = currentSession(c)
  if (!me) return c.json({ error: 'unauthorized' }, 401)
  deleteSession(db, c.req.param('id'))
  return c.json({ ok: true })
})

authRoute.post('/sessions/revoke-others', (c) => {
  const me = currentSession(c)
  if (!me) return c.json({ error: 'unauthorized' }, 401)
  deleteOtherSessions(db, me.id)
  return c.json({ ok: true })
})
