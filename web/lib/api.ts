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
  uptime24: number | null; beats: number[]; downCount: number; lastDown: string | null
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
