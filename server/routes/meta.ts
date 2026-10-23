import { Hono } from 'hono'
import { DB_PATH, all, db, get, nowIso, run, setAssetTags, syncNoteTags } from '../db.js'
import { hydrateAssets, hydrateNotes, type AssetRow, type NoteRow } from '../hydrate.js'
import { daysLeft } from '../dates.js'
import { instanceId } from '../tunnel.js'

// 不属于某个具体资源的杂项接口：健康检查、启动引导、全局搜索、统计、导出、示例数据。
export const metaRoute = new Hono()

// id = 本机实例 id，公网映射探活靠它确认「这条路通到的是我」
metaRoute.get('/health', (c) => c.json({ ok: true, id: instanceId(db) }))

metaRoute.get('/bootstrap', (c) => {
  const tags = all<any>([
    'SELECT t.id, t.name, t.color,',
    ' (SELECT COUNT(*) FROM note_tags WHERE tag_id = t.id) AS notes,',
    ' (SELECT COUNT(*) FROM asset_tags WHERE tag_id = t.id) AS assets',
    'FROM tags t ORDER BY (notes + assets) DESC, t.name ASC',
  ].join('\n'))
  const fields = all<any>('SELECT * FROM field_defs ORDER BY sort ASC, id ASC').map((f) => {
    let options: string[] = []
    try { options = JSON.parse(f.options || '[]') } catch { options = [] }
    return { ...f, options }
  })
  return c.json({ tags, fields })
})

metaRoute.get('/search', (c) => {
  const q = (c.req.query('q') || '').trim()
  if (!q) return c.json({ notes: [], assets: [] })
  const like = '%' + q + '%'
  const notes = all<NoteRow>('SELECT * FROM notes WHERE content LIKE ? AND archived = 0 ORDER BY created_at DESC LIMIT 8', like)
  const assets = all<AssetRow>(
    'SELECT * FROM assets WHERE name LIKE ? OR vendor LIKE ? OR serial LIKE ? OR location LIKE ? OR notes LIKE ? OR custom LIKE ? OR url LIKE ? LIMIT 8',
    like, like, like, like, like, like, like,
  )
  return c.json({ notes: hydrateNotes(notes), assets: hydrateAssets(assets) })
})

metaRoute.get('/stats', (c) => {
  const notes = get<{ n: number }>('SELECT COUNT(*) AS n FROM notes WHERE archived = 0')!.n
  const archived = get<{ n: number }>('SELECT COUNT(*) AS n FROM notes WHERE archived = 1')!.n
  const notesDone = get<{ n: number }>('SELECT COUNT(*) AS n FROM notes WHERE archived = 0 AND done = 1')!.n
  const notesPending = get<{ n: number }>('SELECT COUNT(*) AS n FROM notes WHERE archived = 0 AND done = 0')!.n
  const assets = get<{ n: number }>('SELECT COUNT(*) AS n FROM assets')!.n
  const active = get<{ n: number }>('SELECT COUNT(*) AS n FROM assets WHERE status = ?', 'active')!.n
  const value = get<{ v: number }>('SELECT COALESCE(SUM(price), 0) AS v FROM assets WHERE status <> ?', 'retired')!.v
  const rows = all<AssetRow>(
    'SELECT * FROM assets WHERE expires_at IS NOT NULL AND expires_at <> ? AND status <> ? ORDER BY expires_at ASC LIMIT 50',
    '', 'retired',
  )
  const expiring = hydrateAssets(rows)
    .map((a) => ({ id: a.id, name: a.name, kind: a.kind, expiresAt: a.expiresAt, days: a.expiresAt ? daysLeft(a.expiresAt) : null }))
    .filter((a) => a.days !== null)
  return c.json({
    notes, archived, notesDone, notesPending, assets, active, totalValue: value,
    expiringSoon: expiring.filter((a) => (a.days as number) <= 30 && (a.days as number) >= 0).length,
    expired: expiring.filter((a) => (a.days as number) < 0).length,
    expiring: expiring.slice(0, 8),
  })
})

metaRoute.get('/export', (c) => {
  return c.json({
    app: 'pinboard',
    exportedAt: nowIso(),
    notes: hydrateNotes(all<NoteRow>('SELECT * FROM notes ORDER BY created_at ASC')),
    assets: hydrateAssets(all<AssetRow>('SELECT * FROM assets ORDER BY created_at ASC')),
    tags: all('SELECT * FROM tags'),
    fields: all('SELECT * FROM field_defs'),
  })
})

metaRoute.post('/seed', (c) => {
  const n = get<{ n: number }>('SELECT COUNT(*) AS n FROM notes')!.n
  const a = get<{ n: number }>('SELECT COUNT(*) AS n FROM assets')!.n
  if (n > 0 || a > 0) return c.json({ ok: false, error: '已有数据，未载入示例' })

  const day = (offset: number) => {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    return d.toISOString().slice(0, 10)
  }
  const iso = (offsetMin: number) => new Date(Date.now() - offsetMin * 60000).toISOString()

  run('INSERT INTO field_defs (key, label, type, options, sort) VALUES (?,?,?,?,?)', 'secret_at', '密钥/凭证位置', 'text', '[]', 10)
  run('INSERT INTO field_defs (key, label, type, options, sort) VALUES (?,?,?,?,?)', 'renew_cycle', '续费周期', 'select', JSON.stringify(['月付', '季付', '年付', '买断']), 20)

  const addAsset = (o: any) => {
    const now = nowIso()
    const { id } = run(
      'INSERT INTO assets (name, kind, status, location, vendor, serial, price, currency, purchased_at, expires_at, url, notes, custom, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      o.name, o.kind, o.status || 'active', o.location || '', o.vendor || '', o.serial || '',
      o.price ?? null, o.currency || 'CNY', o.purchasedAt || null, o.expiresAt || null,
      o.url || '', o.notes || '', JSON.stringify(o.custom || {}), now, now,
    )
    setAssetTags(id, o.tags || [])
    return id
  }

  const srv = addAsset({
    name: '我的服务器', kind: 'server', status: 'active', location: '云厂商 · 北京',
    vendor: '阿里云', price: 99, currency: 'CNY', expiresAt: day(133),
    url: 'https://example.com', notes: '示例：一台云服务器，nginx 反代两个服务，证书 acme.sh 自动续。',
    custom: { secret_at: 'C:\\Users\\you\\.ssh\\config', renew_cycle: '年付' },
    tags: ['服务器', '运维'],
  })
  addAsset({
    name: 'ThinkPad X1 Carbon', kind: 'device', status: 'active', location: '书房',
    vendor: 'Lenovo', serial: 'PF3XXXXX', price: 12999, currency: 'CNY',
    purchasedAt: day(-530), expiresAt: day(565), notes: '主力开发机，三年上门保修。',
    custom: { renew_cycle: '买断' }, tags: ['硬件'],
  })
  addAsset({
    name: 'example.com', kind: 'domain', status: 'active', vendor: '域名注册商',
    price: 0, currency: 'USD', expiresAt: day(32), url: 'https://example.com',
    notes: '示例：未备案，走 443。', custom: { renew_cycle: '年付' }, tags: ['域名'],
  })
  addAsset({
    name: 'ChatGPT Plus', kind: 'account', status: 'active', vendor: 'OpenAI',
    price: 20, currency: 'USD', expiresAt: day(14), notes: '每月自动续，主账号。',
    custom: { secret_at: '1Password / AI', renew_cycle: '月付' }, tags: ['订阅'],
  })

  const addNote = (content: string, pinned: boolean, assetId: number | null, minsAgo: number) => {
    const t = iso(minsAgo)
    const { id } = run(
      'INSERT INTO notes (content, pinned, archived, asset_id, created_at, updated_at) VALUES (?,?,?,?,?,?)',
      content, pinned ? 1 : 0, 0, assetId, t, t,
    )
    syncNoteTags(id, content)
  }

  addNote('把散落在各处的脚本按主题归拢，**能复现的**才留档，其余进 tmp/ 直接删。#整理', true, null, 30)
  addNote('my-server 的证书下个月到期，续期前先跑一次 dry-run。#运维 #待办', true, srv, 120)
  addNote('便签和资产其实是同一件事：都是「我拥有的东西」，一个是信息，一个是物件。所以标签应该共用一套。#想法', false, null, 300)
  addNote('阅读笔记：所谓「坏味道」，就是那些让你每次读都要重新推理一遍的地方。#阅读', false, null, 1500)

  return c.json({ ok: true })
})
