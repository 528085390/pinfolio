import type { Hono } from 'hono'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { ROOT } from './db.js'

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

/** 托管 dist/web：命中文件就给文件，没扩展名的路径回 index.html（前端路由接管）。 */
export function mountStatic(app: Hono) {
  app.get('*', async (c) => {
    const url = new URL(c.req.url)
    let p = decodeURIComponent(url.pathname)
    if (p === '/') p = '/index.html'
    const file = normalize(join(WEB_DIR, p))
    if (!file.startsWith(WEB_DIR)) return c.text('forbidden', 403)
    try {
      const buf = await readFile(file)
      // 带哈希的 assets 可以长缓存；壳、manifest、图标都是固定文件名，改了要能立刻生效。
      const cacheable = !(p === '/index.html' || p.endsWith('.webmanifest') || p.startsWith('/icons/') || p === '/apple-touch-icon.png')
      return c.body(buf, 200, {
        'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': cacheable ? 'public, max-age=31536000, immutable' : 'no-cache',
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
}
