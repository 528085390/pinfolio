// 邮件后端（2026-11-12 v2）：本文件只做 IMAP 操作。
// 分工：repo.ts 本地库 / sync.ts 增量同步与调度 / rows.ts、parse.ts 纯解析 / errors.ts 错误翻译。
// **只读**：取信一律 getMailboxLock(folder, { readOnly: true })（EXAMINE），一行 STORE 都不许有。
import { simpleParser } from 'mailparser'
import type { ImapFlow } from 'imapflow'
import type { MailAccountRow } from './store.js'
import type { FolderInfo, MailMessage, MailRow } from './types.js'
import { addrList, addrOne, toIso } from './parse.js'
import { friendlyError, proxyOf } from './errors.js'
import { getClient, isEncrypted, makeClient, OP_TIMEOUT, withMailbox, withTimeout } from './pool.js'
import { BODY_TTL, bodyCache, bodyKey, FOLDER_TTL, folderCache, pruneBodyCache, type BodyEntry } from './cache.js'
import { filterSelectable, sortFolders, toRow } from './rows.js'
import * as repo from './repo.js'
import { t } from '../i18n.js'

const MAX_MESSAGE_BYTES = 25 * 1024 * 1024
/** 一次 fetch 抓多少封的列表元数据（QQ 2600 封按 100 一批，既快又不会把单条命令拖过 socketTimeout） */
export const FETCH_CHUNK = 100

// ---------- 连接自检 ----------

export async function testConnection(input: {
  host: string; port: number; username: string; password: string; security: string; proxy?: string
}): Promise<{ server: string; folders: number; encrypted: boolean }> {
  const client = makeClient(input as any)
  try {
    await withTimeout(client.connect(), OP_TIMEOUT, t('连接 IMAP 服务器'))
    if (input.security === 'starttls' && !isEncrypted(client)) {
      throw new Error(t('服务器不支持 STARTTLS，请改用 SSL/TLS（993 端口）'))
    }
    const list = await withTimeout(client.list(), OP_TIMEOUT, t('获取文件夹列表'))
    return { server: String((client as any).serverInfo?.name || ''), folders: list.length, encrypted: isEncrypted(client) }
  } catch (err) {
    throw new Error(friendlyError(err, proxyOf(input)))
  } finally {
    try { await withTimeout(client.logout(), 3000, t('断开')) } catch { try { client.close() } catch { /* ignore */ } }
  }
}

export async function listFolders(a: MailAccountRow, fresh = false): Promise<FolderInfo[]> {
  const key = String(a.id)
  const hit = folderCache.get(key)
  if (!fresh && hit && Date.now() - hit.at < FOLDER_TTL) return hit.folders
  const client = await getClient(a)
  const raw = await withTimeout(client.list(), OP_TIMEOUT, t('获取文件夹列表'))
  const folders = sortFolders(filterSelectable(raw))
  folderCache.set(key, { at: Date.now(), folders })
  return folders
}

// ---------- 同步要用的三个原语 ----------

/** 打开文件夹后服务器给的快照：uidValidity / uidNext / 总封数 */
export function folderSnapshot(client: ImapFlow): { uidValidity: string; uidNext: number; exists: number } {
  const mb: any = (client as any).mailbox || {}
  return {
    uidValidity: mb.uidValidity === undefined || mb.uidValidity === null ? '' : String(mb.uidValidity),
    uidNext: Number(mb.uidNext || 0),
    exists: Number(mb.exists || 0),
  }
}

/** 两组 UID（全部 / 未读）。SEARCH 很便宜：2600 封实测 ~85 ms，所以每次同步都全量重算，
 *  靠它做「新增 / 已删 / 未读变化」三路增量比对，不必为了标志位再逐个 FETCH。 */
export async function searchUids(client: ImapFlow): Promise<{ all: number[]; unseen: number[] }> {
  const all = (await client.search({ all: true }, { uid: true })) || []
  const unseen = (await client.search({ seen: false }, { uid: true })) || []
  return {
    all: Array.isArray(all) ? all.map(Number) : [],
    unseen: Array.isArray(unseen) ? unseen.map(Number) : [],
  }
}

/** 批量抓列表元数据（envelope + flags + 正文前 800 字节做摘要）。调用方负责开只读锁。 */
export async function fetchEnvelopes(client: ImapFlow, accountId: number, folder: string, uids: number[]): Promise<MailRow[]> {
  if (!uids.length) return []
  const out: MailRow[] = []
  for await (const m of client.fetch(uids, {
    uid: true, envelope: true, flags: true, internalDate: true, size: true,
    bodyParts: [{ key: 'TEXT', maxLength: 800 }],
  } as any, { uid: true })) {
    out.push(toRow(accountId, folder, m))
  }
  return out
}

// ---------- 正文 ----------

/** 从 IMAP 拉整封并解析（附件字节也一起给）。不改服务器上的任何状态。 */
export async function fetchBodyFromImap(a: MailAccountRow, folder: string, uid: number): Promise<BodyEntry> {
  return withMailbox(a, folder, async (client) => {
    const m: any = await client.fetchOne(String(uid), { uid: true, source: true } as any, { uid: true })
    if (!m || !m.source) throw new Error(t('邮件不存在，可能已被删除或移动'))
    if (m.source.length > MAX_MESSAGE_BYTES) throw new Error(t('邮件超过 25 MB，本页面不下载这么大的邮件'))
    const parsed = await simpleParser(m.source)
    const attachments: Buffer[] = parsed.attachments.map((att: any) => Buffer.from(att.content || Buffer.alloc(0)))
    const message: MailMessage = {
      accountId: a.id,
      folder,
      uid,
      subject: String(parsed.subject || '').trim() || t('(无主题)'),
      from: addrOne(parsed.from),
      to: addrList(parsed.to),
      cc: addrList(parsed.cc),
      date: toIso(parsed.date),
      messageId: parsed.messageId || null,
      text: String(parsed.text || ''),
      html: typeof parsed.html === 'string' && parsed.html.trim() ? parsed.html : null,
      attachments: parsed.attachments.map((att: any, i: number) => ({
        index: i,
        filename: String(att.filename || t('附件 {n}', { n: i + 1 })),
        size: Number(att.size || 0),
        contentType: String(att.contentType || 'application/octet-stream'),
        cid: att.cid ? String(att.cid).replace(/^<|>$/g, '') : null,
      })),
    }
    return { at: Date.now(), message, attachments }
  })
}

/**
 * 单封正文：内存 → 本地库 → IMAP 逐级回源，拉到就写库。
 * needAttachments 为真（点附件下载）时不吃库里那份——库里没有附件字节，必须回源。
 * fresh 为真（强制重取）时跳过两级缓存。
 */
export async function getMessage(
  a: MailAccountRow,
  folder: string,
  uid: number,
  opts: { fresh?: boolean; needAttachments?: boolean } = {},
): Promise<BodyEntry> {
  const key = bodyKey(a.id, folder, uid)
  const hit = bodyCache.get(key)
  const hasAllBytes = !!hit && hit.attachments.length >= hit.message.attachments.length
  if (hit && !opts.fresh && Date.now() - hit.at < BODY_TTL && (!opts.needAttachments || hasAllBytes)) {
    bodyCache.delete(key)
    bodyCache.set(key, hit)
    return hit
  }
  if (!opts.fresh && !opts.needAttachments) {
    const stored = repo.getBody(a.id, folder, uid)
    if (stored) {
      const entry: BodyEntry = { at: Date.now(), message: stored, attachments: [] }
      bodyCache.set(key, entry)
      pruneBodyCache()
      return entry
    }
  }
  const entry = await fetchBodyFromImap(a, folder, uid)
  try {
    repo.putBody(entry.message)
  } catch (err) {
    // 落库失败不该让用户看不到正文；下次打开再试
    console.warn('[mail] 正文落库失败 account=' + a.id + ' uid=' + uid + ' ' + String(err))
  }
  bodyCache.set(key, entry)
  pruneBodyCache()
  return entry
}

// ---- 再导出：让 routes.ts / 测试继续从 client.js 取，调用点不用改 ----
export { clearAccountCaches } from './cache.js'
export { dropAllConnections, dropConnection, withMailbox, getClient, OP_TIMEOUT, withTimeout } from './pool.js'
export { friendlyError, proxyOf } from './errors.js'
export { snippetFromText } from './parse.js'
export type { Addr, FolderInfo, MailAttachment, MailMessage, MailRow } from './types.js'