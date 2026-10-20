import { chromium } from 'playwright-core'
import { startFakeImap } from './fakeimap/server.mjs'

const exe = 'C:\\Users\\you\\AppData\\Local\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe'
const B = 'http://127.0.0.1:7788'
const fake = await startFakeImap(120)

const accs = (await (await fetch(B + '/api/mail/accounts')).json()).accounts
for (const a of accs) await fetch(B + '/api/mail/accounts/' + a.id, { method: 'DELETE' })
await fetch(B + '/api/mail/local-read?account=all', { method: 'DELETE' })
const created = await (await fetch(B + '/api/mail/accounts', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ label: '工作邮箱', email: 'me@example.com', host: '127.0.0.1', port: fake.port, username: 'testuser', password: 'testpass', security: 'none' }),
})).json()

const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'zh-CN' })
const page = await ctx.newPage()

async function inbox(theme) {
  await page.goto(B + '/mail', { waitUntil: 'networkidle' })
  await page.evaluate((t) => localStorage.setItem('pinboard-theme', t), theme)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.querySelectorAll('.mail-row').length === 50, null, { timeout: 20000 })
  await page.locator('.mail-row').nth(0).click()
  await page.waitForSelector('.mail-html', { timeout: 15000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'shot-mail-inbox-' + theme + '.png' })
}

await inbox('light')
await page.locator('.mail-seg-btn', { hasText: '纯文本' }).click()
await page.waitForTimeout(300)
await page.screenshot({ path: 'shot-mail-text.png' })
await page.locator('.mail-tools button', { hasText: '邮箱' }).click()
await page.waitForTimeout(600)
await page.screenshot({ path: 'shot-mail-accounts.png' })
await page.locator('.drawer .mail-acc-item button', { hasText: '编辑' }).click()
await page.waitForTimeout(500)
await page.screenshot({ path: 'shot-mail-form.png' })
await page.locator('.drawer-head button').click()
await inbox('dark')

await browser.close()
fake.close()
console.log('shots done')
