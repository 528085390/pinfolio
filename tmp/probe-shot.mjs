import { chromium } from 'playwright-core'
const EXE = 'C:\\Users\\you\\AppData\\Local\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe'
const browser = await chromium.launch({ executablePath: EXE })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
await page.goto('http://127.0.0.1:7788/mail', { waitUntil: 'networkidle' })
await page.waitForSelector('.mail-row', { timeout: 15000 })
// 选一封图片最多的（Google AI Studio 欢迎信，uid 16）
const rows = await page.$$('.mail-row')
for (const r of rows) {
  const t = (await r.innerText()).replace(/\s+/g, ' ')
  if (t.includes('Google AI Studi')) { await r.click(); break }
}
await page.waitForSelector('.mail-html', { timeout: 20000 })
await page.waitForTimeout(1200)
await page.screenshot({ path: 'tmp/shot-blocked.png' })

const info = await page.evaluate(() => {
  const body = document.querySelector('.mail-reader-body')
  const imgs = [...document.querySelectorAll('.mail-html img')]
  const alts = imgs.map((i) => i.getAttribute('alt'))
  return {
    imgs: imgs.length,
    withSrc: imgs.filter((i) => i.getAttribute('src')).length,
    altBlocked: alts.filter((a) => a === '图片已拦截').length,
    altSample: alts.slice(0, 6),
    bodyTextLen: (body?.innerText || '').length,
    bodyTextHead: (body?.innerText || '').replace(/\s+/g, ' ').slice(0, 200),
    btn: [...document.querySelectorAll('.mail-viewbar button')].map((b) => b.innerText.trim()),
    // 图片在页面里占的视觉高度
    imgBoxes: imgs.slice(0, 8).map((i) => { const r = i.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height) }),
  }
})
console.log('BEFORE', JSON.stringify(info, null, 1))

const btn = page.locator('.mail-viewbar button', { hasText: '显示图片' })
if (await btn.count()) {
  await btn.first().click()
  await page.waitForTimeout(2500)
  const after = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('.mail-html img')]
    return {
      imgs: imgs.length,
      loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
      broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).length,
      srcSample: imgs.slice(0, 3).map((i) => (i.getAttribute('src') || '').slice(0, 90)),
      btn: [...document.querySelectorAll('.mail-viewbar button')].map((b) => b.innerText.trim()),
      hint: [...document.querySelectorAll('.mail-hint')].map((h) => h.innerText),
    }
  })
  console.log('AFTER', JSON.stringify(after, null, 1))
  await page.screenshot({ path: 'tmp/shot-shown.png' })
}
console.log('ERRS', JSON.stringify(errs.slice(0, 6)))
await browser.close()
