
import { chromium } from 'playwright-core'
const exe = 'C:\\Users\\you\\AppData\\Local\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe'
const browser = await chromium.launch({ executablePath: exe })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage()
page.on('pageerror', (e) => console.log('[pageerror]', e.stack || e.message))
await page.goto('http://127.0.0.1:7788/', { waitUntil: 'networkidle' })
await page.click('button[title="资产台账"]')
await page.waitForTimeout(500)
await page.locator('.asset-card').first().click()
await page.waitForTimeout(900)
await browser.close()
