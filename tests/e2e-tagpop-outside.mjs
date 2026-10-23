import { BASE } from './env.mjs'
import { CHROME as exe } from '../tools/chrome-path.mjs';
import { login } from './login.mjs'
// 便签 composer「标签」弹层：点标签栏以外 / Esc / 页面滚动 都要自动收起（2026-10-21 用户要求）
import { chromium } from 'playwright-core'

let pass = 0
const fails = []
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fails.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')) }
}

const browser = await chromium.launch({ executablePath: exe })
const errors = []
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'zh-CN' })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
await login(page)
await page.goto(BASE + '/notes', { waitUntil: 'networkidle' })
await page.waitForTimeout(400)

const TAG_BTN = 'button[title="从已有标签里挑一个插进便签"]'
const isOpen = async () => (await page.locator('.tag-pop').count()) === 1
async function openPop() {
  // 断言失败时弹层可能还开着，先归一化，保证每次都是「从关到开」
  if (await isOpen()) { await page.click(TAG_BTN); await page.waitForTimeout(200) }
  await page.click(TAG_BTN)
  await page.waitForTimeout(320)
  return isOpen()
}
async function clickEl(sel) {
  const loc = page.locator(sel).first()
  if ((await loc.count()) === 0) return false
  const box = await loc.boundingBox()
  if (!box) return false
  await page.mouse.click(box.x + Math.min(box.width / 2, 12), box.y + box.height / 2)
  await page.waitForTimeout(260)
  return true
}
async function draftValue() { return page.locator('.composer textarea').inputValue() }

// 1. 基本：能开
ok('点「标签」按钮能打开弹层', await openPop())

// 2. 点 composer 提示文字（标签栏以外）
const hit2 = await clickEl('.composer-hint')
ok('点 composer 提示文字 → 弹层收起', hit2 && !(await isOpen()))

// 3. 点便签卡片正文（标签栏以外，也不该误触完成状态）
const before = await page.evaluate(() => document.querySelectorAll('.note.done').length)
await openPop()
const hit3 = await clickEl('.note .note-head span')
const after = await page.evaluate(() => document.querySelectorAll('.note.done').length)
ok('点便签卡片 → 弹层收起', hit3 && !(await isOpen()))
ok('点便签卡片不会顺手切换完成状态', before === after, before + ' → ' + after)

// 4. 点搜索框（标签栏以外）
await openPop()
const hit4 = await clickEl('.input.input-sm')
ok('点搜索框 → 弹层收起', hit4 && !(await isOpen()))

// 5. 点弹层内部标题区（不是 chip）不该收起
await openPop()
const hit5 = await clickEl('.tag-pop-head')
ok('点弹层内部标题 → 弹层仍然打开', hit5 && (await isOpen()))

// 6. 点弹层里的标签 chip：插进便签并收起
await page.evaluate(() => { const ta = document.querySelector('.composer textarea'); ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true })) })
const firstName = await page.locator('.tag-pop-list .chip').first().innerText()
await page.click('.tag-pop-list .chip')
await page.waitForTimeout(300)
const dv = await draftValue()
ok('点弹层里的标签 → 弹层收起', !(await isOpen()))
ok('点弹层里的标签 → 插进了输入框', dv.includes('#' + firstName.replace(/^#/, '').trim()), 'draft=' + JSON.stringify(dv) + ' chip=' + JSON.stringify(firstName))

// 7. 再点「标签」按钮是开关：关掉
await openPop()
await page.click(TAG_BTN)
await page.waitForTimeout(260)
ok('再点「标签」按钮 → 弹层收起', !(await isOpen()))

// 8. Esc 收起
await openPop()
await page.keyboard.press('Escape')
await page.waitForTimeout(260)
ok('按 Esc → 弹层收起', !(await isOpen()))

// 9. 滚动弹层自己的列表：不该收起
await openPop()
const listScrollable = await page.evaluate(() => {
  const l = document.querySelector('.tag-pop-list')
  l.scrollTop = l.scrollHeight
  return { sh: l.scrollHeight, ch: l.clientHeight }
})
await page.waitForTimeout(300)
ok('滚弹层自己的标签列表 → 弹层仍然打开', listScrollable.sh > listScrollable.ch ? (await isOpen()) : true, JSON.stringify(listScrollable))

// 10. 滚动页面 .content：收起（不够长就把视口压矮，保证真的能滚）
let scrollInfo = null
for (const h of [720, 560, 460, 380]) {
  await page.setViewportSize({ width: 1280, height: h })
  await page.waitForTimeout(220)
  scrollInfo = await page.evaluate(() => { const c = document.querySelector('.content'); return { sh: c.scrollHeight, ch: c.clientHeight } })
  if (scrollInfo.sh > scrollInfo.ch + 20) break
}
await openPop()
const scrollable = scrollInfo && scrollInfo.sh > scrollInfo.ch + 20
await page.evaluate(() => { const c = document.querySelector('.content'); c.scrollTop = 120 })
await page.waitForTimeout(300)
ok('滚页面 .content → 弹层收起', scrollable && !(await isOpen()), JSON.stringify(scrollInfo))

// 11. 收起后没有残留：再打开仍然正常
await page.setViewportSize({ width: 1280, height: 720 })
await page.waitForTimeout(220)
ok('收起后再打开仍然正常', await openPop())

ok('无 console / pageerror', errors.length === 0, errors.join(' | '))

await browser.close()
console.log('\n' + (fails.length === 0 ? '全部通过 ' + pass + '/' + pass : pass + ' 通过 / ' + fails.length + ' 失败'))
if (fails.length) { console.log('失败项：'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
