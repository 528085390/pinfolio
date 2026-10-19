import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { ROOT, DATA_DIR, DB_PATH, all, get, run, nowIso, syncNoteTags, setAssetTags } from './db.js'
import { notesRoute } from './routes/notes.js'
import { assetsRoute } from './routes/assets.js'
import { tagsRoute } from './routes/tags.js'
import { fieldsRoute } from './routes/fields.js'
import { monitorsRoute } from './routes/monitors.js'
import { hydrateAssets, hydrateNotes, type AssetRow, type NoteRow } from './hydrate.js'
import { scheduleSnapshot, writeSnapshot } from './snapshot.js'

const app = new Hono()
const api = new Hono()

// 任何写操作（POST/PUT/PATCH/DELETE）成功后，防抖重生成根目录的 SNAPSHOT.md
api.use('*', async (c, next) => {
  await next()
  const m = c.req.method
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' && c.res.status < 400) scheduleSnapshot()
})

api.get('/health', (c) => c.json({ ok: true, db: DB_PATH }))

api.get('/bootstrap', (c) => {
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

api.get('/search', (c) => {
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

function daysLeft(date: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(date + 'T00:00:00')
  if (isNaN(d.getTime())) return null
  return Math.round((d.getTime() - today.getTime()) / 86400000)
}

api.get('/stats', (c) => {
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

api.get('/export', (c) => {
  return c.json({
    app: 'pinboard',
    exportedAt: nowIso(),
    notes: hydrateNotes(all<NoteRow>('SELECT * FROM notes ORDER BY created_at ASC')),
    assets: hydrateAssets(all<AssetRow>('SELECT * FROM assets ORDER BY created_at ASC')),
    tags: all('SELECT * FROM tags'),
    fields: all('SELECT * FROM field_defs'),
  })
})

api.post('/seed', (c) => {
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
    name: 'my-server', kind: 'server', status: 'active', location: '阿里云 · 北京',
    vendor: '阿里云', price: 99, currency: 'CNY', expiresAt: day(133),
    url: 'https://example.com', notes: 'MyApp 双服务所在机器，nginx + manager + 上游。证书 acme.sh 自动续。',
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
    name: 'example.com', kind: 'domain', status: 'active', vendor: 'DigitalPlat',
    price: 0, currency: 'USD', expiresAt: day(32), url: 'https://example.com',
    notes: '未备案，走 443。', custom: { renew_cycle: '年付' }, tags: ['域名'],
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

api.route('/notes', notesRoute)
api.route('/assets', assetsRoute)
api.route('/tags', tagsRoute)
api.route('/fields', fieldsRoute)
api.route('/monitors', monitorsRoute)
app.route('/api', api)

const WEB_DIR = join(ROOT, 'dist', 'web')
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

app.get('*', async (c) => {
  const url = new URL(c.req.url)
  let p = decodeURIComponent(url.pathname)
  if (p === '/') p = '/index.html'
  const file = normalize(join(WEB_DIR, p))
  if (!file.startsWith(WEB_DIR)) return c.text('forbidden', 403)
  try {
    const buf = await readFile(file)
    return c.body(buf, 200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': p === '/index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    })
  } catch {
    if (extname(p)) return c.text('not found', 404)
    try {
      const html = await readFile(join(WEB_DIR, 'index.html'))
      // 深链（/notes、/assets…）回的是同一份 index.html，必须 no-cache，
      // 否则浏览器可能把某个页面的 HTML 缓存住，切页后刷新拿到旧壳。
      return c.body(html, 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' })
    } catch {
      return c.text('前端还没构建：先在项目目录跑 pnpm build', 404)
    }
  }
})

app.notFound((c) => {
  if (c.req.path.startsWith('/api')) return c.json({ error: 'not found' }, 404)
  return c.text('not found', 404)
})

app.onError((err, c) => {
  console.error('[api error]', err)
  return c.json({ error: String(err && err.message ? err.message : err) }, 500)
})

const port = Number(process.env.PORT || 7788)
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
  console.log('')
  console.log('  便签夹已启动  ->  http://127.0.0.1:' + info.port)
  console.log('  数据目录      ->  ' + DATA_DIR)
  console.log('')
  // 启动时先生成一次快照（失败只打日志，不影响服务）
  void writeSnapshot()
})
