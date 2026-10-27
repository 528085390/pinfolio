import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import type { ServerType } from '@hono/node-server'
import type { AddressInfo } from 'node:net'
import { DATA_DIR, db } from './db.js'
import { authMiddleware, isHttps } from './auth/middleware.js'
import { authRoute } from './auth/routes.js'
import { bootstrapPassword } from './auth/bootstrap.js'
import { notesRoute } from './routes/notes.js'
import { assetsRoute } from './routes/assets.js'
import { tagsRoute } from './routes/tags.js'
import { fieldsRoute } from './routes/fields.js'
import { metaRoute } from './routes/meta.js'
import { monitorsRoute } from './kuma/routes.js'
import { outboundRoute } from './routes/outbound.js'
import { mailRoute, shutdownMail } from './mail/routes.js'
import { hostsRoute } from './metrics/routes.js'
import { servicesRoute } from './services/routes.js'
import { tunnelRoute } from './routes/tunnel.js'
import { attachmentsRoute } from './routes/attachments.js'
import { startAttachmentSweep } from './attachments/store.js'
import { backupRoute } from './routes/backup.js'
import { startBackupScheduler } from './backup/schedule.js'
import { startTunnelProbe } from './tunnel.js'
import { startMetricsPoller } from './metrics/poll.js'
import { cancelSnapshot, scheduleSnapshot, writeSnapshot } from './snapshot.js'
import { loadKey } from './secrets/key.js'
import { migrateSecrets } from './secrets/migrate.js'
import { mountStatic } from './static.js'
import { pickLocale, withLocale } from './i18n.js'
import { ensureDesktopSession, clearDesktopSession } from './desktop-session.js'

/**
 * 服务组装：把 Hono 应用（壳 + /api）、后台定时器和 HTTP 监听打包成 startServer()。
 *
 * 谁在用：
 * - server/index.ts —— CLI / web / Docker（默认 127.0.0.1:7788）
 * - Electron 主进程（Task 6）—— 传 { port: 0 } 让系统分配端口，拿 handle.url / handle.port 去开窗口
 *
 * 注意：./db.js 是模块级单例（import 即开库、跑迁移），所以这里只能静态 import 它。
 * 环境变量（PINBOARD_DATA 等）必须由调用方在本模块被 import **之前**设好。
 */

export type StartServerOptions = {
  hostname?: string
  port?: number
  /** 桌面端免密登录开关（Task 2 落地，本任务只做「必须是回环地址」的校验） */
  desktopAutoLogin?: boolean
}

/** 桌面免密会话：由主进程注入渲染进程，用来跳过登录页（Task 2） */
export type DesktopSession = { id: string; token: string }

export type ServerHandle = {
  /** 实际监听地址（port 传 0 时是系统分配的端口拼出来的） */
  url: string
  port: number
  desktopSession?: DesktopSession
  close(): Promise<void>
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.trim().toLowerCase())
}

/**
 * 解析监听参数：opts 优先，其次 env（默认 process.env）的 PORT / HOST，最后回落到 127.0.0.1:7788。
 * 默认只听本机；容器 / 局域网访问要显式设 HOST=0.0.0.0。
 * 免密登录会签发会话，绑到非回环地址就等于把本机便签库敞开，所以直接拒绝启动。
 */
export function resolveListenOptions(
  opts: StartServerOptions = {},
  env: Record<string, string | undefined> = process.env,
): { hostname: string; port: number; desktopAutoLogin: boolean } {
  const hostname = opts.hostname ?? (env.HOST || '127.0.0.1')
  const port = opts.port ?? Number(env.PORT || 7788)
  const desktopAutoLogin = opts.desktopAutoLogin === true
  if (desktopAutoLogin && !isLoopbackHost(hostname)) {
    throw new Error('desktopAutoLogin 只允许回环地址（127.0.0.1 / ::1 / localhost），当前 hostname=' + hostname)
  }
  return { hostname, port, desktopAutoLogin }
}

/** 监听地址 → 能直接拿去 fetch 的 URL 主机段（0.0.0.0 / :: 换成回环，IPv6 加方括号） */
function urlHost(address: string): string {
  if (address === '0.0.0.0') return '127.0.0.1'
  if (address === '::' || address === '0:0:0:0:0:0:0:0') return '[::1]'
  return address.includes(':') ? '[' + address + ']' : address
}

function createApp(): Hono {
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
  api.route('/outbound', outboundRoute)
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

  return app
}

export async function startServer(opts: StartServerOptions = {}): Promise<ServerHandle> {
  const { hostname, port, desktopAutoLogin } = resolveListenOptions(opts)
  const app = createApp()

  bootstrapPassword(db)

  // 静态加密（spec 03）：加载主密钥，把还躺在明文里的凭据就地加密。幂等，每次启动都跑。
  const secretKey = loadKey(DATA_DIR)
  const sealed = migrateSecrets(db, secretKey, DATA_DIR)
  if (sealed.mail || sealed.kuma || sealed.metrics) {
    console.log('  凭据已就地加密  ->  邮箱 ' + sealed.mail + ' 条 / Kuma 口令 ' + sealed.kuma + ' / 指标源 ' + sealed.metrics)
  }

  // 4 个后台任务各自返回 stop，close() 时逐个停掉。同进程里二次 startServer()（比如端口被占后重试）
  // 不会挂出双份轮询 / 双份 03:00 备份链：各模块内部有自己的重入守卫。
  const stops: Array<() => void> = []
  const server: ServerType = serve({ fetch: app.fetch, port, hostname }, () => {
    // 启动时先生成一次快照（失败只打日志，不影响服务）
    void writeSnapshot()
    stops.push(
      // 主机指标：开机拉一次，之后每 5 分钟拉一次（见 server/metrics/poll.ts）
      startMetricsPoller(),
      // 公网映射探活：配了地址就每 60s 自检一次（见 server/tunnel.ts）
      startTunnelProbe(),
      // 每天 03:00 自动备份（见 server/backup/schedule.ts）
      startBackupScheduler(db),
      // 每天扫一次没人引用的图片（见 server/attachments/store.ts）
      startAttachmentSweep(),
    )
  })

  // port 传 0 时端口是系统分配的，只能等 listening 之后从地址里读（serve() 的返回值上没有 port）
  const actualPort = await new Promise<number>((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      server.off('error', onError)
      const addr = server.address() as AddressInfo | string | null
      resolve(typeof addr === 'object' && addr ? addr.port : port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    // 极端情况：监听已经起来了（事件在挂监听前就发过），别再干等
    if (server.listening) onListening()
  })

  const addr = server.address() as AddressInfo | string | null
  const listenHost = typeof addr === 'object' && addr ? addr.address : hostname
  const url = 'http://' + urlHost(listenHost) + ':' + actualPort

  // 桌面端免密：只在 desktopAutoLogin 为真时发一张票（resolveListenOptions 已保证是回环地址）。
  // 放在监听成功之后：监听失败就别发一张没人用的活票。
  //
  // 发不出去（磁盘满 / 只读库 / IO 错）时不能就这么 reject：此刻端口已经 bind、4 组后台定时器
  // 也已经挂上，而调用方拿不到 handle，谁都没法关。所以先在本地把这两样收干净，再把原错抛回去。
  // 会话本身是事务写的（见 desktop-session.ts），半途失败不会留下清不掉的孤儿票。
  let desktopSession: DesktopSession | undefined
  if (desktopAutoLogin) {
    try {
      desktopSession = ensureDesktopSession(db, { ip: '127.0.0.1' })
    } catch (err) {
      cancelSnapshot()
      for (const stop of stops.splice(0)) {
        try { stop() } catch { /* 停不掉也得继续收拾，别盖住原始错误 */ }
      }
      await new Promise<void>((resolve) => server.close(() => resolve()))
      throw err
    }
  }

  let closed = false
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    // 还没触发的快照防抖直接取消，别在服务关了之后再去写 SNAPSHOT.md
    cancelSnapshot()
    // IMAP 是长连接，礼貌收尾；失败了也别让关闭流程抛
    try { shutdownMail() } catch { /* ignore */ }
    // 4 组后台定时器都 unref 过（不挡进程退出），但 close() 之后不该再有任务往这个实例里写：
    // 逐个 stop（splice(0) 保证只停一次；重复 close 由 closed 标志挡住）
    for (const stop of stops.splice(0)) {
      try { stop() } catch { /* 停不掉也别让关闭流程抛 */ }
    }
    // 桌面端退出就别留活票：清掉启动时发的那条会话（以及设置里的桌面会话 id）。
    // 只有这次真的发过票才清，Web 形态不碰库；清不掉也别让关闭流程抛。
    if (desktopAutoLogin) {
      try { clearDesktopSession(db) } catch { /* ignore */ }
    }
    await new Promise<void>((resolve, reject) => {
      server.close((err?: Error) => (err ? reject(err) : resolve()))
    })
  }

  return { url, port: actualPort, desktopSession, close }
}
