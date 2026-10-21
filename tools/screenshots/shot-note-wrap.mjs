// 验收：卡片「本次观测情况」在课程名较长时自动换行（不再单行省略）
import { chromium } from 'playwright-core'

const BASE = 'http://127.0.0.1:7788'
const exe = 'C:\\Users\\you\\AppData\\Local\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe'

const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'zh-CN' })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

await page.goto(BASE + '/monitors', { waitUntil: 'networkidle' })
await page.waitForSelector('.monitor-card')
await page.waitForTimeout(600)

const idx = await page.locator('.monitor-card').evaluateAll((els) =>
  els.findIndex((el) => el.querySelector('.asset-name')?.textContent?.trim() === 'yb 签到控制台'))
console.log('卡片 index = ' + idx)
const card = page.locator('.monitor-card').nth(idx)
const note = card.locator('.monitor-note')
console.log('note 数量 = ' + await note.count())

const info = await card.locator('.monitor-note-text').evaluate((el) => {
  const cs = getComputedStyle(el)
  const lh = parseFloat(cs.lineHeight)
  return {
    text: el.textContent,
    whiteSpace: cs.whiteSpace,
    textOverflow: cs.textOverflow,
    height: el.getBoundingClientRect().height,
    lineHeight: lh,
    lines: Math.round(el.getBoundingClientRect().height / lh),
    cardHeight: el.closest('.monitor-card').getBoundingClientRect().height,
  }
})
console.log(JSON.stringify(info, null, 1))
await card.screenshot({ path: 'tmp/shot-note-wrap-card.png' })
await page.locator('.monitor-grid').screenshot({ path: 'tmp/shot-note-wrap-grid.png' })
console.log('errors: ' + (errors.length ? errors.join(' | ') : 'none'))
await browser.close()
