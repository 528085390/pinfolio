// 邮件后端：多账号合并列表、正文按需下载、文件夹与未读数。
// **只读**：取信一律 getMailboxLock(folder, { readOnly: true })（EXAMINE），一行 STORE 都不许有。
// 分工：types.ts 类型 / parse.ts 纯解析 / rows.ts 行拼装与排序（纯）/ cache.ts 四层缓存 /
//       errors.ts 错误翻译 / pool.ts 连接池 / 本文件 IMAP 操作。
import { simpleParser } from 'mailparser'
import type { MailAccountRow } from './store.js'
import type { FolderInfo, ListResult, MailMessage, MailRow } from './types.js'
import { addrList, addrOne, toIso } from './parse.js'
import { friendlyError, proxyOf } from './errors.js'
import { getClient, isEncrypted, makeClient, OP_TIMEOUT, withMailbox, withTimeout } from './pool.js'
import {
  BODY_TTL, FOLDER_TTL, LIST_TTL,
  bodyCache, chunkCache, folderCache, pruneBodyCache, snapCache, snapKey,
  type BodyEntry, type Snapshot,
} from './cache.js'
import { compareRows, filterSelectable, sortFolders, toRow } from './rows.js'

const MAX_MESSAGE_BYTES = 25 * 1024 * 1024
const CHUNK = 50

// ---------- IMAP 操作 ----------

export async function testConnection(input: {
  host: string; port: number; username: string; password: string; security: string; proxy?: string
}): Promise<{ server: string; folders: number; encrypted: boolean }> {
  const client = makeClient(input as any)
  try {
    await withTimeout(client.connect(), OP_TIMEOUT, '连接 IMAP 服务器')
    if (input.security === 'starttls' && !isEncrypted(client)) {
      throw new Error('服务器不支持 STARTTLS，请改用 SSL/TLS（993 端口）')
    }
    const list = await withTimeout(client.list(), OP_TIMEOUT, '获取文件夹列表')
    return { server: String((client as any).serverInfo?.name || ''), folders: list.length, encrypted: isEncrypted(client) }
  } catch (err) {
    throw new Error(friendlyError(err, proxyOf(input)))
  } finally {
    try { await withTimeout(client.logout(), 3000, '断开') } catch { try { client.close() } catch { /* ignore */ } }
  }
}

export async function listFolders(a: MailAccountRow, fresh = false): Promise<FolderInfo[]> {
  const key = String(a.id)
  const hit = folderCache.get(key)
  if (!fresh && hit && Date.now() - hit.at < FOLDER_TTL) return hit.folders
  const client = await getClient(a)
  const raw = await withTimeout(client.list(), OP_TIMEOUT, '获取文件夹列表')
  const folders = sortFolders(filterSelectable(raw))
  folderCache.set(key, { at: Date.now(), folders })
  return folders
}

async function getSnapshot(a: MailAccountRow, folder: string, fresh: boolean): Promise<Snapshot> {
  const key = snapKey(a.id, folder)
  const hit = snapCache.get(key)
  if (!fresh && hit && Date.now() - hit.at < LIST_TTL) return hit
  const data = await withMailbox(a, folder, async (client) => {
    const allUids = (await client.search({ all: true }, { uid: true })) || []
    const unseenUids = (await client.search({ seen: false }, { uid: true })) || []
    const uids = (Array.isArray(allUids) ? allUids : []).slice().sort((x: number, y: number) => y - x)
    return { uids, unseen: Array.isArray(unseenUids) ? unseenUids.length : 0 }
  })
  const snap: Snapshot = { at: Date.now(), uids: data.uids, unseen: data.unseen }
  snapCache.set(key, snap)
  return snap
}

async function getChunk(a: MailAccountRow, folder: string, from: number, uids: number[], fresh: boolean): Promise<MailRow[]> {
  const key = a.id + ':' + folder + ':' + from + ':' + uids.length
  const hit = chunkCache.get(key)
  if (!fresh && hit && Date.now() - hit.at < LIST_TTL) return hit.rows
  if (!uids.length) return []
  const rows = await withMailbox(a, folder, async (client) => {
    const out: MailRow[] = []
    for await (const m of client.fetch(uids, {
      uid: true, envelope: true, flags: true, internalDate: true, size: true,
      bodyParts: [{ key: 'TEXT', maxLength: 800 }],
    } as any, { uid: true })) {
      out.push(toRow(a.id, folder, m))
    }
    return out
  })
  rows.sort(compareRows)
  chunkCache.set(key, { at: Date.now(), rows })
  return rows
}

async function* accountRows(a: MailAccountRow, folder: string, snap: Snapshot, fresh: boolean): AsyncGenerator<MailRow> {
  for (let i = 0; i < snap.uids.length; i += CHUNK) {
    const slice = snap.uids.slice(i, i + CHUNK)
    const rows = await getChunk(a, folder, i, slice, fresh)
    for (const r of rows) yield r
  }
}

export async function listMessages(opts: {
  accounts: MailAccountRow[]
  folder: string
  offset: number
  limit: number
  fresh: boolean
}): Promise<ListResult> {
  const { accounts, folder, offset, limit, fresh } = opts
  const errors: ListResult['errors'] = []
  const sources: { a: MailAccountRow; snap: Snapshot }[] = []
  let total = 0
  let unseen = 0

  for (const a of accounts) {
    try {
      const snap = await getSnapshot(a, folder, fresh)
      sources.push({ a, snap })
      total += snap.uids.length
      unseen += snap.unseen
    } catch (err) {
      errors.push({ accountId: a.id, label: a.label || a.email || a.username, error: friendlyError(err, proxyOf(a)) })
    }
  }

  const iters = sources.map((s) => accountRows(s.a, folder, s.snap, fresh))
  const heads = await Promise.all(iters.map((it) => it.next().catch((err) => {
    errors.push({ accountId: 0, label: '', error: friendlyError(err) })
    return { done: true as const, value: undefined as any }
  })))

  const items: MailRow[] = []
  let skipped = 0
  while (items.length < limit) {
    const live: { i: number; row: MailRow }[] = []
    heads.forEach((h, i) => { if (!h.done && h.value) live.push({ i, row: h.value }) })
    if (!live.length) break
    live.sort((p, q) => compareRows(p.row, q.row))
    const pick = live[0]
    if (skipped < offset) skipped++
    else items.push(pick.row)
    heads[pick.i] = await iters[pick.i].next()
  }

  let hasMore = false
  for (const h of heads) if (!h.done && h.value) hasMore = true

  const fetchedAt = sources.length ? Math.min(...sources.map((s) => s.snap.at)) : 0
  return { items, total, unseen, hasMore, errors: errors.filter((e) => e.accountId !== 0), partial: errors.length > 0, fetchedAt }
}

export async function unseenCounts(accounts: MailAccountRow[], folder: string, fresh = false): Promise<{
  counts: Record<number, { unseen: number; total: number }>
  errors: { accountId: number; label: string; error: string }[]
}> {
  const counts: Record<number, { unseen: number; total: number }> = {}
  const errors: { accountId: number; label: string; error: string }[] = []
  await Promise.all(accounts.map(async (a) => {
    try {
      const snap = await getSnapshot(a, folder, fresh)
      counts[a.id] = { unseen: snap.unseen, total: snap.uids.length }
    } catch (err) {
      errors.push({ accountId: a.id, label: a.label || a.email || a.username, error: friendlyError(err, proxyOf(a)) })
    }
  }))
  return { counts, errors }
}

export async function getMessage(a: MailAccountRow, folder: string, uid: number): Promise<BodyEntry> {
  const key = a.id + ':' + folder + ':' + uid
  const hit = bodyCache.get(key)
  if (hit && Date.now() - hit.at < BODY_TTL) {
    bodyCache.delete(key)
    bodyCache.set(key, hit)
    return hit
  }
  const entry = await withMailbox(a, folder, async (client) => {
    const m: any = await client.fetchOne(String(uid), { uid: true, source: true } as any, { uid: true })
    if (!m || !m.source) throw new Error('邮件不存在，可能已被删除或移动')
    if (m.source.length > MAX_MESSAGE_BYTES) throw new Error('邮件超过 25 MB，本页面不下载这么大的邮件')
    const parsed = await simpleParser(m.source)
    const attachments: Buffer[] = parsed.attachments.map((att: any) => Buffer.from(att.content || Buffer.alloc(0)))
    const message: MailMessage = {
      accountId: a.id,
      folder,
      uid,
      subject: String(parsed.subject || '').trim() || '(无主题)',
      from: addrOne(parsed.from),
      to: addrList(parsed.to),
      cc: addrList(parsed.cc),
      date: toIso(parsed.date),
      messageId: parsed.messageId || null,
      text: String(parsed.text || ''),
      html: typeof parsed.html === 'string' && parsed.html.trim() ? parsed.html : null,
      attachments: parsed.attachments.map((att: any, i: number) => ({
        index: i,
        filename: String(att.filename || '附件' + (i + 1)),
        size: Number(att.size || 0),
        contentType: String(att.contentType || 'application/octet-stream'),
        cid: att.cid ? String(att.cid).replace(/^<|>$/g, '') : null,
      })),
    }
    return { at: Date.now(), message, attachments }
  })
  bodyCache.set(key, entry)
  pruneBodyCache()
  return entry
}

// ---- 再导出：让 routes.ts / 测试继续从 client.js 取，调用点不用改 ----
export { clearAccountCaches } from './cache.js'
export { dropAllConnections, dropConnection } from './pool.js'
export { friendlyError, proxyOf } from './errors.js'
export { snippetFromText } from './parse.js'
export type { Addr, FolderInfo, ListResult, MailAttachment, MailMessage, MailRow } from './types.js'
