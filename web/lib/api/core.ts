import { request } from './http'
import type { FieldDef, Stats, Tag } from './types'
import type { Note } from './notes'
import type { Asset } from './assets'

/** 启动引导：标签（带便签/资产计数）+ 自定义字段定义，App 启动时拉一次。 */
export const coreApi = {
  bootstrap: () => request<{ tags: Tag[]; fields: FieldDef[] }>('/bootstrap'),
  stats: () => request<Stats>('/stats'),
  search: (q: string) => request<{ notes: Note[]; assets: Asset[] }>('/search?q=' + encodeURIComponent(q)),
  exportAll: () => request<any>('/export'),
  seed: () => request<{ ok: boolean; error?: string }>('/seed', { method: 'POST' }),
}

export const tagsApi = {
  list: () => request<Tag[]>('/tags'),
  create: (b: { name: string; color?: string }) => request<Tag>('/tags', { method: 'POST', body: JSON.stringify(b) }),
  update: (id: number, b: any) => request<Tag>('/tags/' + id, { method: 'PATCH', body: JSON.stringify(b) }),
  remove: (id: number) => request<{ ok: boolean }>('/tags/' + id, { method: 'DELETE' }),
}

export const fieldsApi = {
  list: () => request<FieldDef[]>('/fields'),
  create: (b: { key: string; label: string; type: string; options?: string[] }) =>
    request<FieldDef>('/fields', { method: 'POST', body: JSON.stringify(b) }),
  update: (id: number, b: any) => request<FieldDef>('/fields/' + id, { method: 'PATCH', body: JSON.stringify(b) }),
  remove: (id: number) => request<{ ok: boolean }>('/fields/' + id, { method: 'DELETE' }),
}
