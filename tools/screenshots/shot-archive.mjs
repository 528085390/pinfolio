import { CHROME as exe } from '../chrome-path.mjs';
import { chromium } from 'playwright-core'

const BASE = 'http://127.0.0.1:7788'
const api = async (p, o = {}) => {
  const r = await fetch(BASE + '/api' + p, { headers: { 'content-type': 'application/json' }, ...o })
  return r.json()
}
const created = await api('/notes', { method: 'POST', body: JSON.stringify({ content: '归档演示：这条便签点「归档」后就会从默认列表消失 #整理' }) })

const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, locale: 'zh-CN' })
page.on('dialog', (d) => d.accept())
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(900)
await page.screenshot({ path: 'tmp/shot-archive-1.png' })

await page.locator('.note', { hasText: '归档演示' }).first().locator('button[title="归档"]').click()
await page.waitForTimeout(900)
await page.click('.filters button:has-text("已归档")')
await page.waitForTimeout(900)
await page.screenshot({ path: 'tmp/shot-archive-2.png' })

await browser.close()
await api('/notes/' + created.id, { method: 'DELETE' })
console.log('done', created.id)
