import { Hono } from 'hono'
import {
  clearLocalRead, createAccount, deleteAccount, getAccount, listAccounts, localReadCount,
  localReadKeys, markLocalRead, normalizeAccountInput, publicAccount, unmarkLocalRead, updateAccount,
} from './store.js'
import {
  clearAccountCaches, dropAllConnections, dropConnection, getMessage, listFolders, listMessages,
  testConnection, unseenCounts, friendlyError, proxyOf,
} from './client.js'
import {
  DEFAULT_FOLDER, attachmentHeaders, decorateItems, fillTestInput, mergeAccountCounts,
  missingTestField, parseAttachmentQuery, parseClearQuery, parseListQuery, parseMarkBody, pickTargets,
  posInt, testInputFrom,
} from './params.js'
import { t } from '../i18n.js'

// 邮件页的 HTTP 面。参数解析与纯拼装在 params.ts（有单测），这里只做取账号、调 client、拼响应。
export const mailRoute = new Hono()

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
  return c.json({ accounts: mergeAccountCounts(accounts.map((a) => publicAccount(a)), counts, errors) })
})

mailRoute.post('/accounts', async (c) => {
  const body: any = await c.req.json().catch(() => ({}))
  const parsed = normalizeAccountInput(body)
  if ('error' in parsed) return c.json({ error: parsed.error }, 400)
  if (!parsed.value.password) return c.json({ error: t('请填写密码 / 授权码') }, 400)
  const row = createAccount(parsed.value)
  return c.json(publicAccount(row), 201)
})

mailRoute.put('/accounts/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!getAccount(id)) return c.json({ error: t('账号不存在') }, 404)
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
  if (!ok) return c.json({ error: t('账号不存在') }, 404)
  return c.json({ ok: true })
})

mailRoute.post('/accounts/test', async (c) => {
  const body: any = await c.req.json().catch(() => ({}))
  let input = testInputFrom(body)
  if (body.id) {
    const acc = getAccount(Number(body.id))
    if (!acc) return c.json({ error: t('账号不存在') }, 404)
    input = fillTestInput(input, body, acc)
  }
  if (missingTestField(input)) return c.json({ error: t('服务器地址、用户名、密码都要填') }, 400)
  try {
    const res = await testConnection(input)
    return c.json({ ok: true, ...res })
  } catch (err) {
    return c.json({ ok: false, error: friendlyError(err, proxyOf({ proxy: input.proxy })) }, 400)
  }
})

mailRoute.get('/folders', async (c) => {
  const id = Number(c.req.query('account'))
  const acc = getAccount(id)
  if (!acc) return c.json({ error: t('账号不存在') }, 404)
  try {
    const folders = await listFolders(acc, c.req.query('fresh') === '1')
    return c.json({ folders })
  } catch (err) {
    return c.json({ error: friendlyError(err, proxyOf(acc)), folders: [] }, 502)
  }
})

mailRoute.get('/messages', async (c) => {
  const accounts = listAccounts().filter((a) => a.enabled === 1)
  const { which, folder, limit, offset, fresh } = parseListQuery(c.req.query())
  if (!accounts.length) {
    return c.json({ items: [], total: 0, unseen: 0, hasMore: false, errors: [], partial: false, fetchedAt: 0, noAccounts: true })
  }
  const target = pickTargets(accounts, which)
  if (!target.length) return c.json({ error: t('账号不存在或已停用') }, 404)

  const res = await listMessages({ accounts: target, folder, offset, limit, fresh })
  const marks = localReadKeys(target.map((a) => a.id), folder)
  return c.json({ ...res, items: decorateItems(res.items, target, marks) })
})

mailRoute.get('/message', async (c) => {
  const acc = getAccount(Number(c.req.query('account')))
  if (!acc) return c.json({ error: t('账号不存在') }, 404)
  const folder = (c.req.query('folder') || DEFAULT_FOLDER).trim() || DEFAULT_FOLDER
  const uid = posInt(c.req.query('uid'))
  if (uid === null) return c.json({ error: t('uid 不合法') }, 400)
  try {
    const { message } = await getMessage(acc, folder, uid)
    return c.json({ ...message, accountLabel: acc.label, accountEmail: acc.email })
  } catch (err) {
    return c.json({ error: friendlyError(err, proxyOf(acc)) }, 502)
  }
})

mailRoute.get('/attachment', async (c) => {
  const acc = getAccount(Number(c.req.query('account')))
  if (!acc) return c.json({ error: t('账号不存在') }, 404)
  const q = parseAttachmentQuery(c.req.query())
  if ('error' in q) return c.json({ error: q.error }, 400)
  try {
    const entry = await getMessage(acc, q.folder, q.uid)
    const meta = entry.message.attachments[q.index]
    const data = entry.attachments[q.index]
    if (!meta || !data) return c.json({ error: t('附件不存在') }, 404)
    return c.body(new Uint8Array(data), 200, attachmentHeaders(meta, data.length))
  } catch (err) {
    return c.json({ error: friendlyError(err, proxyOf(acc)) }, 502)
  }
})

mailRoute.post('/local-read', async (c) => {
  const body: any = await c.req.json().catch(() => ({}))
  const parsed = parseMarkBody(body)
  if ('error' in parsed) return c.json({ error: parsed.error }, 400)
  if (!getAccount(parsed.account)) return c.json({ error: t('账号不存在') }, 404)
  markLocalRead(parsed.account, parsed.folder, parsed.uid)
  return c.json({ ok: true, marked: localReadCount() })
})

mailRoute.delete('/local-read', (c) => {
  const q = parseClearQuery(c.req.query())
  if (q.mode === 'all') {
    clearLocalRead()
    return c.json({ ok: true, cleared: 'all' })
  }
  if (q.mode === 'account') {
    clearLocalRead(q.account)
    return c.json({ ok: true, cleared: q.account })
  }
  unmarkLocalRead(q.account, q.folder, q.uid)
  return c.json({ ok: true })
})

mailRoute.get('/status', (c) => c.json({ marked: localReadCount(), accounts: listAccounts().length }))

// 后端进程退出前主动断开所有 IMAP 连接（tsx 被 kill 时也能收尾）
export function shutdownMail() {
  dropAllConnections()
}
