
import { chromium } from 'playwright-core'
const exe = 'C:\\Users\\you\\AppData\\Local\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe'
const browser = await chromium.launch({ executablePath: exe })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto('http://127.0.0.1:7788/', { waitUntil: 'networkidle' })
await page.keyboard.press('Control+k')
await page.waitForTimeout(400)
const info = await page.evaluate(() => {
  const list = document.querySelector('.palette-list')
  const item = document.querySelector('.palette-item')
  const g = (el) => { const s = getComputedStyle(el); return { display: s.display, width: s.width, inlineSize: s.inlineSize, alignItems: s.alignItems, flexDirection: s.flexDirection } }
  return { list: g(list), item: g(item), listRect: list.getBoundingClientRect().toJSON(), itemRect: item.getBoundingClientRect().toJSON() }
})
console.log(JSON.stringify(info, null, 1))
await browser.close()
