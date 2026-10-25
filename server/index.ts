import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { DATA_DIR, db } from './db.js'
import { authMiddleware } from './auth/middleware.js'
import { authRoute } from './auth/routes.js'
import { bootstrapPassword } from './auth/bootstrap.js'
import { createApiToken, deleteSetting } from './auth/store.js'
import { notesRoute } from './routes/notes.js'
import { assetsRoute } from './routes/assets.js'
import { tagsRoute } from './routes/tags.js'
import { fieldsRoute } from './routes/fields.js'
import { metaRoute } from './routes/meta.js'
import { monitorsRoute } from './kuma/routes.js'
import { mailRoute, shutdownMail } from './mail/routes.js'
import { hostsRoute } from './metrics/routes.js'
import { tunnelRoute } from './routes/tunnel.js'
import { startTunnelProbe } from './tunnel.js'
import { startMetricsPoller } from './metrics/poll.js'
import { scheduleSnapshot, writeSnapshot } from './snapshot.js'
import { loadKey } from './secrets/key.js'
import { migrateSecrets } from './secrets/migrate.js'
import { mountStatic } from './static.js'

const app = new Hono()
const api = new Hono()

// 除白名单外，/api/* 一律要登录（见 server/auth/middleware.ts）
api.use('*', authMiddleware)

// 任何写操作（POST/PUT/PATCH/DELETE）成功后，防抖重生成根目录的 SNAPSHOT.md
api.use('*', async (c, next) => {
  await next()
  const m = c.req.method
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' && c.res.status < 400) scheduleSnapshot()
})

api.route('/auth', authRoute)
api.route('/', metaRoute)
api.route('/notes', notesRoute)
api.route('/assets', assetsRoute)
api.route('/tags', tagsRoute)
api.route('/fields', fieldsRoute)
api.route('/monitors', monitorsRoute)
api.route('/mail', mailRoute)
api.route('/hosts', hostsRoute)
api.route('/tunnel', tunnelRoute)
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

// --reset-password：删掉密码后退出，下次访问回到 /setup
if (process.argv.includes('--reset-password')) {
  deleteSetting(db, 'password_hash')
  console.log('  已清除登录密码，重启后访问 /setup 重新设置')
  process.exit(0)
}

// --new-token <名字>：给脚本 / e2e 发一个 API token，明文只打印这一次
if (process.argv.includes('--new-token')) {
  const i = process.argv.indexOf('--new-token')
  const t = createApiToken(db, process.argv[i + 1] || 'cli')
  console.log(t.token)
  process.exit(0)
}

bootstrapPassword(db)

// 静态加密（spec 03）：加载主密钥，把还躺在明文里的凭据就地加密。幂等，每次启动都跑。
const secretKey = loadKey(DATA_DIR)
const sealed = migrateSecrets(db, secretKey, DATA_DIR)
if (sealed.mail || sealed.kuma || sealed.metrics) {
  console.log('  凭据已就地加密  ->  邮箱 ' + sealed.mail + ' 条 / Kuma 口令 ' + sealed.kuma + ' / 指标源 ' + sealed.metrics)
}

const port = Number(process.env.PORT || 7788)
// 默认只听本机；容器 / 局域网访问要显式设 HOST=0.0.0.0
const hostname = process.env.HOST || '127.0.0.1'
serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log('')
  console.log('  pinfolio 已启动  ->  http://' + hostname + ':' + info.port)
  console.log('  数据目录      ->  ' + DATA_DIR)
  console.log('')
  // 启动时先生成一次快照（失败只打日志，不影响服务）
  void writeSnapshot()
  // 主机指标：开机拉一次，之后每 5 分钟拉一次（见 server/metrics/poll.ts）
  startMetricsPoller()
  // 公网映射探活：配了地址就每 60s 自检一次（见 server/tunnel.ts）
  startTunnelProbe()
})

// 退出时断开 IMAP 连接（IMAP 是长连接，进程被 Ctrl+C / SIGTERM 时礼貌收尾）
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    try { shutdownMail() } catch { /* ignore */ }
    process.exit(0)
  })
}
