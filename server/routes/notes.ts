import { Hono } from 'hono'
import { all, get, run, nowIso, syncNoteTags, toBool } from '../db.js'
import { hydrateNotes, type NoteRow } from '../hydrate.js'

export const notesRoute = new Hono()

notesRoute.get('/', (c) => {
  const q = (c.req.query('q') || '').trim()
  const tag = (c.req.query('tag') || '').trim()
  const pinned = c.req.query('pinned')
  const archived = c.req.query('archived') || '0'
  const done = c.req.query('done')
  const assetId = c.req.query('assetId')
  const where: string[] = []
  const params: any[] = []
  if (archived !== 'all') { where.push('n.archived = ?'); params.push(archived === '1' ? 1 : 0) }
  if (pinned === '1') where.push('n.pinned = 1')
  if (done === '1') where.push('n.done = 1')
  if (done === '0') where.push('n.done = 0')
  if (q) { where.push('n.content LIKE ?'); params.push('%' + q + '%') }
  if (tag) {
    where.push('n.id IN (SELECT nt.note_id FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE t.name = ?)')
    params.push(tag)
  }
  if (assetId) { where.push('n.asset_id = ?'); params.push(Number(assetId)) }
  const sql = 'SELECT * FROM notes n' + (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY n.pinned DESC, n.done ASC, n.created_at DESC LIMIT 500'
  return c.json(hydrateNotes(all<NoteRow>(sql, ...params)))
})

notesRoute.get('/:id', (c) => {
  const row = get<NoteRow>('SELECT * FROM notes WHERE id = ?', Number(c.req.param('id')))
  if (!row) return c.json({ error: '便签不存在' }, 404)
  return c.json(hydrateNotes([row])[0])
})

notesRoute.post('/', async (c) => {
  const b: any = await c.req.json().catch(() => ({}))
  const content = String(b.content ?? '').trim()
  if (!content) return c.json({ error: '内容不能为空' }, 400)
  const now = nowIso()
  const assetId = b.assetId ? Number(b.assetId) : null
  const { id } = run(
    'INSERT INTO notes (content, pinned, archived, done, asset_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    content, toBool(b.pinned), toBool(b.archived), toBool(b.done), assetId, now, now,
  )
  syncNoteTags(id, content)
  return c.json(hydrateNotes(all<NoteRow>('SELECT * FROM notes WHERE id = ?', id))[0], 201)
})

notesRoute.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const existing = get<NoteRow>('SELECT * FROM notes WHERE id = ?', id)
  if (!existing) return c.json({ error: '便签不存在' }, 404)
  const b: any = await c.req.json().catch(() => ({}))
  const sets: string[] = []
  const params: any[] = []
  if (typeof b.content === 'string') {
    const content = b.content.trim()
    if (!content) return c.json({ error: '内容不能为空' }, 400)
    sets.push('content = ?'); params.push(content)
  }
  if (b.pinned !== undefined) { sets.push('pinned = ?'); params.push(toBool(b.pinned)) }
  if (b.archived !== undefined) { sets.push('archived = ?'); params.push(toBool(b.archived)) }
  if (b.done !== undefined) { sets.push('done = ?'); params.push(toBool(b.done)) }
  if (b.assetId !== undefined) { sets.push('asset_id = ?'); params.push(b.assetId ? Number(b.assetId) : null) }
  if (!sets.length) return c.json(hydrateNotes([existing])[0])
  sets.push('updated_at = ?'); params.push(nowIso()); params.push(id)
  run('UPDATE notes SET ' + sets.join(', ') + ' WHERE id = ?', ...params)
  const row = get<NoteRow>('SELECT * FROM notes WHERE id = ?', id)!
  if (typeof b.content === 'string') syncNoteTags(id, row.content)
  return c.json(hydrateNotes([row])[0])
})

notesRoute.delete('/:id', (c) => {
  const id = Number(c.req.param('id'))
  run('DELETE FROM notes WHERE id = ?', id)
  return c.json({ ok: true })
})
