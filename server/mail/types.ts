// 邮件数据模型：列表行、正文、附件、文件夹、列表结果。
// 单独成文件，client.ts 与 routes.ts 都只依赖类型，不互相拖进实现。

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

export type ListResult = {
  items: MailRow[]
  total: number
  unseen: number
  hasMore: boolean
  errors: { accountId: number; label: string; error: string }[]
  partial: boolean
  /** 这批数据真正从 IMAP 取回的时刻（命中缓存时是缓存的取回时间），0 = 没取到 */
  fetchedAt: number
}
