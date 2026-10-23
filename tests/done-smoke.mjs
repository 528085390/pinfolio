import { BASE } from './env.mjs'
const B = BASE
const j = async (p, o) => { const r = await fetch(B + p, { headers: { 'Content-Type': 'application/json' }, ...o }); const t = await r.text(); if (!r.ok) throw new Error(p + ' ' + r.status + ' ' + t); return t ? JSON.parse(t) : null }
const tags = await j('/api/tags')
console.log('tags:', tags.map(t => t.name + '(' + t.notes + ')').join(' '))
const n = await j('/api/notes', { method: 'POST', body: JSON.stringify({ content: '测试完成状态 #测试' }) })
console.log('created done =', n.done)
const d = await j('/api/notes/' + n.id, { method: 'PATCH', body: JSON.stringify({ done: true }) })
console.log('after patch done =', d.done)
const onlyDone = await j('/api/notes?done=1')
const onlyTodo = await j('/api/notes?done=0')
console.log('done list:', onlyDone.map(x => x.id), 'todo list:', onlyTodo.map(x => x.id))
const s = await j('/api/stats')
console.log('stats:', JSON.stringify(s))
await j('/api/notes/' + n.id, { method: 'DELETE' })
console.log('cleaned up')