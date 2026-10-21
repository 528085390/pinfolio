
const base = 'http://127.0.0.1:7788/api'
const j = async (p, init) => {
  const r = await fetch(base + p, init ? { ...init, headers: { 'Content-Type': 'application/json' } } : undefined)
  const t = await r.text()
  let d; try { d = JSON.parse(t) } catch { d = t }
  if (!r.ok) throw new Error(p + ' -> ' + r.status + ' ' + t)
  return d
}
const log = (k, v) => console.log(k.padEnd(22), typeof v === 'string' ? v : JSON.stringify(v).slice(0, 240))

log('seed', await j('/seed', { method: 'POST' }))
const boot = await j('/bootstrap')
log('bootstrap', { tags: boot.tags.length, fields: boot.fields.map(f => f.key) })

const n1 = await j('/notes', { method: 'POST', body: JSON.stringify({ content: '今天把 #测试 便签写通了\n\n- 支持 **Markdown**\n- 支持标签', pinned: true }) })
log('note created', { id: n1.id, pinned: n1.pinned, tags: n1.tags.map(t => t.name) })

const byTag = await j('/notes?tag=' + encodeURIComponent('测试'))
log('notes by tag', byTag.length)

const a1 = await j('/assets', { method: 'POST', body: JSON.stringify({ name: '测试资产', kind: 'server', status: 'active', location: '本机', price: 99.5, currency: 'CNY', expiresAt: '2026-11-01', tags: ['测试', '临时'], custom: { secret_at: '1Password' } }) })
log('asset created', { id: a1.id, tags: a1.tags.map(t => t.name), custom: a1.custom, price: a1.price })

const n2 = await j('/notes', { method: 'POST', body: JSON.stringify({ content: '这条挂到资产上 #测试', assetId: a1.id }) })
log('note w/ asset', { id: n2.id, asset: n2.asset })

const detail = await j('/assets/' + a1.id)
log('asset detail', { notesField: detail.notes, linked: detail.linkedNotes.map(n => n.id) })

const patched = await j('/assets/' + a1.id, { method: 'PATCH', body: JSON.stringify({ status: 'idle', price: null }) })
log('asset patched', { status: patched.status, price: patched.price, notes: patched.notes })

const upd = await j('/notes/' + n1.id, { method: 'PATCH', body: JSON.stringify({ content: '改过了 #测试 #改名' }) })
log('note patched', upd.tags.map(t => t.name))

const unlinked = await j('/notes/' + n2.id, { method: 'PATCH', body: JSON.stringify({ assetId: null }) })
log('note unlink', unlinked.assetId)

log('search', await j('/search?q=' + encodeURIComponent('测试')).then(r => ({ notes: r.notes.length, assets: r.assets.length })))
log('stats', await j('/stats').then(s => ({ notes: s.notes, assets: s.assets, expiringSoon: s.expiringSoon })))
log('tags', await j('/tags').then(t => t.map(x => x.name + ':' + x.notes + '/' + x.assets)))
log('export keys', Object.keys(await j('/export')))

await j('/notes/' + n1.id, { method: 'DELETE' })
await j('/notes/' + n2.id, { method: 'DELETE' })
await j('/assets/' + a1.id, { method: 'DELETE' })
log('cleanup', { notes: (await j('/notes')).length, assets: (await j('/assets')).length })
