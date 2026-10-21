import { CHROME as exe } from '../chrome-path.mjs';
import { chromium } from 'playwright-core'

const B = 'http://127.0.0.1:7788'
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1.75, locale: 'zh-CN' })
const page = await ctx.newPage()
await page.goto(B + '/monitors', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.monitor-card', { timeout: 30000 })
await page.waitForTimeout(1200)
await page.locator('.monitor-card').first().click()
await page.waitForSelector('.drawer .monitor-drawer-now', { timeout: 20000 })
await page.waitForTimeout(800)
// 点一次立即观测，让逐步骤回显出现在截图里
await page.locator('.monitor-drawer-run').click()
await page.waitForSelector('.monitor-drawer-result', { timeout: 40000 })
await page.waitForTimeout(1200)
await page.screenshot({ path: 'tmp/shot-monitor-drawer.png' })
// 再拍一张删除确认态
await page.locator('.monitor-drawer-actions .btn-danger').click()
await page.waitForSelector('.monitor-drawer-confirm', { timeout: 10000 })
await page.waitForTimeout(400)
await page.screenshot({ path: 'tmp/shot-monitor-drawer-delete.png' })
console.log('shots done')
await browser.close()
