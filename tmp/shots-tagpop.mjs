// 标签弹层修复后的截图：给用户看的局部大图 + README 用的整屏图
import { chromium } from 'playwright-core'
const exe = 'C:\\Users\\you\\AppData\\Local\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe'
const browser = await chromium.launch({ executablePath: exe })

// 1) README 用的整屏图（与其它截图一致的 1440x900 @1.5x）
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await page.goto('http://127.0.0.1:7788/notes', { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  await page.click('button[title="从已有标签里挑一个插进便签"]')
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'docs/screenshots/tag-picker.png' })
  await ctx.close()
}

// 2) 给用户看的局部大图（2x）
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await page.goto('http://127.0.0.1:7788/notes', { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  await page.click('button[title="从已有标签里挑一个插进便签"]')
  await page.waitForTimeout(400)
  const box = await page.evaluate(() => {
    const pop = document.querySelector('.tag-pop').getBoundingClientRect()
    return { x: Math.max(0, pop.left - 24), y: Math.max(0, pop.top - 24), width: pop.width + 48, height: pop.height + 48 }
  })
  await page.screenshot({ path: 'tmp/shot-tagpop-fixed.png', clip: box })
  console.log('clip=' + JSON.stringify(box))
  await ctx.close()
}
await browser.close()
