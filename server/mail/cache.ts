// 邮件的内存缓存（2026-11-12 起列表改走本地库，这里只剩正文与文件夹两样）。
// 正文命中内存就不回源；没命中再读库；库里也没有才打 IMAP（见 client.ts 的 getMessage）。
import type { FolderInfo, MailMessage } from './types.js'

export const BODY_TTL = 10 * 60_000
export const FOLDER_TTL = 5 * 60_000
export const BODY_CACHE_MAX = 40

export type BodyEntry = {
  at: number
  message: MailMessage
  /** 附件字节只在内存里；空数组 = 这条是从库里拼出来的，没有字节（下载时再回源） */
  attachments: Buffer[]
}

export const bodyCache = new Map<string, BodyEntry>()
export const folderCache = new Map<string, { at: number; folders: FolderInfo[] }>()

export function bodyKey(accountId: number, folder: string, uid: number): string {
  return accountId + ':' + folder + ':' + uid
}

/** 账号删改后清掉它的缓存（改密码/换服务器后旧正文不该还留着） */
export function clearAccountCaches(accountId: number) {
  const prefix = accountId + ':'
  for (const k of [...bodyCache.keys()]) if (k.startsWith(prefix)) bodyCache.delete(k)
  folderCache.delete(String(accountId))
}

export function pruneBodyCache() {
  while (bodyCache.size > BODY_CACHE_MAX) {
    const oldest = bodyCache.keys().next().value as string | undefined
    if (oldest === undefined) break
    bodyCache.delete(oldest)
  }
}