// 截几张观测异常通知的图（浅色 / 深色 / 跳转到卡片）
import { chromium } from 'playwright-core'

const BASE = process.env.ALERT_E2E_BASE || 'http://127.0.0.1:7801'
const exe = 'C:\\Users\\you\\AppData\\Local\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe'
const OUT = 'docs\\screenshots\\'
const GRP = 'my-server (阿里云)'
const SHORT = 'my-server'

let seq = 100
const mk = (name, status) => ({
  id: seq++, name: SHORT + ' / ' + name, type: 'http', group: GRP, status,
  time: new Date().toISOString(), ping: status === 1 ? 42 : null,
  msg: status === 1 ? '200 - OK' : 'connect ECONNREFUSED 203.0.113.2:80',
  description: '', showMsg: false, active: true, interval: 60,
  uptime24: status === 1 ? 1 : 0.5, beats: [1, 1, 1, status === 1 ? 1 : 0],
  beatTones: [null, null, null, null], downCount: status === 1 ? 0 : 3,
  lastDown: status === 1 ? null : new Date().toISOString(), link: null,
})
const NAMES = ['app-api', 'nginx', '公网入口', 'app-manager', '真实 LLM 调用', 'xray']
const up = () => NAMES.map((n) => mk(n, 1))
const downSome = (names) => NAMES.map((n) => mk(n, names.includes(n) ? 0 : 1))
const payload = (monitors) => ({
  kuma: { base: 'http://127.0.0.1:3001', slug: 'obs', title: '观测' },
  updatedAt: new Date().toISOString(),
  summary: { total: monitors.length, up: monitors.filter((m) => m.status === 1).length, down: monitors.filter((m) => m.status === 0).length, pending: 0, uptime24: 0.987 },
  groups: [{ id: 1, name: GRP, monitors }],
})

const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
const page = await ctx.newPage()
let current = payload(up())
await page.route('**/api/monitors*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) }))
await page.clock.install()

const boot = async () => {
  await page.waitForSelector('.sidebar')
  await page.waitForTimeout(400)
}
const advance = async () => {
  await page.clock.fastForward(30500)
  await page.waitForTimeout(300)
}

// 浅色：3 条异常
await page.goto(BASE + '/notes', { waitUntil: 'domcontentloaded' })
await boot()
current = payload(downSome(['app-api', 'nginx', '公网入口']))
await advance()
await page.waitForSelector('.alert-item')
await page.screenshot({ path: OUT + 'monitor-alert.png' })
console.log('shot monitor-alert.png  alerts=' + await page.locator('.alert-item').count())

// 点通知 → 跳到卡片并高亮（恢复真实时间，让高亮动画真的在动）
await page.locator('.alert-item').first().click()
await page.waitForSelector('.monitor-card.flash')
await page.clock.resume()
await page.waitForTimeout(280)
await page.screenshot({ path: OUT + 'monitor-alert-jump.png' })
console.log('shot monitor-alert-jump.png  flash=' + await page.locator('.monitor-card.flash').count())

// 深色
await page.evaluate(() => localStorage.setItem('pinboard-theme', 'dark'))
current = payload(up())
await page.reload({ waitUntil: 'domcontentloaded' })
await boot()
current = payload(downSome(['app-api', 'nginx', '公网入口', 'xray', 'app-manager']))
await advance()
await page.waitForSelector('.alert-item')
await page.screenshot({ path: OUT + 'monitor-alert-dark.png' })
console.log('shot monitor-alert-dark.png  alerts=' + await page.locator('.alert-item').count() + ' more=' + ((await page.locator('.alert-more').textContent().catch(() => '')) || '').trim())

await browser.close()
