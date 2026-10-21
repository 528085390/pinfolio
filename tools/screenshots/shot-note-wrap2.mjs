import { CHROME as exe } from '../chrome-path.mjs';
// 验证换行：把卡片那行字换成更长的课程名，看它是否换行而不是截断
import { chromium } from 'playwright-core'

const BASE = 'http://127.0.0.1:7788'

const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'zh-CN' })
const page = await ctx.newPage()
await page.goto(BASE + '/monitors', { waitUntil: 'networkidle' })
await page.waitForSelector('.monitor-card')
const idx = await page.locator('.monitor-card').evaluateAll((els) =>
  els.findIndex((el) => el.querySelector('.asset-name')?.textContent?.trim() === 'yb 签到控制台'))
const card = page.locator('.monitor-card').nth(idx)

for (const [label, text] of [
  ['中长', '10-20 第3节 大学生心理健康教育 签到成功'],
  ['长', '10-20 第3节 大学生心理健康教育（含实践教学环节与线上答疑） 签到成功'],
]) {
  const info = await card.locator('.monitor-note-text').evaluate((el, t) => {
    el.textContent = t
    const cs = getComputedStyle(el)
    const lh = parseFloat(cs.lineHeight)
    const h = el.getBoundingClientRect().height
    return { text: t, lines: Math.round(h / lh), height: Math.round(h), clamped: el.scrollHeight > h + 1 }
  }, text)
  console.log(label + ': ' + JSON.stringify(info))
  await card.screenshot({ path: 'tmp/shot-note-wrap-' + label + '.png' })
}
await browser.close()
