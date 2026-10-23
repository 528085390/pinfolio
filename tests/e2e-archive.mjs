import { BASE } from './env.mjs'
import { CHROME as exe } from '../tools/chrome-path.mjs';
import { login } from './login.mjs'
import { chromium } from 'playwright-core'
const B = BASE
const api = async (p, o) => { const r = await fetch(B + p, { headers: { 'Content-Type': 'application/json' }, ...o }); return r.json() }
const browser = await chromium.launch({ executablePath: exe })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1.5, locale: 'zh-CN' })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('dialog', (d) => d.accept())
const results = []
const ok = (name, cond, extra) => results.push((cond ? 'PASS ' : 'FAIL ') + name + (cond || !extra ? '' : '  → ' + extra))
const marker = 'E2E归档-' + Date.now()
const note = () => page.locator('.note', { hasText: marker }).first()
const count = () => page.locator('.note', { hasText: marker }).count()

async function step(name, fn) {
  try { await fn() } catch (e) { results.push('FAIL ' + name + ' 异常: ' + e.message) }
}

async function apiNotes(archived) {
  const rows = await api('/api/notes?archived=' + archived)
  return rows.filter((n) => n.content.includes(marker))
}

try {
  await login(page)
  await page.goto(B + '/', { waitUntil: 'networkidle' })

  // ---- 1. 默认列表：只有「归档」，没有「删除」 ----
  await page.fill('.composer textarea', marker + ' 归档测试')
  await page.click('.composer button:has-text("记下")')
  await page.waitForTimeout(700)
  ok('默认列表能看到新便签', await count() === 1)
  ok('默认列表卡片有「归档」按钮', await note().locator('button[title="归档"]').count() === 1)
  ok('默认列表没有硬删除按钮', await note().locator('button[title="删除"]').count() === 0)

  // ---- 2. 点归档：从默认列表消失，进入归档 ----
  await step('点归档', async () => { await note().locator('button[title="归档"]').click() })
  await page.waitForTimeout(800)
  ok('归档后默认列表不再显示', await count() === 0)
  ok('归档后接口 archived=1 能查到', (await apiNotes('1')).length === 1)
  ok('归档后接口 archived=0 查不到', (await apiNotes('0')).length === 0)

  // ---- 3. 「已归档」视图 ----
  await step('进归档视图', async () => { await page.click('.filters button:has-text("已归档")') })
  await page.waitForTimeout(800)
  ok('归档视图能看到该便签', await count() === 1)
  ok('归档视图隐藏输入框', await page.locator('.composer').count() === 0)
  ok('归档视图没有完成圆圈', await note().locator('.note-check').count() === 0)
  ok('归档视图没有置顶按钮', await note().locator('button[title="置顶"]').count() === 0)
  ok('归档视图没有编辑按钮', await note().locator('button[title="编辑"]').count() === 0)
  ok('归档视图有「恢复」按钮', await note().locator('button[title="恢复"]').count() === 1)
  ok('归档视图有「永久删除」按钮', await note().locator('button[title="永久删除"]').count() === 1)

  // ---- 4. 双击不切完成（只读） ----
  await step('双击卡片', async () => { await note().locator('.note-body').dblclick() })
  await page.waitForTimeout(600)
  ok('归档视图双击不标记完成', (await apiNotes('1'))[0].done === false)

  // ---- 5. 恢复 ----
  await step('点恢复', async () => { await note().locator('button[title="恢复"]').click() })
  await page.waitForTimeout(800)
  ok('恢复后归档视图不再显示', await count() === 0)
  ok('恢复后接口 archived=0 能查到', (await apiNotes('0')).length === 1)
  await page.click('.filters button:has-text("已归档")')
  await page.waitForTimeout(700)
  ok('退出归档视图后回到默认列表能看到', await count() === 1)

  // ---- 6. 永久删除只能在归档视图里做 ----
  await note().locator('button[title="归档"]').click()
  await page.waitForTimeout(700)
  await page.click('.filters button:has-text("已归档")')
  await page.waitForTimeout(700)
  await step('点永久删除', async () => { await note().locator('button[title="永久删除"]').click() })
  await page.waitForTimeout(800)
  ok('永久删除后归档视图里没了', await count() === 0)
  ok('永久删除后接口 archived=all 也查不到', (await apiNotes('all')).length === 0)

  // ---- 7. Ctrl+K 全局搜索不返回归档便签 ----
  if (await page.locator('.composer').count() === 0) {
    await page.click('.filters button:has-text("已归档")')
    await page.waitForTimeout(600)
  }
  const marker2 = marker + '-搜索'
  await page.fill('.composer textarea', marker2 + ' 搜索排除测试')
  await page.click('.composer button:has-text("记下")')
  await page.waitForTimeout(700)
  await page.locator('.note', { hasText: marker2 }).first().locator('button[title="归档"]').click()
  await page.waitForTimeout(800)
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(400)
  await page.fill('.palette-input', marker2)
  await page.waitForTimeout(900)
  const paletteHit = await page.locator('.palette-item', { hasText: marker2 }).count()
  await page.keyboard.press('Escape')
  ok('Ctrl+K 搜索不返回归档便签', paletteHit === 0)
} catch (e) {
  results.push('FAIL 脚本异常: ' + e.message)
} finally {
  console.log(results.join('\n'))
  console.log('ERRORS:', errors.length ? JSON.stringify(errors) : 'none')
  const all = await api('/api/notes?archived=all')
  for (const n of all) if (n.content.includes('E2E归档-')) await api('/api/notes/' + n.id, { method: 'DELETE' })
  console.log('cleaned')
  await browser.close()
}
