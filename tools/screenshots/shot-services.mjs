// 服务栏截图：紧凑（默认）/ 详细 / 两种视角 / 深色 / 窄屏，外加「一屏能不能看全」的高度统计。
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

async function open(density, view) {
  await page.goto(BASE + '/services', { waitUntil: 'domcontentloaded' })
  if (!(await page.locator('.nav-item').count())) {
    if (!PW) throw new Error('实例要登录：设 PINBOARD_PASSWORD')
    await page.fill('input[type=password]', PW)
    await page.click('button[type=submit]')
    await page.waitForSelector('.nav-item', { timeout: 30000 })
  }
  await page.evaluate((d) => localStorage.setItem('pinboard-svc-density', d), density)
  await page.goto(BASE + '/services', { waitUntil: 'networkidle' })
  await page.waitForSelector('.svc-mini, .svc-card', { timeout: 20000 })
  if (view === 'service') {
    await page.locator('.svc-tab', { hasText: '服务视角' }).click()
    await page.waitForTimeout(300)
  }
  await page.waitForTimeout(300)
}

// 滚动的是 .content（shell.css:49 overflow-y:auto），量它才准
const metrics = async () => page.evaluate(() => {
  const el = document.querySelector('.content')
  const h = el ? el.scrollHeight : 0
  return {
    contentHeight: h,
    visibleHeight: el ? el.clientHeight : 0,
    fitsOneScreen: h <= (el ? el.clientHeight + 1 : 0),
    // 部署板底边到内容区顶边的距离 → 一屏还剩多少余量
    usedHeight: (() => {
      const b = document.querySelector('.svc-board')
      return b ? Math.round(b.getBoundingClientRect().bottom - el.getBoundingClientRect().top) : 0
    })(),
    cards: document.querySelectorAll('.svc-mini').length,
    rows: document.querySelectorAll('.svc-mini-row').length,
    cardHeights: [...document.querySelectorAll('.svc-mini')]
      .slice(0, 8)
      .map(c => Math.round(c.getBoundingClientRect().height)),
    alignItems: (() => {
      const b = document.querySelector('.svc-board')
      return b ? getComputedStyle(b).alignItems : null
    })(),
  }
})

await open('compact', 'server')
const mServer = await metrics()
await page.screenshot({ path: 'tmp/shot-services-server.png' })

await open('compact', 'service')
const mService = await metrics()
await page.screenshot({ path: 'tmp/shot-services-service.png' })

// 点第一条部署的名字 → 换到服务器视角并闪一下
const first = page.locator('.svc-mini-name').first()
const name = (await first.innerText()).trim()
await first.click()
await page.waitForTimeout(600)
const viewAfter = (await page.locator('.svc-tab.is-on').first().innerText()).trim()

// 点观测图标 → 观测台
const chip = page.locator('.svc-mini-mon').first()
const chipTitle = await chip.getAttribute('title')
await chip.click()
await page.waitForTimeout(500)
const url = page.url()

await open('detail', 'server')
const mDetail = await metrics()
await page.screenshot({ path: 'tmp/shot-services-detail.png', fullPage: true })

await open('compact', 'server')
await page.evaluate(() => localStorage.setItem('pinboard-theme', 'dark'))
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('.svc-mini', { timeout: 20000 })
await page.waitForTimeout(300)
await page.screenshot({ path: 'tmp/shot-services-dark.png' })
await page.evaluate(() => localStorage.setItem('pinboard-theme', 'system'))

await page.setViewportSize({ width: 1024, height: 800 })
await page.waitForTimeout(400)
const mNarrow = await metrics()
await page.screenshot({ path: 'tmp/shot-services-narrow.png' })

console.log(JSON.stringify({
  clickedRow: name,
  viewAfterClick: viewAfter,
  chipTitle,
  urlAfterChip: url,
  heights: { compactServer: mServer, compactService: mService, detailServer: mDetail, narrow: mNarrow },
  errors,
}, null, 1))
await browser.close()
