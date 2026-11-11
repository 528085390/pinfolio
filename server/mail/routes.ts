import { Hono } from 'hono'
import {
  clearLocalRead, createAccount, deleteAccount, getAccount, listAccounts, localReadCount,
  localReadKeys, markLocalRead, normalizeAccountInput, publicAccount, unmarkLocalRead, updateAccount,
} from './store.js'
import type { MailAccountRow } from './store.js'
import {
  clearAccountCaches, dropAllConnections, dropConnection, getMessage, listFolders,
  testConnection, friendlyError, proxyOf,
} from './client.js'
import {
  DEFAULT_FOLDER, attachmentHeaders, decorateItems, fillTestInput, mergeAccountCounts,
  missingTestField, parseAttachmentQuery, parseClearQuery, parseListQuery, parseMarkBody, pickTargets,
  posInt, testInputFrom,
} from './params.js'
import { anySyncing, isSyncing, syncFolder, syncInBackground } from './sync.js'
import * as repo from './repo.js'
import { t } from '../i18n.js'

// 邮件页的 HTTP 面（2026-11-12 v2）：列表与未读数一律读本地库，进页面不再打 IMAP；
// 需要最新数据时由前端带 fresh=1，服务端当场等一次增量同步（有预算，超时就把后台剩下的交给下一轮）。
// 参数解析与纯拼装在 params.ts（有单测），这里只做取账号、调 sync/repo、拼响应。
export const mailRoute = new Hono()

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms)
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

/**
 * 当场同步一次；同步比预算还慢就先返回库里的，剩下的在后台继续。
 * 已经在同步的账号直接跳过：后台首轮全量可能跑好几分钟，页面没理由在这儿干等它。
 */
async function pullFresh(target: MailAccountRow[], folder: string, budgetMs?: number): Promise<void> {
  const budget = Math.max(200, budgetMs ?? Math.max(1000, Number(process.env.MAIL_SYNC_REQUEST_MS || 8000)))
  const maxNew = Math.max(1, Number(process.env.MAIL_SYNC_INTERACTIVE_MAX_NEW || 500))
  await Promise.all(target.filter((a) => !isSyncing(a.id, folder)).map(async (a) => {
    try {
      await withDeadline(syncFolder(a, folder, { maxNew }), budget)
    } catch {
      // 同步失败不该让整页报错：错误已经写进 mail_sync_state，前端会显示在对应账号上
    }
  }))
}

/** 某批账号在某个文件夹上的同步状态：错误、进度、最后一次成功时间 */
function syncInfo(ids: number[], folder: string) {
  const states = repo.listStates().filter((s) => s.folder === folder && ids.includes(Number(s.account_id)))
  const errors = states
    .filter((s) => s.status === 'error')
    .map((s) => {
      const acc = listAccounts().find((a) => a.id === Number(s.account_id))
      return { accountId: Number(s.account_id), label: acc?.label || acc?.email || acc?.username || '', error: s.error }
    })
  const done = states.reduce((n, s) => n + (Number(s.done) || 0), 0)
  const total = states.reduce((n, s) => n + (Number(s.total) || 0), 0)
  const times = states.map((s) => (s.last_sync_at ? Date.parse(s.last_sync_at) : 0)).filter((n) => Number.isFinite(n) && n > 0)
  return {
    errors,
    progress: total > 0 ? { done, total } : null,
    lastSyncAt: times.length ? Math.max(...times) : 0,
  }
}

mailRoute.get('/accounts', (c) => {
  const accounts = listAccounts()
  const folder = c.req.query('folder') || DEFAULT_FOLDER
  const enabledIds = accounts.filter((a) => a.enabled === 1).map((a) => a.id)
  const counts = c.req.query('counts') === '1' ? repo.folderCounts(enabledIds, folder) : {}
  const { errors } = syncInfo(enabledIds, folder)
  return c.json({ accounts: mergeAccountCounts(accounts.map((a) => publicAccount(a)), counts, errors) })
})

mailRoute.post('/accounts', async (c) => {
  const body: any = await c.req.json().catch(() => ({}))
  const parsed = normalizeAccountInput(body)
  if ('error' in parsed) return c.json({ error: parsed.error }, 400)
  if (!parsed.value.password) return c.json({ error: t('请填写密码 / 授权码') }, 400)
  const row = createAccount(parsed.value)
  // 新账号立刻在后台同步收件箱：用户点进邮件页时库里已经有信，而不是干等一次全量拉取
  syncInBackground(row, DEFAULT_FOLDER)
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
  // 改完（可能换了服务器/密码/代理）重新同步一次，旧行会在 uidValidity 变化时整段重建
  syncInBackground(row!, DEFAULT_FOLDER)
  return c.json(publicAccount(row!))
})

mailRoute.delete('/accounts/:id', (c) => {
  const id = Number(c.req.param('id'))
  const ok = deleteAccount(id)
  dropConnection(id)
  clearAccountCaches(id)
  repo.purgeAccount(id)
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
    return c.json({
      items: [], total: 0, unseen: 0, hasMore: false, errors: [], partial: false,
      fetchedAt: 0, syncing: false, progress: null, noAccounts: true,
    })
  }
  const target = pickTargets(accounts, which)
  if (!target.length) return c.json({ error: t('账号不存在或已停用') }, 404)

  // 从没同步过的文件夹（比如刚切到「已发送」）：起同步，但只等一小会儿（默认 1.5 秒）就先返回；
  // 小文件夹一轮就够，大邮箱首轮继续在后台跑，前端边翻边看（响应带 syncing/progress）。
  // 同步过之后就是纯读库，切来切去都不再打 IMAP。
  const needSync = target.filter((a) => !repo.getState(a.id, folder))
  if (fresh) await pullFresh(target, folder)
  else if (needSync.length) await pullFresh(needSync, folder, Number(process.env.MAIL_SYNC_FIRST_GRACE_MS || 1500))

  const ids = target.map((a) => a.id)
  const { items, total } = repo.pageRows(ids, folder, offset, limit)
  const marks = localReadKeys(ids, folder)
  const counts = repo.folderCounts(ids, folder)
  const info = syncInfo(ids, folder)
  const unseen = Object.values(counts).reduce((n, v) => n + v.unseen, 0)
  return c.json({
    items: decorateItems(items, target, marks),
    total,
    unseen,
    hasMore: offset + items.length < total,
    errors: info.errors,
    partial: info.errors.length > 0,
    fetchedAt: info.lastSyncAt,
    syncing: target.some((a) => isSyncing(a.id, folder)) || anySyncing(),
    progress: info.progress,
  })
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
    // 库里只存附件清单、不存字节：要下载就得回源那封信，所以这里强制带字节取
    const entry = await getMessage(acc, q.folder, q.uid, { needAttachments: true })
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

// 状态接口：本地已读条数、账号数、每个账号-文件夹的同步进度与错误（设置页/排障用）
mailRoute.get('/status', (c) => c.json({
  marked: localReadCount(),
  accounts: listAccounts().length,
  syncing: anySyncing(),
  states: repo.listStates(),
}))

// 后端起停用：退出前主动断开所有 IMAP 连接（tsx 被 kill 时也能收尾）
export function shutdownMail() {
  dropAllConnections()
}