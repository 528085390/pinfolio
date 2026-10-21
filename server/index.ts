import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { DATA_DIR } from './db.js'
import { notesRoute } from './routes/notes.js'
import { assetsRoute } from './routes/assets.js'
import { tagsRoute } from './routes/tags.js'
import { fieldsRoute } from './routes/fields.js'
import { metaRoute } from './routes/meta.js'
import { monitorsRoute } from './kuma/routes.js'
import { mailRoute, shutdownMail } from './mail/routes.js'
import { scheduleSnapshot, writeSnapshot } from './snapshot.js'
import { mountStatic } from './static.js'

const app = new Hono()
const api = new Hono()

// 任何写操作（POST/PUT/PATCH/DELETE）成功后，防抖重生成根目录的 SNAPSHOT.md
api.use('*', async (c, next) => {
  await next()
  const m = c.req.method
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' && c.res.status < 400) scheduleSnapshot()
})

api.route('/', metaRoute)
api.route('/notes', notesRoute)
api.route('/assets', assetsRoute)
api.route('/tags', tagsRoute)
api.route('/fields', fieldsRoute)
api.route('/monitors', monitorsRoute)
api.route('/mail', mailRoute)
app.route('/api', api)

mountStatic(app)

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
  console.log('  pinfolio 已启动  ->  http://127.0.0.1:' + info.port)
  console.log('  数据目录      ->  ' + DATA_DIR)
  console.log('')
  // 启动时先生成一次快照（失败只打日志，不影响服务）
  void writeSnapshot()
})

// 退出时断开 IMAP 连接（IMAP 是长连接，进程被 Ctrl+C / SIGTERM 时礼貌收尾）
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    try { shutdownMail() } catch { /* ignore */ }
    process.exit(0)
  })
}
