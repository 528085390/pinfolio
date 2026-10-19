import { all } from './db.js'

export type NoteRow = {
  id: number; content: string; pinned: number; archived: number; done: number
  asset_id: number | null; created_at: string; updated_at: string
}

export function hydrateNotes(rows: NoteRow[]) {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const ph = ids.map(() => '?').join(',')
  const tagRows = all<any>(
    'SELECT nt.note_id AS note_id, t.id, t.name, t.color FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id IN (' + ph + ')',
    ...ids,
  )
  const byNote = new Map<number, any[]>()
  for (const t of tagRows) {
    const arr = byNote.get(t.note_id) || []
    arr.push({ id: t.id, name: t.name, color: t.color })
    byNote.set(t.note_id, arr)
  }
  const assetIds = [...new Set(rows.map((r) => r.asset_id).filter((x): x is number => typeof x === 'number'))]
  const assetRows = assetIds.length
    ? all<any>('SELECT id, name, kind FROM assets WHERE id IN (' + assetIds.map(() => '?').join(',') + ')', ...assetIds)
    : []
  const assetMap = new Map(assetRows.map((a) => [a.id, a]))
  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    pinned: !!r.pinned,
    archived: !!r.archived,
    done: !!r.done,
    assetId: r.asset_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    tags: byNote.get(r.id) || [],
    asset: r.asset_id ? assetMap.get(r.asset_id) || null : null,
  }))
}

export type AssetRow = {
  id: number; name: string; kind: string; status: string; location: string; vendor: string
  serial: string; price: number | null; currency: string; purchased_at: string | null
  expires_at: string | null; url: string; notes: string; custom: string
  created_at: string; updated_at: string
}

export function hydrateAssets(rows: AssetRow[]) {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const ph = ids.map(() => '?').join(',')
  const tagRows = all<any>(
    'SELECT at.asset_id AS asset_id, t.id, t.name, t.color FROM asset_tags at JOIN tags t ON t.id = at.tag_id WHERE at.asset_id IN (' + ph + ')',
    ...ids,
  )
  const byAsset = new Map<number, any[]>()
  for (const t of tagRows) {
    const arr = byAsset.get(t.asset_id) || []
    arr.push({ id: t.id, name: t.name, color: t.color })
    byAsset.set(t.asset_id, arr)
  }
  const noteCounts = all<any>(
    'SELECT asset_id, COUNT(*) AS n FROM notes WHERE asset_id IN (' + ph + ') GROUP BY asset_id',
    ...ids,
  )
  const countMap = new Map(noteCounts.map((r) => [r.asset_id, r.n]))
  return rows.map((r) => {
    let custom: Record<string, any> = {}
    try { custom = JSON.parse(r.custom || '{}') } catch { custom = {} }
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      status: r.status,
      location: r.location,
      vendor: r.vendor,
      serial: r.serial,
      price: r.price,
      currency: r.currency,
      purchasedAt: r.purchased_at,
      expiresAt: r.expires_at,
      url: r.url,
      notes: r.notes,
      custom,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      tags: byAsset.get(r.id) || [],
      noteCount: countMap.get(r.id) || 0,
    }
  })
}
