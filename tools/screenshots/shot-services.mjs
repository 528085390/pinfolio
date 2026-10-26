// 服务栏截图：两种视角 + 深色。需要实例已登录（PINBOARD_PASSWORD），
//   SHOT_BASE=http://127.0.0.1:7791 PINBOARD_PASSWORD=e2e-password node tools/screenshots/shot-services.mjs
import { CHROME as exe } from '../chrome-path.mjs'
import { chromium } from 'playwright-core'

const BASE = (process.env.SHOT_BASE || 'http://127.0.0.1:7788').replace(/\/+$/, '')
const PW = process.env.PINBOARD_PASSWORD || ''

const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, locale: 'zh-CN' })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
if (!(await page.locator('.nav-item').count())) {
  if (!PW) throw new Error('实例要登录：设 PINBOARD_PASSWORD')
  await page.fill('input[type=password]', PW)
  await page.click('button[type=submit]')
  await page.waitForSelector('.nav-item', { timeout: 30000 })
}

await page.goto(BASE + '/services', { waitUntil: 'networkidle' })
await page.waitForSelector('.svc-card', { timeout: 20000 })
await page.waitForTimeout(400)
await page.screenshot({ path: 'tmp/shot-services-server.png', fullPage: true })

// 点第一张卡里的服务名 → 换到服务视角并闪一下那张卡
const firstSvc = page.locator('.svc-card .svc-name').first()
const svcName = (await firstSvc.innerText()).trim()
await firstSvc.click()
await page.waitForTimeout(700)
const view2 = await page.locator('.svc-tab.is-on').innerText()
await page.screenshot({ path: 'tmp/shot-services-service.png', fullPage: true })

// 点观测标签 → 应该跳到观测台（Kuma 没起时页面会报错，这里只看 URL）
const chip = page.locator('.svc-card .svc-mon').first()
const chipLabel = await chip.innerText()
await chip.click()
await page.waitForTimeout(600)
const url = page.url()

// 深色：服务器视角
await page.goto(BASE + '/services', { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.setItem('pinboard-theme', 'dark'))
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('.svc-card', { timeout: 20000 })
await page.waitForTimeout(400)
await page.screenshot({ path: 'tmp/shot-services-dark.png', fullPage: true })
await page.evaluate(() => localStorage.setItem('pinboard-theme', 'system'))

// 搜索：只留命中的卡/行
await page.goto(BASE + '/services', { waitUntil: 'networkidle' })
await page.waitForSelector('.svc-card', { timeout: 20000 })
await page.fill('.svc-search input', 'kuma')
await page.waitForTimeout(500)
const hits = await page.locator('.svc-card').count()
await page.screenshot({ path: 'tmp/shot-services-search.png', fullPage: true })
await page.fill('.svc-search input', '')

// 窄屏：行改成两行
await page.setViewportSize({ width: 1024, height: 900 })
await page.waitForTimeout(300)
await page.screenshot({ path: 'tmp/shot-services-narrow.png' })

console.log(JSON.stringify({
  clickedService: svcName,
  viewAfterClick: view2.trim(),
  chipLabel: chipLabel.trim(),
  urlAfterChip: url,
  searchKumaCards: hits,
  errors,
}, null, 1))
await browser.close()
