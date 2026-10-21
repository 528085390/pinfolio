// 邮件后端：多账号合并列表、正文按需下载、文件夹与未读数。
// **只读**：取信一律 getMailboxLock(folder, { readOnly: true })（EXAMINE），一行 STORE 都不许有。
// 分工：types.ts 类型 / parse.ts 纯解析 / errors.ts 错误翻译 / pool.ts 连接池 / 本文件业务与缓存。
import { simpleParser } from 'mailparser'
import type { MailAccountRow } from './store.js'
import type { FolderInfo, ListResult, MailMessage, MailRow } from './types.js'
import { addrList, addrOne, snippetFromText, toIso } from './parse.js'
import { friendlyError, proxyOf } from './errors.js'
import { getClient, isEncrypted, makeClient, OP_TIMEOUT, withMailbox, withTimeout } from './pool.js'

const LIST_TTL = 60_000
const BODY_TTL = 10 * 60_000
const FOLDER_TTL = 5 * 60_000
const MAX_MESSAGE_BYTES = 25 * 1024 * 1024
const CHUNK = 50
const BODY_CACHE_MAX = 40

// ---------- 缓存 ----------

type Snapshot = { at: number; uids: number[]; unseen: number }
const snapCache = new Map<string, Snapshot>()
type ChunkEntry = { at: number; rows: MailRow[] }
const chunkCache = new Map<string, ChunkEntry>()
type BodyEntry = { at: number; message: MailMessage; attachments: Buffer[] }
const bodyCache = new Map<string, BodyEntry>()
const folderCache = new Map<string, { at: number; folders: FolderInfo[] }>()

function snapKey(accountId: number, folder: string) {
  return accountId + ':' + folder
}

export function clearAccountCaches(accountId: number) {
  for (const k of [...snapCache.keys()]) if (k.startsWith(accountId + ':')) snapCache.delete(k)
  for (const k of [...chunkCache.keys()]) if (k.startsWith(accountId + ':')) chunkCache.delete(k)
  for (const k of [...bodyCache.keys()]) if (k.startsWith(accountId + ':')) bodyCache.delete(k)
  folderCache.delete(String(accountId))
}

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
  const folders: FolderInfo[] = raw
    .filter((m: any) => ![...(m.flags || [])].some((f: string) => /\\noselect/i.test(f)))
    .map((m: any) => ({ path: m.path, name: m.name || m.path, delimiter: m.delimiter || '/', specialUse: m.specialUse || null }))
  folders.sort((x, y) => {
    if (x.path.toUpperCase() === 'INBOX') return -1
    if (y.path.toUpperCase() === 'INBOX') return 1
    const sx = x.specialUse ? 1 : 0
    const sy = y.specialUse ? 1 : 0
    if (sx !== sy) return sy - sx
    return x.path.localeCompare(y.path, 'zh-CN')
  })
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

function toRow(accountId: number, folder: string, m: any): MailRow {
  const flags: Set<string> = m.flags || new Set()
  const bodyPart = m.bodyParts ? (m.bodyParts.get('text') || m.bodyParts.get('TEXT')) : undefined
  return {
    accountId,
    folder,
    uid: Number(m.uid),
    subject: String(m.envelope?.subject || '').trim() || '(无主题)',
    from: addrOne(m.envelope?.from),
    to: addrList(m.envelope?.to),
    date: toIso(m.internalDate || m.envelope?.date),
    snippet: snippetFromText(bodyPart),
    unread: !flags.has('\\Seen'),
    flagged: flags.has('\\Flagged'),
    size: Number(m.size || 0),
  }
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
  rows.sort((x, y) => {
    const dx = x.date ? Date.parse(x.date) : 0
    const dy = y.date ? Date.parse(y.date) : 0
    return dy - dx || y.uid - x.uid
  })
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

function rowTime(r: MailRow): number {
  return r.date ? Date.parse(r.date) : 0
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
    live.sort((p, q) => rowTime(q.row) - rowTime(p.row) || q.row.uid - p.row.uid || p.row.accountId - q.row.accountId)
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

function pruneBodyCache() {
  while (bodyCache.size > BODY_CACHE_MAX) {
    const oldest = bodyCache.keys().next().value as string | undefined
    if (oldest === undefined) break
    bodyCache.delete(oldest)
  }
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
export { dropAllConnections, dropConnection } from './pool.js'
export { friendlyError, proxyOf } from './errors.js'
export { snippetFromText } from './parse.js'
export type { Addr, FolderInfo, ListResult, MailAttachment, MailMessage, MailRow } from './types.js'
