import { CHROME as exe } from '../tools/chrome-path.mjs';
import { login } from './login.mjs'
import { chromium } from 'playwright-core'
const B = 'http://127.0.0.1:7788'
const api = async (p, o) => { const r = await fetch(B + p, { headers: { 'Content-Type': 'application/json' }, ...o }); return r.json() }
const browser = await chromium.launch({ executablePath: exe })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1.5, locale: 'zh-CN' })).newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
const results = []
const ok = (name, cond) => results.push((cond ? 'PASS ' : 'FAIL ') + name)
const marker = 'E2E完成-' + Date.now()
try {
  await login(page)
  await page.goto(B + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  await page.fill('.composer textarea', marker + ' #测试')
  await page.click('.composer button:has-text("记下")')
  await page.waitForTimeout(700)
  ok('新便签出现', await page.locator('.note', { hasText: marker }).count() === 1)

  await page.locator('.note', { hasText: marker }).first().locator('.note-check').click()
  await page.waitForTimeout(600)
  ok('点击圆圈后出现已完成标记', await page.locator('.note', { hasText: marker }).locator('.done-pill').count() === 1)
  ok('完成便签有 done 类', await page.locator('.note.done', { hasText: marker }).count() === 1)
  await page.screenshot({ path: 'tmp/shot-done-note.png' })

  await page.click('.filters button:has-text("已完成")')
  await page.waitForTimeout(600)
  ok('已完成筛选能看到它', await page.locator('.note', { hasText: marker }).count() === 1)
  await page.screenshot({ path: 'tmp/shot-done-filter.png' })
  await page.click('.filters button:has-text("未完成")')
  await page.waitForTimeout(600)
  ok('未完成筛选看不到它', await page.locator('.note', { hasText: marker }).count() === 0)
  await page.click('.filters button:has-text("已完成")')
  await page.waitForTimeout(500)
  await page.locator('.note', { hasText: marker }).locator('.note-check').click()
  await page.waitForTimeout(600)
  ok('改回未完成后从已完成列表消失', await page.locator('.note', { hasText: marker }).count() === 0)
  await page.click('.filters button:has-text("全部")')
  await page.waitForTimeout(500)
  ok('回到全部能看到且无 done 标记', await page.locator('.note.done', { hasText: marker }).count() === 0)

  await page.click('.composer button:has-text("标签")')
  await page.waitForTimeout(300)
  ok('标签弹层出现', await page.locator('.tag-pop').count() === 1)
  await page.screenshot({ path: 'tmp/shot-tag-pop.png' })
  await page.locator('.tag-pop .chip', { hasText: '待办' }).first().click()
  await page.waitForTimeout(300)
  const draft = await page.inputValue('.composer textarea')
  ok('点标签后插入了 #待办', draft.includes('#待办'))

  await page.click('.filters button:has-text("新标签")')
  await page.waitForTimeout(300)
  await page.fill('.modal-card input[placeholder="例如：待办"]', 'E2E新标签')
  await page.click('.modal-card button:has-text("创建")')
  await page.waitForTimeout(800)
  const draft2 = await page.inputValue('.composer textarea')
  ok('新建标签后自动插入', draft2.includes('#E2E新标签'))
  const tags = await api('/api/tags')
  ok('新标签写进了库', tags.some((t) => t.name === 'E2E新标签'))
} catch (e) {
  results.push('FAIL 脚本异常: ' + e.message)
} finally {
  console.log(results.join('\n'))
  console.log('ERRORS:', errors.length ? JSON.stringify(errors) : 'none')
  const notes = await api('/api/notes?archived=all')
  for (const n of notes) if (n.content.includes('E2E完成-')) await api('/api/notes/' + n.id, { method: 'DELETE' })
  const tags = await api('/api/tags')
  for (const t of tags) if (t.name === 'E2E新标签' || t.name === '测试') await api('/api/tags/' + t.id, { method: 'DELETE' })
  console.log('cleaned')
  await browser.close()
}