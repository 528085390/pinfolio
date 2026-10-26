import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { DATA_DIR, db } from './db.js'
import { authMiddleware, isHttps } from './auth/middleware.js'
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
import { servicesRoute } from './services/routes.js'
import { tunnelRoute } from './routes/tunnel.js'
import { attachmentsRoute } from './routes/attachments.js'
import { startAttachmentSweep } from './attachments/store.js'
import { backupRoute } from './routes/backup.js'
import { runBackup } from './backup/run.js'
import { startBackupScheduler } from './backup/schedule.js'
import { startTunnelProbe } from './tunnel.js'
import { startMetricsPoller } from './metrics/poll.js'
import { scheduleSnapshot, writeSnapshot } from './snapshot.js'
import { loadKey } from './secrets/key.js'
import { migrateSecrets } from './secrets/migrate.js'
import { mountStatic } from './static.js'
import { pickLocale, withLocale, t } from './i18n.js'

const app = new Hono()
const api = new Hono()

// 安全响应头（壳与 /api 都加）。CSP 只写 frame-ancestors / base-uri：
// 完整的 CSP 会挡住 nginx 子路径部署时注入的 <script>window.__PB_BASE__</script>，
// 也会挡住邮件阅读器里用户主动加载的远程图片，见坑 51。
app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('Referrer-Policy', 'no-referrer')
  c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
  c.header('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'self'")
  // 只有真的是 HTTPS（直连或反代声明）才发 HSTS，别在 http 上误导浏览器
  if (isHttps(c)) c.header('Strict-Transport-Security', 'max-age=31536000')
})

// 界面语言跟着请求头走：前端每次请求都带 Accept-Language（见 web/lib/api/http.ts）。
// 用 AsyncLocalStorage 传下去，路由里直接 t('…') 就行，不用一路传 locale。
app.use('*', async (c, next) => {
  const locale = pickLocale(c.req.header('accept-language'))
  await withLocale(locale, () => next())
})

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
api.route('/services', servicesRoute)
api.route('/tunnel', tunnelRoute)
api.route('/backup', backupRoute)
api.route('/attachments', attachmentsRoute)
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
  const token = createApiToken(db, process.argv[i + 1] || 'cli')
  console.log(token.token)
  process.exit(0)
}

// --backup：立刻跑一次备份（两个目的地按配置来），适合放进 cron / 任务计划
if (process.argv.includes('--backup')) {
  const only = process.argv.includes('--local') ? 'local' : process.argv.includes('--remote') ? 'remote' : undefined
  const report = await runBackup(db, { only })
  for (const [dest, r] of Object.entries(report)) {
    console.log('  ' + (dest === 'local' ? t('本机文件') : t('远端数据库')) + '  ->  ' + (r.ok ? t('成功：') + (r.detail || '') : t('失败：') + (r.error || '')))
  }
  if (!Object.keys(report).length) console.log('  没有可用的备份目的地（本机已关且未配置远端库）')
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
  // 每天 03:00 自动备份（见 server/backup/schedule.ts）
  startBackupScheduler(db)
  // 每天扫一次没人引用的图片（见 server/attachments/store.ts）
  startAttachmentSweep()
})

// 退出时断开 IMAP 连接（IMAP 是长连接，进程被 Ctrl+C / SIGTERM 时礼貌收尾）
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    try { shutdownMail() } catch { /* ignore */ }
    process.exit(0)
  })
}
