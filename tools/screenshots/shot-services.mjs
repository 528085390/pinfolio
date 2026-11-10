// 服务页截图 + 实测：默认 / 暗色 / 窄屏，外加服务器标签筛选的压暗效果与卡片刻度统计。
//   卡片刻度自 2026-11-10 起与观测台、资产页共用 assets.css 的 .asset-card.is-compact，
//   本脚本顺手把那份刻度量出来，方便三页对比。
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

async function open(theme) {
  await page.goto(BASE + '/services', { waitUntil: 'domcontentloaded' })
  if (!(await page.locator('.nav-item').count())) {
    if (!PW) throw new Error('实例要登录：设 PINBOARD_PASSWORD')
    await page.fill('input[type=password]', PW)
    await page.click('button[type=submit]')
    await page.waitForSelector('.nav-item', { timeout: 30000 })
  }
  if (theme) await page.evaluate((t) => localStorage.setItem('pinboard-theme', t), theme)
  await page.goto(BASE + '/services', { waitUntil: 'networkidle' })
  await page.waitForSelector('.svc-card', { timeout: 20000 })
  await page.waitForTimeout(300)
}

// 滚动的是 .content（shell.css:49 overflow-y:auto），量它才准
const metrics = async () => page.evaluate(() => {
  const content = document.querySelector('.content')
  const grid = document.querySelector('.svc-grid')
  const card = document.querySelector('.svc-card')
  const icon = card?.querySelector('.asset-icon')
  const name = card?.querySelector('.asset-name')
  const sub = card?.querySelector('.asset-sub')
  const head = card?.querySelector('.asset-card-head')
  const cs = (el) => (el ? getComputedStyle(el) : null)
  const g = cs(grid)
  const c = cs(card)
  return {
    contentHeight: content ? content.scrollHeight : 0,
    visibleHeight: content ? content.clientHeight : 0,
    gridClass: grid ? grid.className : null,
    cardClass: card ? card.className : null,
    columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
    columnWidth: grid ? Math.round(parseFloat(getComputedStyle(grid).gridTemplateColumns.split(' ')[0])) : 0,
    gap: g ? g.gap : null,
    cards: document.querySelectorAll('.svc-card').length,
    cardPadding: c ? c.padding : null,
    cardGap: c ? c.gap : null,
    cardRadius: c ? c.borderRadius : null,
    cardHeight: card ? Math.round(card.getBoundingClientRect().height) : 0,
    iconSize: icon ? Math.round(icon.getBoundingClientRect().width) : 0,
    nameSize: name ? cs(name).fontSize : null,
    subSize: sub ? cs(sub).fontSize : null,
    headMinHeight: head ? cs(head).minHeight : null,
    chips: document.querySelectorAll('.svc-filterbar .chip, .filters .chip').length,
    dimmed: document.querySelectorAll('.svc-card.is-dim').length,
    cardHeights: [...document.querySelectorAll('.svc-card')].slice(0, 8)
      .map((el) => Math.round(el.getBoundingClientRect().height)),
  }
})

await open(null)
const light = await metrics()
await page.screenshot({ path: 'tmp/shot-services-light.png' })

// 点第一颗服务器标签 → 其余卡片压暗，再点回全部
const chip = page.locator('.filters .chip').nth(1)
const chipLabel = (await chip.innerText()).trim()
await chip.click()
await page.waitForTimeout(400)
const dimmedAfterChip = (await metrics()).dimmed
await page.screenshot({ path: 'tmp/shot-services-filtered.png' })
await page.locator('.filters .chip').first().click()
await page.waitForTimeout(400)
const dimmedAfterAll = (await metrics()).dimmed

// 点服务名 → 开服务抽屉
await page.locator('.svc-card-name').first().click()
await page.waitForTimeout(500)
const drawerOpen = await page.locator('.svc-drawer, .drawer, [role=dialog]').count()

await open('dark')
await page.screenshot({ path: 'tmp/shot-services-dark.png', fullPage: true })
await open('system')

await page.setViewportSize({ width: 1024, height: 800 })
await page.waitForTimeout(400)
const narrow = await metrics()
await page.screenshot({ path: 'tmp/shot-services-narrow.png' })

console.log(JSON.stringify({
  chipLabel,
  dimmedAfterChip,
  dimmedAfterAll,
  drawerNodes: drawerOpen,
  light,
  narrow,
  errors,
}, null, 1))
await browser.close()
