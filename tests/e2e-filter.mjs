import { CHROME as exe } from '../tools/chrome-path.mjs';
import { chromium } from 'playwright-core'
const B = 'http://127.0.0.1:7788'
const api = async (p, o) => { const r = await fetch(B + p, { headers: { 'Content-Type': 'application/json' }, ...o }); return r.json() }
const browser = await chromium.launch({ executablePath: exe })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1.5, locale: 'zh-CN' })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
const results = []
const ok = (name, cond) => results.push((cond ? 'PASS ' : 'FAIL ') + name)
const marker = 'E2E筛选-' + Date.now()
try {
  await page.goto(B + '/', { waitUntil: 'networkidle' })
  await page.fill('.composer textarea', marker + ' 筛选测试')
  await page.click('.composer button:has-text("记下")')
  await page.waitForTimeout(700)
  await page.locator('.note', { hasText: marker }).first().locator('.note-body').dblclick()
  await page.waitForTimeout(600)
  await page.click('.filters button:has-text("已完成")')
  await page.waitForTimeout(700)
  ok('已完成视图里能看到', await page.locator('.note', { hasText: marker }).count() === 1)
  await page.locator('.note', { hasText: marker }).first().locator('.note-check').click()
  await page.waitForTimeout(800)
  ok('取消完成后立刻离开已完成视图', await page.locator('.note', { hasText: marker }).count() === 0)
  await page.click('.filters button:has-text("未完成")')
  await page.waitForTimeout(700)
  ok('未完成视图里出现', await page.locator('.note', { hasText: marker }).count() === 1)
  await page.locator('.note', { hasText: marker }).first().locator('.note-body').dblclick()
  await page.waitForTimeout(800)
  ok('双击完成后离开未完成视图', await page.locator('.note', { hasText: marker }).count() === 0)
} catch (e) {
  results.push('FAIL 脚本异常: ' + e.message)
} finally {
  console.log(results.join('\n'))
  console.log('ERRORS:', errors.length ? JSON.stringify(errors) : 'none')
  const notes = await api('/api/notes?archived=all')
  for (const n of notes) if (n.content.includes('E2E筛选-')) await api('/api/notes/' + n.id, { method: 'DELETE' })
  console.log('cleaned')
  await browser.close()
}