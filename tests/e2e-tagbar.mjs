import { BASE } from './env.mjs'
import { CHROME as exe } from '../tools/chrome-path.mjs';
import { login } from './login.mjs'
import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, locale: 'zh-CN' })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
const fails = []
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg) }

await login(page)
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
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
// 期望值从 API 取，避免每加一条资产就要手改这个数（2026-10-21 华为云代金券入库后旧硬编码就红了）
const apiTags = await (await page.request.get(BASE + '/api/tags')).json()
const expectedTags = apiTags.filter((t) => (t.assets || 0) > 0).length
ok(parsed.length === expectedTags, expectedTags + ' tags with assets listed (got ' + parsed.length + ')')
ok(parsed.every((p) => p.n >= 1), 'every chip shows a count')
const counts = parsed.map((p) => p.n)
ok(counts.every((n, i) => i === 0 || counts[i - 1] >= n), 'sorted by count desc: ' + JSON.stringify(counts))
const maxAssets = Math.max(...apiTags.map((t) => t.assets || 0))
const topNames = apiTags.filter((t) => (t.assets || 0) === maxAssets).map((t) => t.name)
ok(topNames.includes(parsed[0].name) && parsed[0].n === maxAssets, 'top tag = ' + parsed[0].name + ' ' + parsed[0].n + '（并列最大: ' + topNames.join('/') + '）')

// 4. 点排第一的那个标签，只显示共享该标签的资产
// 标签名不能写死（CI 上是全新库，只有预设标签 + 示例资产，没有作者本机的 #代理）：
// 取 API 里资产数最多的那个标签，和上面 parsed[0] 是同一个。
const topTag = parsed[0].name
const topChip = page.locator('.tag-bar .chip').nth(1)
await topChip.click()
await page.waitForTimeout(700)
const names = (await page.locator('.asset-name').allInnerTexts()).sort()
console.log('filtered by #' + topTag + ':', JSON.stringify(names))
// 条数与名字都从 API 取：资产会随用户增删/改名变动（2026-10-21 三台 Oracle 拆成 oj/os/ox 后旧的硬编码就红了）
const proxyAssets = await (await page.request.get(BASE + '/api/assets?tag=' + encodeURIComponent(topTag))).json()
const proxyNames = proxyAssets.map((a) => a.name).sort()
ok(names.length === proxyNames.length, '#' + topTag + ' filter -> ' + proxyNames.length + ' assets (got ' + names.length + ')')
ok(JSON.stringify(names) === JSON.stringify(proxyNames), '#' + topTag + ' 列表与 API 一致: ' + proxyNames.join(' / '))
await page.screenshot({ path: 'tmp/shot-tagbar-top.png', fullPage: true })

// 5. 再点一次取消筛选
await topChip.click()
await page.waitForTimeout(700)
const apiAssets = await (await page.request.get(BASE + '/api/assets')).json()
ok(await page.locator('.asset-card').count() === apiAssets.length, 'unfiltered -> ' + apiAssets.length + ' cards')
await page.screenshot({ path: 'tmp/shot-tagbar-all.png', fullPage: true })

console.log('ERRORS:', errors.length ? JSON.stringify(errors) : 'none')
console.log(fails.length ? 'FAILED: ' + fails.length : 'ALL GREEN')
await browser.close()
process.exit(fails.length ? 1 : 0)
