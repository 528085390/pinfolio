import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import type { MailAccountRow } from './store.js'

export type Addr = { name: string; address: string }

export type MailRow = {
  accountId: number
  folder: string
  uid: number
  subject: string
  from: Addr | null
  to: Addr[]
  date: string | null
  snippet: string
  unread: boolean
  flagged: boolean
  size: number
  localRead?: boolean
}

export type MailAttachment = {
  index: number
  filename: string
  size: number
  contentType: string
  cid: string | null
}

export type MailMessage = {
  accountId: number
  folder: string
  uid: number
  subject: string
  from: Addr | null
  to: Addr[]
  cc: Addr[]
  date: string | null
  messageId: string | null
  text: string
  html: string | null
  attachments: MailAttachment[]
}

export type FolderInfo = {
  path: string
  name: string
  delimiter: string
  specialUse: string | null
}

const LIST_TTL = 60_000
const BODY_TTL = 10 * 60_000
const FOLDER_TTL = 5 * 60_000
const OP_TIMEOUT = 20_000
const MAX_MESSAGE_BYTES = 25 * 1024 * 1024
const CHUNK = 50
const BODY_CACHE_MAX = 40

// ---------- 工具 ----------

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label + '超时（' + Math.round(ms / 1000) + ' 秒）')), ms)
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

const AUTH_RE = /auth|credentials|LOGIN failed|AUTHENTICATIONFAILED|invalid user|password/i

/** 把 imapflow / 网络错误翻译成人能看懂的一句话 */
export function friendlyError(err: unknown): string {
  const e = err as any
  const code = String(e?.code || '')
  const msg = String(e?.responseText || e?.message || e || '').trim()
  const lower = msg.toLowerCase()
  if (code === 'CONNECT_TIMEOUT' || /timeout|timed out|超时/.test(lower)) {
    return '连接超时：请检查服务器地址、端口和网络（国内访问 Gmail 的 993 端口通常正常）'
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '服务器地址解析失败，请检查 IMAP 服务器地址是否写错'
  if (code === 'ECONNREFUSED') return '端口拒绝连接：请确认端口号与加密方式（SSL/TLS 一般为 993，STARTTLS 一般为 143）'
  if (code === 'ECONNRESET' || code === 'EPIPE') return '连接被服务器中断，请稍后重试'
  if (code === 'EAUTH' || AUTH_RE.test(msg) && !/certificate/i.test(msg)) {
    return '登录被拒绝：用户名或密码不对。Gmail 需用「应用专用密码」，QQ/163 需用「授权码」而不是登录密码'
  }
  if (/certificate|self signed|CERT_/i.test(msg)) return 'TLS 证书校验失败：' + msg
  if (/STARTTLS/i.test(msg)) return '服务器不支持 STARTTLS，请改用 SSL/TLS（993 端口）'
  if (/UNAVAILABLE|temporarily/i.test(msg)) return '服务器暂时不可用，请稍后重试'
  return msg || '未知错误'
}

function isEncrypted(client: ImapFlow): boolean {
  const socket = (client as any).socket
  return !!(socket && socket.encrypted)
}

function addrList(input: any): Addr[] {
  // mailparser 返回 AddressObject { value: [...] }，imapflow 的 envelope 返回数组
  const list = Array.isArray(input) ? input : Array.isArray(input?.value) ? input.value : input ? [input] : []
  return list
    .map((a: any) => ({ name: String(a?.name || ''), address: String(a?.address || '') }))
    .filter((a: Addr) => a.address || a.name)
}

function addrOne(input: any): Addr | null {
  const list = addrList(input)
  return list[0] || null
}

function toIso(d: any): string | null {
  if (!d) return null
  const date = d instanceof Date ? d : new Date(d)
  return isNaN(date.getTime()) ? null : date.toISOString()
}

// ---------- 摘要提取（列表页只抓 BODY[TEXT] 前 800 字节，不下载整封信）----------

function decodeQuotedPrintable(s: string): string {
  const txt = s.replace(/=\r?\n/g, '')
  const bytes: number[] = []
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i]
    if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(txt.slice(i + 1, i + 3))) {
      bytes.push(parseInt(txt.slice(i + 1, i + 3), 16))
      i += 2
    } else {
      bytes.push(txt.charCodeAt(i) & 0xff)
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&mdash;': '—', '&hellip;': '…',
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&[a-zA-Z]+;/g, (m) => ENTITIES[m.toLowerCase()] ?? ' ')
    .replace(/[ \t\u00a0]+/g, ' ')
}

type RawPart = { headers: string; body: string }

function splitParts(text: string): RawPart[] {
  const out: RawPart[] = []
  const chunks = text.split(/^--[^\r\n]+/m)
  if (chunks.length <= 1) return []
  for (const chunk of chunks.slice(1)) {
    if (/^--\s*$/.test(chunk.split(/\r?\n/)[0] || '')) continue
    const idx = chunk.search(/\r?\n\r?\n/)
    if (idx < 0) continue
    const headers = chunk.slice(0, idx)
    let body = chunk.slice(idx).replace(/^\r?\n\r?\n/, '')
    if (/content-type:\s*multipart/i.test(headers)) continue
    out.push({ headers, body })
  }
  return out
}

function decodePart(part: RawPart): string {
  let body = part.body
  const cte = /content-transfer-encoding:\s*([\w-]+)/i.exec(part.headers)?.[1]?.toLowerCase() || ''
  const charset = /charset="?([\w-]+)/i.exec(part.headers)?.[1] || 'utf-8'
  if (cte === 'base64') {
    body = Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64').toString('utf8')
  } else if (cte === 'quoted-printable') {
    body = decodeQuotedPrintable(body)
  }
  if (charset && !/^utf-?8$/i.test(charset)) {
    // 非 UTF-8 的邮件不多，能解就解，解不了保留原文
    try {
      const bytes = Buffer.from(body, 'latin1')
      body = new TextDecoder(charset as string).decode(bytes)
    } catch { /* keep as is */ }
  }
  return body
}

export function snippetFromText(raw: Buffer | undefined): string {
  if (!raw || !raw.length) return ''
  const text = raw.toString('utf8')
  const parts = splitParts(text)
  let body = ''
  if (parts.length) {
    const plain = parts.find((p) => /content-type:\s*text\/plain/i.test(p.headers))
    const html = parts.find((p) => /content-type:\s*text\/html/i.test(p.headers))
    body = plain ? decodePart(plain) : html ? htmlToText(decodePart(html)) : ''
    if (!body.trim()) body = parts.map((p) => decodePart(p)).join(' ')
  } else {
    body = text
  }
  if (/<html|<body|<div|<p[\s>]|<br/i.test(body)) body = htmlToText(body)
  return body.replace(/\s+/g, ' ').trim().slice(0, 240)
}

// ---------- 连接池 ----------

type PoolEntry = { client: ImapFlow; sig: string }
const pool = new Map<number, PoolEntry>()

function sigOf(a: MailAccountRow): string {
  return [a.host, a.port, a.username, a.password, a.security].join('\u0000')
}

function makeClient(a: Pick<MailAccountRow, 'host' | 'port' | 'username' | 'password' | 'security'>): ImapFlow {
  return new ImapFlow({
    host: a.host,
    port: Number(a.port) || 993,
    secure: a.security === 'ssl',
    auth: { user: a.username, pass: a.password },
    clientInfo: { name: 'pinboard', version: '0.1.0', vendor: 'pinboard' },
    disableAutoIdle: true,
    connectionTimeout: OP_TIMEOUT,
    greetingTimeout: 15_000,
    socketTimeout: 120_000,
    logger: false,
  } as any)
}

export function dropConnection(accountId: number) {
  const entry = pool.get(accountId)
  if (!entry) return
  pool.delete(accountId)
  try { entry.client.close() } catch { /* ignore */ }
}

export function dropAllConnections() {
  for (const id of [...pool.keys()]) dropConnection(id)
}

async function getClient(a: MailAccountRow): Promise<ImapFlow> {
  const sig = sigOf(a)
  const entry = pool.get(a.id)
  if (entry && (entry.sig !== sig || !entry.client.usable)) dropConnection(a.id)
  const alive = pool.get(a.id)
  if (alive) return alive.client
  const client = makeClient(a)
  client.on('error', (err: any) => {
    console.warn('[mail] 连接错误 account=' + a.id + ' ' + (err?.message || err))
    const cur = pool.get(a.id)
    if (cur && cur.client === client) pool.delete(a.id)
  })
  client.on('close', () => {
    const cur = pool.get(a.id)
    if (cur && cur.client === client) pool.delete(a.id)
  })
  await withTimeout(client.connect(), OP_TIMEOUT, '连接 IMAP 服务器')
  if (a.security === 'starttls' && !isEncrypted(client)) {
    try { client.close() } catch { /* ignore */ }
    throw new Error('服务器不支持 STARTTLS，已中止连接（避免用明文发送密码），请改用 SSL/TLS')
  }
  pool.set(a.id, { client, sig })
  return client
}

async function withMailbox<T>(a: MailAccountRow, folder: string, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = await getClient(a)
  const lock = await withTimeout(client.getMailboxLock(folder, { readOnly: true } as any), OP_TIMEOUT, '打开文件夹 ' + folder)
  try {
    return await withTimeout(fn(client), OP_TIMEOUT, '读取邮件')
  } finally {
    try { lock.release() } catch { /* ignore */ }
  }
}

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
  host: string; port: number; username: string; password: string; security: string
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
    throw new Error(friendlyError(err))
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

export type ListResult = {
  items: MailRow[]
  total: number
  unseen: number
  hasMore: boolean
  errors: { accountId: number; label: string; error: string }[]
  partial: boolean
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
      errors.push({ accountId: a.id, label: a.label || a.email || a.username, error: friendlyError(err) })
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

  return { items, total, unseen, hasMore, errors: errors.filter((e) => e.accountId !== 0), partial: errors.length > 0 }
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
      errors.push({ accountId: a.id, label: a.label || a.email || a.username, error: friendlyError(err) })
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
