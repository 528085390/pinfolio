import { CHROME as exe } from '../chrome-path.mjs';

import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, locale: 'zh-CN' })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

await page.goto('http://127.0.0.1:7788/', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
await page.screenshot({ path: 'tmp/shot-notes.png' })

await page.click('button[title="资产台账"]')
await page.waitForTimeout(700)
await page.screenshot({ path: 'tmp/shot-assets.png' })

const card = page.locator('.asset-card').first()
if (await card.count()) {
  await card.click()
  await page.waitForTimeout(700)
  await page.screenshot({ path: 'tmp/shot-drawer.png' })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
}

await page.click('button[title="设置"]')
await page.waitForTimeout(600)
await page.screenshot({ path: 'tmp/shot-settings.png' })

await page.keyboard.press('Control+k')
await page.waitForTimeout(400)
await page.screenshot({ path: 'tmp/shot-palette.png' })
await page.keyboard.press('Escape')

// dark mode
await page.evaluate(() => localStorage.setItem('pinboard-theme', 'dark'))
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(700)
await page.screenshot({ path: 'tmp/shot-dark.png' })
await page.evaluate(() => localStorage.setItem('pinboard-theme', 'system'))

console.log('ERRORS:', errors.length ? JSON.stringify(errors, null, 1) : 'none')
await browser.close()
