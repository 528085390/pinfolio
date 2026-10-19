import { Hono } from 'hono'
import { all, get, run, tagColor } from '../db.js'

export const tagsRoute = new Hono()

tagsRoute.get('/', (c) => {
  const rows = all<any>([
    'SELECT t.id, t.name, t.color,',
    ' (SELECT COUNT(*) FROM note_tags WHERE tag_id = t.id) AS notes,',
    ' (SELECT COUNT(*) FROM asset_tags WHERE tag_id = t.id) AS assets',
    'FROM tags t ORDER BY (notes + assets) DESC, t.name ASC',
  ].join('\n'))
  return c.json(rows)
})

tagsRoute.post('/', async (c) => {
  const b: any = await c.req.json().catch(() => ({}))
  const name = String(b.name ?? '').trim().replace(/^#/, '')
  if (!name) return c.json({ error: '标签名不能为空' }, 400)
  if (get('SELECT id FROM tags WHERE name = ?', name)) return c.json({ error: '标签已存在' }, 409)
  const { id } = run('INSERT INTO tags (name, color) VALUES (?, ?)', name, String(b.color || tagColor(name)))
  return c.json(get('SELECT * FROM tags WHERE id = ?', id), 201)
})

tagsRoute.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const b: any = await c.req.json().catch(() => ({}))
  const sets: string[] = []
  const params: any[] = []
  if (typeof b.name === 'string' && b.name.trim()) { sets.push('name = ?'); params.push(b.name.trim().replace(/^#/, '')) }
  if (typeof b.color === 'string' && b.color.trim()) { sets.push('color = ?'); params.push(b.color.trim()) }
  if (!sets.length) return c.json({ ok: true })
  params.push(id)
  run('UPDATE tags SET ' + sets.join(', ') + ' WHERE id = ?', ...params)
  return c.json(get('SELECT * FROM tags WHERE id = ?', id))
})

tagsRoute.delete('/:id', (c) => {
  run('DELETE FROM tags WHERE id = ?', Number(c.req.param('id')))
  return c.json({ ok: true })
})
