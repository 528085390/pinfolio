import { BASE } from './env.mjs'
import { CHROME as exe } from '../tools/chrome-path.mjs';
import { login } from './login.mjs'
import { chromium } from 'playwright-core'
const B = BASE
const api = async (p, o) => { const r = await fetch(B + p, { headers: { 'Content-Type': 'application/json' }, ...o }); return r.json() }
const browser = await chromium.launch({ executablePath: exe })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1.5, locale: 'zh-CN' })).newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
const results = []
const ok = (name, cond) => results.push((cond ? 'PASS ' : 'FAIL ') + name)
const marker = 'E2E双击-' + Date.now()
try {
  await login(page)
  await page.goto(B + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  await page.fill('.composer textarea', marker + ' 双击我试试')
  await page.click('.composer button:has-text("记下")')
  await page.waitForTimeout(700)
  const card = page.locator('.note', { hasText: marker }).first()
  ok('新便签出现', await card.count() === 1)

  await card.locator('.note-body').dblclick()
  await page.waitForTimeout(700)
  ok('双击正文 -> 变成已完成', await page.locator('.note.done', { hasText: marker }).count() === 1)
  ok('出现已完成胶囊', await page.locator('.note', { hasText: marker }).locator('.done-pill').count() === 1)
  const selText = await page.evaluate(() => (window.getSelection() || '').toString())
  ok('双击后没有残留选中文字', selText === '')
  await page.screenshot({ path: 'tmp/shot-dblclick-done.png' })

  await page.locator('.note', { hasText: marker }).first().locator('.note-body').dblclick()
  await page.waitForTimeout(700)
  ok('再双击 -> 回到未完成', await page.locator('.note.done', { hasText: marker }).count() === 0)

  await page.locator('.note', { hasText: marker }).first().locator('.note-check').dblclick()
  await page.waitForTimeout(700)
  ok('双击圆圈不会误切换（两次点击互相抵消）', await page.locator('.note.done', { hasText: marker }).count() === 0)

  await page.locator('.note', { hasText: marker }).first().locator('.note-check').click()
  await page.waitForTimeout(600)
  ok('单击圆圈仍然可用', await page.locator('.note.done', { hasText: marker }).count() === 1)
  await page.locator('.note', { hasText: marker }).first().locator('.note-check').click()
  await page.waitForTimeout(600)

  await page.locator('.note', { hasText: marker }).first().locator('button[title="编辑"]').click()
  await page.waitForTimeout(400)
  const ta = page.locator('.note', { hasText: marker }).first().locator('textarea')
  await ta.dblclick()
  await page.waitForTimeout(600)
  ok('编辑态下双击不会误切换', await page.locator('.note.done', { hasText: marker }).count() === 0)
  await page.keyboard.press('Escape')
} catch (e) {
  results.push('FAIL 脚本异常: ' + e.message)
} finally {
  console.log(results.join('\n'))
  console.log('ERRORS:', errors.length ? JSON.stringify(errors) : 'none')
  const notes = await api('/api/notes?archived=all')
  for (const n of notes) if (n.content.includes('E2E双击-')) await api('/api/notes/' + n.id, { method: 'DELETE' })
  console.log('cleaned')
  await browser.close()
}