import { CHROME as exe } from '../chrome-path.mjs';
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: exe })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, locale: 'zh-CN' })).newPage()
const errs = []
page.on('pageerror', e => errs.push(e.message))
await page.goto('http://127.0.0.1:7788/', { waitUntil: 'networkidle' })
await page.waitForTimeout(700)
await page.screenshot({ path: 'tmp/shot-after-move.png' })
console.log('title:', await page.title(), '| errors:', errs.length ? errs : 'none')
await browser.close()
