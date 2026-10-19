import { chromium } from 'playwright-core'
const exe = 'C:\\Users\\you\\AppData\\Local\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe'
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, locale: 'zh-CN' })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
const fails = []
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg) }

await page.goto('http://127.0.0.1:7788/', { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.click('button[title="资产台账"]')
await page.waitForTimeout(800)

// 1. 标签栏存在，且默认选中「全部标签」
ok(await page.locator('.tag-bar').count() === 1, 'tag bar rendered')
ok((await page.locator('.tag-bar .chip.active').innerText()).replace(/\s+/g, '') === '全部标签', 'default chip = 全部标签')

// 2. 旧的下拉框已移除
ok(await page.locator('select option', { hasText: '所有标签' }).count() === 0, 'old 所有标签 dropdown gone')

// 3. 所有有资产的标签都出现，且带数量、按数量降序
const chips = await page.locator('.tag-bar .chip').allInnerTexts()
console.log('chips:', JSON.stringify(chips))
const parsed = chips.slice(1).map((t) => {
  const m = t.replace(/\s+/g, ' ').trim().match(/^#(.+?)\s*(\d+)$/)
  return m ? { name: m[1], n: Number(m[2]) } : { name: t, n: -1 }
})
ok(parsed.length === 9, '9 tags with assets listed (got ' + parsed.length + ')')
ok(parsed.every((p) => p.n >= 1), 'every chip shows a count')
const counts = parsed.map((p) => p.n)
ok(counts.every((n, i) => i === 0 || counts[i - 1] >= n), 'sorted by count desc: ' + JSON.stringify(counts))
ok(parsed[0].name === '运维' && parsed[0].n === 7, 'top tag = 运维 7')

// 4. 点 #代理 只显示共享该标签的三条资产
await page.locator('.tag-bar .chip', { hasText: '代理' }).first().click()
await page.waitForTimeout(700)
const names = (await page.locator('.asset-name').allInnerTexts()).sort()
console.log('filtered:', JSON.stringify(names))
ok(names.length === 3, '代理 filter -> 3 assets')
ok(names.some((n) => n.includes('GLaDOS')) && names.some((n) => n.includes('aws-oregon')) && names.some((n) => n.includes('oracle-proxy')),
  '代理 covers GLaDOS + aws-oregon 节点 + oracle-proxy 节点')
await page.screenshot({ path: 'tmp/shot-tagbar-代理.png', fullPage: true })

// 5. 再点一次取消筛选
await page.locator('.tag-bar .chip', { hasText: '代理' }).first().click()
await page.waitForTimeout(700)
ok(await page.locator('.asset-card').count() === 10, 'unfiltered -> 10 cards')
await page.screenshot({ path: 'tmp/shot-tagbar-all.png', fullPage: true })

console.log('ERRORS:', errors.length ? JSON.stringify(errors) : 'none')
console.log(fails.length ? 'FAILED: ' + fails.length : 'ALL GREEN')
await browser.close()
process.exit(fails.length ? 1 : 0)
