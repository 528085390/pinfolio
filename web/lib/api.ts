export type Tag = { id: number; name: string; color: string; notes?: number; assets?: number }
export type Note = {
  id: number; content: string; pinned: boolean; archived: boolean; done: boolean; assetId: number | null
  createdAt: string; updatedAt: string; tags: Tag[]; asset: { id: number; name: string; kind: string } | null
}
export type Asset = {
  id: number; name: string; kind: string; status: string; location: string; vendor: string
  serial: string; price: number | null; currency: string; purchasedAt: string | null
  expiresAt: string | null; url: string; notes: string; custom: Record<string, any>
  createdAt: string; updatedAt: string; tags: Tag[]; noteCount: number
  linkedNotes?: { id: number; content: string; createdAt: string }[]
}
export type FieldDef = { id: number; key: string; label: string; type: string; options: string[]; sort: number }
export type Stats = {
  notes: number; archived: number; notesDone: number; notesPending: number; assets: number; active: number; totalValue: number
  expiringSoon: number; expired: number
  expiring: { id: number; name: string; kind: string; expiresAt: string; days: number }[]
}

export type Monitor = {
  id: number; name: string; type: string; group: string
  status: number | null; time: string | null; ping: number | null; msg: string
  /** 观测项固定说明，卡片名悬停显示；空串 = 没配 */
  description: string
  /** 为真时把本次心跳消息常显成「本次观测情况」一行 */
  showMsg: boolean
  /** Kuma 里是否启用（false = 已暂停，卡片上要打标） */
  active: boolean
  /** 基础检查间隔（秒） */
  interval: number
  uptime24: number | null; beats: number[]; downCount: number; lastDown: string | null
  /** 与 beats 一一对应：该拍消息前缀的四态字符（绿/黄/红/灰），普通监视器为 null */
  beatTones?: (string | null)[]
  link: { url: string; label: string } | null
}
export type MonitorGroup = { id: number; name: string; monitors: Monitor[] }
export type MonitorSummary = { total: number; up: number; down: number; pending: number; uptime24: number | null }
export type MonitorsPayload = {
  kuma: { base: string; slug: string; title: string }
  updatedAt: string
  summary: MonitorSummary
  groups: MonitorGroup[]
  stale?: boolean
  error?: string
}

export type MonitorBeat = {
  status: number | null; time: string | null; msg: string; ping: number | null
  /** 消息前缀的四态字符（绿/黄/红/灰），普通观测项为 null */
  tone: string | null
}
export type MonitorActionStep = { type: string; label: string; hint?: string }
export type MonitorAction = {
  /** config = monitor-actions.json 里配了；default = 默认「让 Kuma 立刻探一次」；none = 没有可执行动作 */
  source: 'config' | 'default' | 'none'
  steps: MonitorActionStep[]
  disabledReason: string | null
}
/** 立即观测跑完一步之后回显的一行（阶段 3 用）。 */
export type MonitorActionStepResult = { type: string; label: string; ok: boolean; detail: string; ms: number }
export type MonitorDetail = {
  monitor: Monitor & { timeout: number; maxretries: number; retryInterval: number; target: string; policy: { name: string; summary: string } | null }
  latest: MonitorBeat | null
  beats: MonitorBeat[]
  action: MonitorAction
  link: { url: string; label: string } | null
}

export type MailSecurity = 'ssl' | 'starttls' | 'none'
export type MailAccount = {
  id: number; label: string; email: string; host: string; port: number; username: string
  security: MailSecurity; enabled: number; sort: number
  created_at: string; updated_at: string; hasPassword: boolean
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {}
  if (init?.body) headers['Content-Type'] = 'application/json'
  const res = await fetch('/api' + path, { ...init, headers: { ...headers, ...(init?.headers as any) } })
  if (!res.ok) {
    let msg = res.status + ' ' + res.statusText
    try {
      const j: any = await res.json()
      if (j && j.error) msg = j.error
    } catch {}
    throw new Error(msg)
  }
  return (await res.json()) as T
}

export const api = {
  bootstrap: () => request<{ tags: Tag[]; fields: FieldDef[] }>('/bootstrap'),
  stats: () => request<Stats>('/stats'),
  search: (q: string) => request<{ notes: Note[]; assets: Asset[] }>('/search?q=' + encodeURIComponent(q)),
  exportAll: () => request<any>('/export'),
  seed: () => request<{ ok: boolean; error?: string }>('/seed', { method: 'POST' }),

  notes: {
    list: (p: { q?: string; tag?: string; pinned?: string; archived?: string; done?: string; assetId?: number }) => {
      const s = new URLSearchParams()
      if (p.q) s.set('q', p.q)
      if (p.tag) s.set('tag', p.tag)
      if (p.pinned) s.set('pinned', p.pinned)
      if (p.done) s.set('done', p.done)
      if (p.archived) s.set('archived', p.archived)
      if (p.assetId) s.set('assetId', String(p.assetId))
      return request<Note[]>('/notes?' + s.toString())
    },
    create: (b: { content: string; pinned?: boolean; done?: boolean; assetId?: number | null }) =>
      request<Note>('/notes', { method: 'POST', body: JSON.stringify(b) }),
    update: (id: number, b: any) => request<Note>('/notes/' + id, { method: 'PATCH', body: JSON.stringify(b) }),
    remove: (id: number) => request<{ ok: boolean }>('/notes/' + id, { method: 'DELETE' }),
  },

  assets: {
    list: (p: { q?: string; kind?: string; status?: string; tag?: string }) => {
      const s = new URLSearchParams()
      if (p.q) s.set('q', p.q)
      if (p.kind) s.set('kind', p.kind)
      if (p.status) s.set('status', p.status)
      if (p.tag) s.set('tag', p.tag)
      return request<Asset[]>('/assets?' + s.toString())
    },
    get: (id: number) => request<Asset>('/assets/' + id),
    create: (b: any) => request<Asset>('/assets', { method: 'POST', body: JSON.stringify(b) }),
    update: (id: number, b: any) => request<Asset>('/assets/' + id, { method: 'PATCH', body: JSON.stringify(b) }),
    remove: (id: number) => request<{ ok: boolean }>('/assets/' + id, { method: 'DELETE' }),
  },

  monitors: {
    get: (fresh?: boolean) => request<MonitorsPayload>('/monitors' + (fresh ? '?fresh=1' : '')),
    detail: (id: number) => request<MonitorDetail>('/monitors/' + id),
    update: (
      id: number,
      b: { name?: string; description?: string; interval?: number; showMsg?: boolean; timeout?: number; maxretries?: number; retryInterval?: number },
    ) => request<{ ok: boolean; monitor?: Monitor }>('/monitors/' + id, { method: 'PATCH', body: JSON.stringify(b) }),
    // 写接口都要求 application/json（服务端用它挡 CSRF），所以即使没有参数也要带个空 body
    pause: (id: number) => request<{ ok: boolean; active: boolean }>('/monitors/' + id + '/pause', { method: 'POST', body: JSON.stringify({}) }),
    resume: (id: number) => request<{ ok: boolean; active: boolean }>('/monitors/' + id + '/resume', { method: 'POST', body: JSON.stringify({}) }),
    remove: (id: number, confirm: string) =>
      request<{ ok: boolean; backup?: string | null }>('/monitors/' + id + '?confirm=' + encodeURIComponent(confirm), { method: 'DELETE' }),
    check: (id: number) =>
      request<{ ok: boolean; steps: MonitorActionStepResult[]; latest?: any }>('/monitors/' + id + '/check', { method: 'POST', body: JSON.stringify({}) }),
  },

  mail: {
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
    test: (b: { id?: number; host?: string; port?: number; username?: string; password?: string; security?: MailSecurity }) =>
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
      '/api/mail/attachment?account=' + p.account + '&folder=' + encodeURIComponent(p.folder) + '&uid=' + p.uid + '&index=' + p.index,
    markRead: (p: { account: number; folder: string; uid: number }) =>
      request<{ ok: boolean; marked: number }>('/mail/local-read', { method: 'POST', body: JSON.stringify(p) }),
    clearLocalRead: (account: 'all' | number = 'all') =>
      request<{ ok: boolean }>('/mail/local-read?account=' + account, { method: 'DELETE' }),
    status: () => request<{ marked: number; accounts: number }>('/mail/status'),
  },

  tags: {
    list: () => request<Tag[]>('/tags'),
    create: (b: { name: string; color?: string }) => request<Tag>('/tags', { method: 'POST', body: JSON.stringify(b) }),
    update: (id: number, b: any) => request<Tag>('/tags/' + id, { method: 'PATCH', body: JSON.stringify(b) }),
    remove: (id: number) => request<{ ok: boolean }>('/tags/' + id, { method: 'DELETE' }),
  },

  fields: {
    list: () => request<FieldDef[]>('/fields'),
    create: (b: { key: string; label: string; type: string; options?: string[] }) =>
      request<FieldDef>('/fields', { method: 'POST', body: JSON.stringify(b) }),
    update: (id: number, b: any) => request<FieldDef>('/fields/' + id, { method: 'PATCH', body: JSON.stringify(b) }),
    remove: (id: number) => request<{ ok: boolean }>('/fields/' + id, { method: 'DELETE' }),
  },
}

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}
