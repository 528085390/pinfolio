import { request } from './http'
import type { Tag } from './types'

export type Note = {
  id: number; content: string; pinned: boolean; archived: boolean; done: boolean; assetId: number | null
  createdAt: string; updatedAt: string; tags: Tag[]; asset: { id: number; name: string; kind: string } | null
}

export const notesApi = {
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
}
