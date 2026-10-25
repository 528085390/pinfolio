import { API_BASE, request } from './http'

export type MailSecurity = 'ssl' | 'starttls' | 'none'
export type MailAccount = {
  id: number; label: string; email: string; host: string; port: number; username: string
  security: MailSecurity; enabled: number; sort: number
  /** 可选代理，如 socks5://127.0.0.1:10808；空 = 直连 */
  proxy: string
  created_at: string; updated_at: string; hasPassword: boolean
  /** 库里的密码解不开（主密钥换过）：要提示重新填写，别当成「没设密码」 */
  passwordError?: boolean
  /** 只读：服务端未读数 / 总数 / 该账号这次的错误（取不到就是 null） */
  unseen?: number | null; total?: number | null; error?: string | null
}
export type MailAddr = { name: string; address: string }
export type MailRow = {
  accountId: number; accountLabel: string; accountEmail: string
  folder: string; uid: number; subject: string
  from: MailAddr | null; to: MailAddr[]; date: string; snippet: string
  unread: boolean; flagged: boolean; size: number
  /** 本机标记为已读（只写本地库，不回写服务器） */
  localRead: boolean
}
export type MailAccountError = { accountId: number; label: string; error: string }
export type MailListResult = {
  items: MailRow[]; total: number; unseen: number; hasMore: boolean
  errors: MailAccountError[]; partial: boolean
  /** 这批数据从 IMAP 取回的时刻（命中缓存时是缓存时间），前端显示「数据截至」 */
  fetchedAt?: number
  /** 一个账号都没配时后端会给 true，前端据此显示引导 */
  noAccounts?: boolean
}
export type MailAttachment = { index: number; filename: string; size: number; contentType: string; cid: string | null }
export type MailMessage = {
  accountId: number; accountLabel: string; accountEmail: string
  folder: string; uid: number; subject: string
  from: MailAddr | null; to: MailAddr[]; cc: MailAddr[]
  date: string; text: string; html: string | null
  attachments: MailAttachment[]
}
export type MailFolder = { path: string; name: string; delimiter: string; specialUse: string | null }
export type MailTestResult = { ok: true; server: string; folders: number; encrypted: boolean }

export const mailApi = {
  accounts: (opts: { counts?: boolean; folder?: string; fresh?: boolean } = {}) => {
    const s = new URLSearchParams()
    if (opts.counts) s.set('counts', '1')
    if (opts.folder) s.set('folder', opts.folder)
    if (opts.fresh) s.set('fresh', '1')
    return request<{ accounts: MailAccount[] }>('/mail/accounts?' + s.toString())
  },
  create: (b: Partial<MailAccount> & { password?: string }) =>
    request<MailAccount>('/mail/accounts', { method: 'POST', body: JSON.stringify(b) }),
  update: (id: number, b: Partial<MailAccount> & { password?: string }) =>
    request<MailAccount>('/mail/accounts/' + id, { method: 'PUT', body: JSON.stringify(b) }),
  remove: (id: number) => request<{ ok: boolean }>('/mail/accounts/' + id, { method: 'DELETE' }),
  test: (b: { id?: number; host?: string; port?: number; username?: string; password?: string; security?: MailSecurity; proxy?: string }) =>
    request<MailTestResult>('/mail/accounts/test', { method: 'POST', body: JSON.stringify(b) }),
  folders: (account: number, fresh?: boolean) =>
    request<{ folders: MailFolder[] }>('/mail/folders?account=' + account + (fresh ? '&fresh=1' : '')),
  messages: (p: { account: 'all' | number; folder: string; offset?: number; limit?: number; fresh?: boolean }) => {
    const s = new URLSearchParams()
    s.set('account', String(p.account))
    s.set('folder', p.folder)
    s.set('offset', String(p.offset ?? 0))
    s.set('limit', String(p.limit ?? 50))
    if (p.fresh) s.set('fresh', '1')
    return request<MailListResult>('/mail/messages?' + s.toString())
  },
  message: (p: { account: number; folder: string; uid: number }) =>
    request<MailMessage>('/mail/message?account=' + p.account + '&folder=' + encodeURIComponent(p.folder) + '&uid=' + p.uid),
  attachmentUrl: (p: { account: number; folder: string; uid: number; index: number }) =>
    API_BASE + '/mail/attachment?account=' + p.account + '&folder=' + encodeURIComponent(p.folder) + '&uid=' + p.uid + '&index=' + p.index,
  markRead: (p: { account: number; folder: string; uid: number }) =>
    request<{ ok: boolean; marked: number }>('/mail/local-read', { method: 'POST', body: JSON.stringify(p) }),
  clearLocalRead: (account: 'all' | number = 'all') =>
    request<{ ok: boolean }>('/mail/local-read?account=' + account, { method: 'DELETE' }),
  status: () => request<{ marked: number; accounts: number }>('/mail/status'),
}
