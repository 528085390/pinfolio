import { CHROME as exe } from '../chrome-path.mjs';
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'

/**
 * 示例数据截图（给 README 用）。
 *
 * 跟 shots.mjs 的区别：那个连本机 7788 截真实数据、产物进 tmp/ 不入库；
 * 这个只认「隔离实例 + /api/seed 的示例数据」，产物直接写进 docs/screenshots/ 随仓库发布。
 *
 * 用法（先起一个空库实例并灌示例数据）：
 *   PORT=7799 PINBOARD_DATA=tmp/demo/data PINBOARD_PASSWORD=demo-pass-12345 \
 *     SERVICES_FILE=services.example.json node --import tsx server/index.ts
 *   curl -b cookies -H 'Content-Type: application/json' -X POST http://127.0.0.1:7799/api/seed
 *   node tools/screenshots/demo-shots.mjs
 *
 * 环境变量：BASE（默认 http://127.0.0.1:7799）、PASSWORD（必填）、OUT（默认 docs/screenshots）
 *
 * 两个注意点（2026-11-10 起）：
 *   - 出图按 CSS 像素（1440×900 / 390×844），设备像素比 1：dsf=2 出来的图虽然更细腻，
 *     但同尺寸下颜色数从 1 万涨到 4 万、单张从 260 KB 涨到 780 KB，README 里不划算。
 *     `scale: 'css'` 是兜底——万一把 dsf 调大了，出图尺寸也不会跟着翻倍。
 *   - 截图固定「暖纸 + 关壁纸 + 关折射」（`pinboard-style=paper` 等四个键，见 `web/lib/theme-prefs.ts`）。
 *     壁纸是用户自备的图、仓库里不带，README 里也不该出现作者那张；玻璃风格再叠上照片，
 *     同一张 1440×900 的 PNG 会从 260 KB 涨到 780 KB。
 *   - 示例实例没有 `data/metrics.json`，`GET /api/hosts` 必然 500（"还没配指标源"），属预期，
 *     所以下面把这条路径和「Failed to load resource」的 console 噪声排除，其它 4xx/5xx 仍算失败。
 */
const BASE = process.env.BASE || 'http://127.0.0.1:7799'
const PASSWORD = process.env.PASSWORD
const OUT = process.env.OUT || 'docs/screenshots'
if (!PASSWORD) {
  console.error('需要 PASSWORD=<隔离实例的登录密码>')
  process.exit(1)
}
if (!/127\.0\.0\.1|localhost/.test(BASE)) {
  console.error('BASE 必须是本机实例（示例数据截图不许连线上）')
  process.exit(1)
}

await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: exe })
const errors = []

// 示例实例本来就没配指标源，这条接口 500 是预期行为，不算截图失败。
const EXPECTED_HTTP_ERRORS = [/^\/api\/hosts$/]

async function shoot(name, fn, theme = 'light') {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    colorScheme: theme === 'dark' ? 'dark' : 'light',
  })
  // 首帧之前就把偏好写进 localStorage：暖纸、关壁纸、关折射，主题按参数
  await ctx.addInitScript((th) => {
    try {
      localStorage.setItem('pinboard-style', 'paper')
      localStorage.setItem('pinboard-wallpaper', 'off')
      localStorage.setItem('pinboard-glass-refract', 'off')
      localStorage.setItem('pinboard-theme', th)
    } catch {}
  }, theme)
  const page = await ctx.newPage()
  page.on('console', (m) => {
    // "Failed to load resource: ... 500" 是 HTTP 层失败的复读，下面 response 钩子已经记过一遍
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(name + ' console: ' + m.text())
  })
  page.on('response', (r) => {
    if (r.status() < 400) return
    const path = new URL(r.url()).pathname
    if (EXPECTED_HTTP_ERRORS.some((re) => re.test(path))) return
    errors.push(name + ' http ' + r.status() + ': ' + r.request().method() + ' ' + path)
  })
  page.on('pageerror', (e) => errors.push(name + ' pageerror: ' + e.message))

  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  // 登录页 → 填密码进主界面
  const pw = page.locator('input[type="password"]').first()
  if (await pw.count()) {
    await pw.fill(PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForSelector('.sidebar', { timeout: 15000 })
  }
  await page.waitForTimeout(900)
  await fn(page)
  await page.waitForTimeout(400)
  await page.screenshot({ path: OUT + '/' + name + '.png', scale: 'css' })
  await ctx.close()
}

const nav = (page, title) => page.click(`button[title="${title}"]`)

await shoot('notes', async (page) => {})

await shoot('assets', async (page) => {
  await nav(page, '资产台账')
  await page.waitForTimeout(700)
})

await shoot('asset-drawer', async (page) => {
  await nav(page, '资产台账')
  await page.waitForTimeout(600)
  const card = page.locator('.asset-card').first()
  if (await card.count()) { await card.click(); await page.waitForTimeout(800) }
})

await shoot('services', async (page) => {
  await nav(page, '服务器 ↔ 服务部署关系')
  await page.waitForTimeout(900)
})

await shoot('palette', async (page) => {
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(600)
})

await shoot('settings', async (page) => {
  await nav(page, '设置')
  await page.waitForTimeout(700)
})

await shoot('notes-dark', async () => {}, 'dark')

// 手机：390×844（iPhone 14 那一档），看便签页
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    locale: 'zh-CN',
  })
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('pinboard-style', 'paper')
      localStorage.setItem('pinboard-wallpaper', 'off')
      localStorage.setItem('pinboard-glass-refract', 'off')
      localStorage.setItem('pinboard-theme', 'light')
    } catch {}
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push('notes-mobile pageerror: ' + e.message))
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  const pw = page.locator('input[type="password"]').first()
  if (await pw.count()) {
    await pw.fill(PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForSelector('.sidebar, .mobile-bar, nav', { timeout: 15000 }).catch(() => {})
  }
  await page.waitForTimeout(1200)
  await page.screenshot({ path: OUT + '/notes-mobile.png', scale: 'css' })
  await ctx.close()
}

await browser.close()
if (errors.length) {
  console.error('页面有报错：')
  for (const e of errors) console.error('  ' + e)
  process.exitCode = 1
} else {
  console.log('截图完成 -> ' + OUT)
}
