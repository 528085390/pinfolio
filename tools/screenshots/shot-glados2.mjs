import { CHROME as exe } from '../chrome-path.mjs';
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto('http://127.0.0.1:7788/', { waitUntil: 'networkidle' })
await page.getByText('资产', { exact: true }).first().click()
await page.waitForTimeout(800)
const card = page.locator('.asset-card', { hasText: 'GLaDOS' }).first()
await card.screenshot({ path: 'tmp/shot-glados-v2-card.png' })
await card.click()
await page.waitForTimeout(700)
await page.locator('.drawer').first().screenshot({ path: 'tmp/shot-glados-v2-drawer.png' })
console.log('ok')
await browser.close()
