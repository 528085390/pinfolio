// 邮件后端的四层缓存：列表快照 / 分块行 / 正文 / 文件夹。
// 单独成文件是为了让 client.ts 只管 IMAP 操作；「清哪个账号」的逻辑集中在这一处。
import type { FolderInfo, MailMessage, MailRow } from './types.js'

export const LIST_TTL = 60_000
export const BODY_TTL = 10 * 60_000
export const FOLDER_TTL = 5 * 60_000
export const BODY_CACHE_MAX = 40

export type Snapshot = { at: number; uids: number[]; unseen: number }
export type ChunkEntry = { at: number; rows: MailRow[] }
export type BodyEntry = { at: number; message: MailMessage; attachments: Buffer[] }

export const snapCache = new Map<string, Snapshot>()
export const chunkCache = new Map<string, ChunkEntry>()
export const bodyCache = new Map<string, BodyEntry>()
export const folderCache = new Map<string, { at: number; folders: FolderInfo[] }>()

export function snapKey(accountId: number, folder: string) {
  return accountId + ':' + folder
}

export function clearAccountCaches(accountId: number) {
  for (const k of [...snapCache.keys()]) if (k.startsWith(accountId + ':')) snapCache.delete(k)
  for (const k of [...chunkCache.keys()]) if (k.startsWith(accountId + ':')) chunkCache.delete(k)
  for (const k of [...bodyCache.keys()]) if (k.startsWith(accountId + ':')) bodyCache.delete(k)
  folderCache.delete(String(accountId))
}

export function pruneBodyCache() {
  while (bodyCache.size > BODY_CACHE_MAX) {
    const oldest = bodyCache.keys().next().value as string | undefined
    if (oldest === undefined) break
    bodyCache.delete(oldest)
  }
}
