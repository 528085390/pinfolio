import { request } from './http'
import type { Tag } from './types'

export type Asset = {
  id: number; name: string; kind: string; status: string; location: string; vendor: string
  serial: string; price: number | null; currency: string; purchasedAt: string | null
  expiresAt: string | null; url: string; notes: string; custom: Record<string, any>
  createdAt: string; updatedAt: string; tags: Tag[]; noteCount: number
  linkedNotes?: { id: number; content: string; createdAt: string }[]
}

export const assetsApi = {
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
}
