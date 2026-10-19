import { Hono } from 'hono'
import { all, get, run } from '../db.js'

export const fieldsRoute = new Hono()

function parse(row: any) {
  let options: string[] = []
  try { options = JSON.parse(row.options || '[]') } catch { options = [] }
  return { ...row, options }
}

fieldsRoute.get('/', (c) => {
  return c.json(all<any>('SELECT * FROM field_defs ORDER BY sort ASC, id ASC').map(parse))
})

fieldsRoute.post('/', async (c) => {
  const b: any = await c.req.json().catch(() => ({}))
  const key = String(b.key ?? '').trim()
  const label = String(b.label ?? '').trim()
  if (!key || !label) return c.json({ error: '字段 key 和名称都不能为空' }, 400)
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) return c.json({ error: 'key 只能用字母开头，字母/数字/下划线' }, 400)
  if (get('SELECT id FROM field_defs WHERE key = ?', key)) return c.json({ error: 'key 已存在' }, 409)
  const type = ['text', 'number', 'date', 'url', 'select', 'bool'].includes(b.type) ? b.type : 'text'
  const options = Array.isArray(b.options) ? b.options.map(String) : []
  const maxSort = get<{ m: number }>('SELECT COALESCE(MAX(sort), 0) AS m FROM field_defs')!.m
  const { id } = run('INSERT INTO field_defs (key, label, type, options, sort) VALUES (?,?,?,?,?)', key, label, type, JSON.stringify(options), maxSort + 10)
  return c.json(parse(get('SELECT * FROM field_defs WHERE id = ?', id)), 201)
})

fieldsRoute.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const b: any = await c.req.json().catch(() => ({}))
  const sets: string[] = []
  const params: any[] = []
  if (typeof b.label === 'string' && b.label.trim()) { sets.push('label = ?'); params.push(b.label.trim()) }
  if (typeof b.type === 'string') { sets.push('type = ?'); params.push(b.type) }
  if (Array.isArray(b.options)) { sets.push('options = ?'); params.push(JSON.stringify(b.options.map(String))) }
  if (typeof b.sort === 'number') { sets.push('sort = ?'); params.push(b.sort) }
  if (!sets.length) return c.json({ ok: true })
  params.push(id)
  run('UPDATE field_defs SET ' + sets.join(', ') + ' WHERE id = ?', ...params)
  return c.json(parse(get('SELECT * FROM field_defs WHERE id = ?', id)))
})

fieldsRoute.delete('/:id', (c) => {
  run('DELETE FROM field_defs WHERE id = ?', Number(c.req.param('id')))
  return c.json({ ok: true })
})
