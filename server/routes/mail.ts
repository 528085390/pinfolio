import { Hono } from 'hono'
import {
  clearLocalRead, createAccount, deleteAccount, getAccount, listAccounts, localReadCount,
  localReadKeys, markLocalRead, normalizeAccountInput, publicAccount, unmarkLocalRead, updateAccount,
} from '../mail/store.js'
import {
  clearAccountCaches, dropAllConnections, dropConnection, getMessage, listFolders, listMessages,
  testConnection, unseenCounts, friendlyError,
} from '../mail/client.js'

export const mailRoute = new Hono()

const DEFAULT_FOLDER = 'INBOX'

mailRoute.get('/accounts', async (c) => {
  const accounts = listAccounts()
  const withCounts = c.req.query('counts') === '1'
  const folder = c.req.query('folder') || DEFAULT_FOLDER
  let counts: Record<number, { unseen: number; total: number }> = {}
  let errors: { accountId: number; label: string; error: string }[] = []
  if (withCounts && accounts.length) {
    // 手动刷新时带 fresh=1，未读数才真的去服务器重取（FR-15：只在刷新时更新）
    const res = await unseenCounts(accounts.filter((a) => a.enabled === 1), folder, c.req.query('fresh') === '1')
    counts = res.counts
    errors = res.errors
  }
  return c.json({
    accounts: accounts.map((a) => ({
      ...publicAccount(a),
      unseen: counts[a.id]?.unseen ?? null,
      total: counts[a.id]?.total ?? null,
      error: errors.find((e) => e.accountId === a.id)?.error ?? null,
    })),
  })
})

mailRoute.post('/accounts', async (c) => {
  const body: any = await c.req.json().catch(() => ({}))
  const parsed = normalizeAccountInput(body)
  if ('error' in parsed) return c.json({ error: parsed.error }, 400)
  if (!parsed.value.password) return c.json({ error: '请填写密码 / 授权码' }, 400)
  const row = createAccount(parsed.value)
  return c.json(publicAccount(row), 201)
})

mailRoute.put('/accounts/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!getAccount(id)) return c.json({ error: '账号不存在' }, 404)
  const body: any = await c.req.json().catch(() => ({}))
  const parsed = normalizeAccountInput(body)
  if ('error' in parsed) return c.json({ error: parsed.error }, 400)
  const row = updateAccount(id, parsed.value)
  dropConnection(id)
  clearAccountCaches(id)
  return c.json(publicAccount(row!))
})

mailRoute.delete('/accounts/:id', (c) => {
  const id = Number(c.req.param('id'))
  const ok = deleteAccount(id)
  dropConnection(id)
  clearAccountCaches(id)
  if (!ok) return c.json({ error: '账号不存在' }, 404)
  return c.json({ ok: true })
})

mailRoute.post('/accounts/test', async (c) => {
  const body: any = await c.req.json().catch(() => ({}))
  let input: any = {
    host: String(body.host ?? '').trim(),
    port: Number(body.port ?? 993),
    username: String(body.username ?? '').trim(),
    password: body.password === undefined ? '' : String(body.password),
    security: String(body.security ?? 'ssl'),
  }
  if (body.id) {
    const acc = getAccount(Number(body.id))
    if (!acc) return c.json({ error: '账号不存在' }, 404)
    input = {
      host: input.host || acc.host,
      port: Number(body.port ?? acc.port),
      username: input.username || acc.username,
      password: input.password || acc.password,
      security: input.security || acc.security,
    }
  }
  if (!input.host || !input.username || !input.password) return c.json({ error: '服务器地址、用户名、密码都要填' }, 400)
  try {
    const res = await testConnection(input)
    return c.json({ ok: true, ...res })
  } catch (err) {
    return c.json({ ok: false, error: friendlyError(err) }, 400)
  }
})

mailRoute.get('/folders', async (c) => {
  const id = Number(c.req.query('account'))
  const acc = getAccount(id)
  if (!acc) return c.json({ error: '账号不存在' }, 404)
  try {
    const folders = await listFolders(acc, c.req.query('fresh') === '1')
    return c.json({ folders })
  } catch (err) {
    return c.json({ error: friendlyError(err), folders: [] }, 502)
  }
})

mailRoute.get('/messages', async (c) => {
  const accounts = listAccounts().filter((a) => a.enabled === 1)
  const which = (c.req.query('account') || 'all').trim()
  const folder = (c.req.query('folder') || DEFAULT_FOLDER).trim() || DEFAULT_FOLDER
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 50), 1), 100)
  const offset = Math.max(Number(c.req.query('offset') || 0), 0)
  const fresh = c.req.query('fresh') === '1'

  if (!accounts.length) {
    return c.json({ items: [], total: 0, unseen: 0, hasMore: false, errors: [], partial: false, noAccounts: true })
  }
  const target = which === 'all' ? accounts : accounts.filter((a) => String(a.id) === which)
  if (!target.length) return c.json({ error: '账号不存在或已停用' }, 404)

  const res = await listMessages({ accounts: target, folder, offset, limit, fresh })
  const marks = localReadKeys(target.map((a) => a.id), folder)
  const items = res.items.map((r) => ({
    ...r,
    accountLabel: target.find((a) => a.id === r.accountId)?.label || '',
    accountEmail: target.find((a) => a.id === r.accountId)?.email || '',
    localRead: marks.has(r.accountId + ':' + r.uid),
  }))
  return c.json({ ...res, items })
})

mailRoute.get('/message', async (c) => {
  const id = Number(c.req.query('account'))
  const acc = getAccount(id)
  if (!acc) return c.json({ error: '账号不存在' }, 404)
  const folder = (c.req.query('folder') || DEFAULT_FOLDER).trim() || DEFAULT_FOLDER
  const uid = Number(c.req.query('uid'))
  if (!Number.isFinite(uid) || uid <= 0) return c.json({ error: 'uid 不合法' }, 400)
  try {
    const { message } = await getMessage(acc, folder, uid)
    return c.json({ ...message, accountLabel: acc.label, accountEmail: acc.email })
  } catch (err) {
    return c.json({ error: friendlyError(err) }, 502)
  }
})

mailRoute.get('/attachment', async (c) => {
  const id = Number(c.req.query('account'))
  const acc = getAccount(id)
  if (!acc) return c.json({ error: '账号不存在' }, 404)
  const folder = (c.req.query('folder') || DEFAULT_FOLDER).trim() || DEFAULT_FOLDER
  const uid = Number(c.req.query('uid'))
  const index = Number(c.req.query('index'))
  if (!Number.isFinite(uid) || uid <= 0 || !Number.isFinite(index) || index < 0) return c.json({ error: '参数不合法' }, 400)
  try {
    const entry = await getMessage(acc, folder, uid)
    const meta = entry.message.attachments[index]
    const data = entry.attachments[index]
    if (!meta || !data) return c.json({ error: '附件不存在' }, 404)
    const filename = meta.filename || 'attachment'
    const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
    return c.body(new Uint8Array(data), 200, {
      'Content-Type': meta.contentType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Length': String(data.length),
      'Cache-Control': 'private, max-age=600',
    })
  } catch (err) {
    return c.json({ error: friendlyError(err) }, 502)
  }
})

mailRoute.post('/local-read', async (c) => {
  const body: any = await c.req.json().catch(() => ({}))
  const account = Number(body.account)
  const uid = Number(body.uid)
  const folder = String(body.folder || DEFAULT_FOLDER)
  if (!Number.isFinite(account) || !Number.isFinite(uid)) return c.json({ error: '参数不合法' }, 400)
  if (!getAccount(account)) return c.json({ error: '账号不存在' }, 404)
  markLocalRead(account, folder, uid)
  return c.json({ ok: true, marked: localReadCount() })
})

mailRoute.delete('/local-read', (c) => {
  const account = c.req.query('account')
  const folder = c.req.query('folder') || DEFAULT_FOLDER
  const uid = Number(c.req.query('uid'))
  if (account === 'all' || account === undefined) {
    clearLocalRead()
    return c.json({ ok: true, cleared: 'all' })
  }
  if (!Number.isFinite(uid)) {
    clearLocalRead(Number(account))
    return c.json({ ok: true, cleared: Number(account) })
  }
  unmarkLocalRead(Number(account), folder, uid)
  return c.json({ ok: true })
})

mailRoute.get('/status', (c) => c.json({ marked: localReadCount(), accounts: listAccounts().length }))

// 后端进程退出前主动断开所有 IMAP 连接（tsx 被 kill 时也能收尾）
export function shutdownMail() {
  dropAllConnections()
}
