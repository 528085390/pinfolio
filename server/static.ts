import type { Context, Hono } from 'hono'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { ROOT } from './db.js'
import { demoBootPrefs } from './demo.js'
import type { DemoBootPrefs } from './demo.js'
import { t } from './i18n.js'

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
  '.webmanifest': 'application/manifest+json; charset=utf-8',
}

/**
 * 分享预览卡（og:image / og:url）必须是绝对地址，而每个人自建的域名都不一样，所以 index.html 里留了
 * __PINBOARD_ORIGIN__ 占位，请求时按访客看到的域名填。反代后面只认 X-Forwarded-*（跟 TRUST_PROXY 同一套约定），
 * 直连就用请求本身的 origin。
 */
function pageOrigin(c: Context): string {
  const url = new URL(c.req.url)
  if (process.env.TRUST_PROXY === '1') {
    const proto = (c.req.header('x-forwarded-proto') ?? '').toLowerCase() === 'https' ? 'https' : url.protocol.replace(':', '')
    const host = c.req.header('x-forwarded-host') || c.req.header('host') || url.host
    return `${proto}://${host}`
  }
  return url.origin
}

/**
 * 把演示站的缺省外观塞进壳的 <head>（`prefs` 为 null 时原样返回）。
 *
 * 为什么不能走接口：外观要在首帧之前就写到 <html> 上，否则会先按暖纸画一帧再跳到玻璃
 * （白闪，见 `web/lib/theme-prefs.ts` 的 applyBootPrefs）。inline script 在 module 之前执行，
 * 正好赶在首帧前面。
 * 为什么必须转义 '<'：`</script>` 会直接把脚本块切段，用户给的壁纸地址里带个尖括号就完蛋。
 */
export function injectDemoPrefs(html: string, prefs: DemoBootPrefs | null): string {
  if (!prefs) return html
  const json = JSON.stringify(prefs).replace(/</g, '\\u003c')
  const tag = `<script>window.__PINBOARD_DEMO_PREFS__ = ${json}</script>`
  // 壳里没有 </head> 就说明拿到的不是我们那份 index.html，宁可什么都不注入
  return html.includes('</head>') ? html.replace('</head>', `${tag}\n  </head>`) : html
}

function renderShell(raw: Buffer | string, c: Context): string {
  const html = raw.toString('utf8').replaceAll('__PINBOARD_ORIGIN__', pageOrigin(c))
  return injectDemoPrefs(html, demoBootPrefs())
}

/** 判定静态资源路径是否可长缓存（带内容哈希的资源可缓存 1 年，固定命名的壳/图标/元文件不长缓存） */
export function isCacheablePath(p: string): boolean {
  return !(
    p === '/index.html' ||
    p.endsWith('.webmanifest') ||
    p.startsWith('/icons/') ||
    p === '/apple-touch-icon.png' ||
    p === '/favicon.ico' ||
    p === '/robots.txt' ||
    // 壁纸是可被用户直接替换的同名文件：长缓存会让换图后浏览器一直用旧的
    p.startsWith('/wallpapers/')
  )
}

/** 托管 dist/web：命中文件就给文件，没扩展名的路径回 index.html（前端路由接管）。 */
export function mountStatic(app: Hono) {
  app.get('*', async (c) => {
    const url = new URL(c.req.url)
    // 畸形百分号编码（/%E0%A4%A）会让 decodeURIComponent 抛，这里当成坏请求，别冒到 onError 变 500
    let p: string
    try {
      p = decodeURIComponent(url.pathname)
    } catch {
      return c.text('bad request', 400)
    }
    if (p === '/') p = '/index.html'
    const file = normalize(join(WEB_DIR, p))
    if (!file.startsWith(WEB_DIR)) return c.text('forbidden', 403)
    try {
      const buf = await readFile(file)
      // 带哈希的 assets 可以长缓存；壳、manifest、图标都是固定文件名，改了要能立刻生效。
      const cacheable = isCacheablePath(p)
      // 首页壳要把预览卡的占位符换成真实域名；其余静态文件原样给。
      return c.body(p === '/index.html' ? renderShell(buf, c) : buf, 200, {
        'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': cacheable ? 'public, max-age=31536000, immutable' : 'no-cache',
      })
    } catch {
      if (extname(p)) return c.text('not found', 404)
      try {
        const html = await readFile(join(WEB_DIR, 'index.html'))
        // 深链（/notes、/assets…）回的是同一份 index.html，必须 no-cache，
        // 否则浏览器可能把某个页面的 HTML 缓存住，切页后刷新拿到旧壳。
        return c.body(renderShell(html, c), 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' })
      } catch {
        return c.text(t('前端还没构建：先在项目目录跑 pnpm build'), 404)
      }
    }
  })
}
