import { Hono } from 'hono'
import { all, get, run, nowIso, setAssetTags } from '../db.js'
import { hydrateAssets, hydrateNotes, type AssetRow, type NoteRow } from '../hydrate.js'

export const assetsRoute = new Hono()

assetsRoute.get('/', (c) => {
  const q = (c.req.query('q') || '').trim()
  const kind = (c.req.query('kind') || '').trim()
  const status = (c.req.query('status') || '').trim()
  const tag = (c.req.query('tag') || '').trim()
  const where: string[] = []
  const params: any[] = []
  if (kind) { where.push('a.kind = ?'); params.push(kind) }
  if (status) { where.push('a.status = ?'); params.push(status) }
  if (q) {
    where.push('(a.name LIKE ? OR a.vendor LIKE ? OR a.serial LIKE ? OR a.location LIKE ? OR a.notes LIKE ? OR a.custom LIKE ? OR a.url LIKE ?)')
    for (let i = 0; i < 7; i++) params.push('%' + q + '%')
  }
  if (tag) {
    where.push('a.id IN (SELECT at.asset_id FROM asset_tags at JOIN tags t ON t.id = at.tag_id WHERE t.name = ?)')
    params.push(tag)
  }
  const sql = 'SELECT * FROM assets a' + (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY CASE a.status WHEN \'active\' THEN 0 WHEN \'idle\' THEN 1 ELSE 2 END, a.updated_at DESC LIMIT 500'
  return c.json(hydrateAssets(all<AssetRow>(sql, ...params)))
})

assetsRoute.get('/:id', (c) => {
  const id = Number(c.req.param('id'))
  const row = get<AssetRow>('SELECT * FROM assets WHERE id = ?', id)
  if (!row) return c.json({ error: '资产不存在' }, 404)
  const asset = hydrateAssets([row])[0]
  const linked = all<NoteRow>('SELECT * FROM notes WHERE asset_id = ? ORDER BY created_at DESC LIMIT 100', id)
  return c.json({ ...asset, linkedNotes: hydrateNotes(linked) })
})

function payload(b: any) {
  const custom = b.custom && typeof b.custom === 'object' ? JSON.stringify(b.custom) : '{}'
  return {
    name: String(b.name ?? '').trim(),
    kind: String(b.kind ?? 'device'),
    status: String(b.status ?? 'active'),
    location: String(b.location ?? '').trim(),
    vendor: String(b.vendor ?? '').trim(),
    serial: String(b.serial ?? '').trim(),
    price: b.price === '' || b.price === null || b.price === undefined ? null : Number(b.price),
    currency: String(b.currency ?? 'CNY'),
    purchased_at: b.purchasedAt ? String(b.purchasedAt).slice(0, 10) : null,
    expires_at: b.expiresAt ? String(b.expiresAt).slice(0, 10) : null,
    url: String(b.url ?? '').trim(),
    notes: String(b.notes ?? ''),
    custom,
  }
}

assetsRoute.post('/', async (c) => {
  const b: any = await c.req.json().catch(() => ({}))
  const p = payload(b)
  if (!p.name) return c.json({ error: '资产名称不能为空' }, 400)
  const now = nowIso()
  const { id } = run(
    'INSERT INTO assets (name, kind, status, location, vendor, serial, price, currency, purchased_at, expires_at, url, notes, custom, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    p.name, p.kind, p.status, p.location, p.vendor, p.serial, p.price, p.currency, p.purchased_at, p.expires_at, p.url, p.notes, p.custom, now, now,
  )
  setAssetTags(id, Array.isArray(b.tags) ? b.tags : [])
  return c.json(hydrateAssets(all<AssetRow>('SELECT * FROM assets WHERE id = ?', id))[0], 201)
})

assetsRoute.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const existing = get<AssetRow>('SELECT * FROM assets WHERE id = ?', id)
  if (!existing) return c.json({ error: '资产不存在' }, 404)
  const b: any = await c.req.json().catch(() => ({}))
  const p = payload({ ...existingToBody(existing), ...b })
  if (!p.name) return c.json({ error: '资产名称不能为空' }, 400)
  run(
    'UPDATE assets SET name=?, kind=?, status=?, location=?, vendor=?, serial=?, price=?, currency=?, purchased_at=?, expires_at=?, url=?, notes=?, custom=?, updated_at=? WHERE id=?',
    p.name, p.kind, p.status, p.location, p.vendor, p.serial, p.price, p.currency, p.purchased_at, p.expires_at, p.url, p.notes, p.custom, nowIso(), id,
  )
  if (Array.isArray(b.tags)) setAssetTags(id, b.tags)
  return c.json(hydrateAssets(all<AssetRow>('SELECT * FROM assets WHERE id = ?', id))[0])
})

assetsRoute.delete('/:id', (c) => {
  run('DELETE FROM assets WHERE id = ?', Number(c.req.param('id')))
  return c.json({ ok: true })
})

function existingToBody(r: AssetRow) {
  let custom: any = {}
  try { custom = JSON.parse(r.custom || '{}') } catch { custom = {} }
  return {
    name: r.name, kind: r.kind, status: r.status, location: r.location, vendor: r.vendor,
    serial: r.serial, price: r.price, currency: r.currency, purchasedAt: r.purchased_at,
    expiresAt: r.expires_at, url: r.url, notes: r.notes, custom,
  }
}
