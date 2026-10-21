import { CHROME as exe } from '../tools/chrome-path.mjs';
// 便签 composer「标签」弹层：不能被滚动容器裁掉一半（2026-10-21 用户报「标签被遮住一半」）
import { chromium } from 'playwright-core'

const BASE = 'http://127.0.0.1:7788'
let pass = 0
const fails = []
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name) } else { fails.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')) }
}

const browser = await chromium.launch({ executablePath: exe })
const errors = []

async function measure(page) {
  await page.click('button[title="从已有标签里挑一个插进便签"]')
  await page.waitForTimeout(350)
  const m = await page.evaluate(() => {
    const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height } }
    const pop = document.querySelector('.tag-pop')
    const content = document.querySelector('.content')
    const list = document.querySelector('.tag-pop-list')
    const chips = [...document.querySelectorAll('.tag-pop-list .chip')]
    const pr = rect(pop)
    const mid = pr ? document.elementFromPoint((pr.left + pr.right) / 2, (pr.top + pr.bottom) / 2) : null
    return {
      viewport: { w: innerWidth, h: innerHeight },
      pop: pr, content: rect(content), head: rect(document.querySelector('.tag-pop-head')),
      list: rect(list), newBtn: rect(document.querySelector('.tag-pop-new')),
      first: rect(chips[0]), last: rect(chips[chips.length - 1]),
      firstText: chips[0]?.textContent, lastText: chips[chips.length - 1]?.textContent,
      chipCount: chips.length,
      midInsidePop: mid ? !!mid.closest('.tag-pop') : false,
      midText: mid ? (mid.textContent || '').slice(0, 24) : null,
      dir: pop ? (pop.classList.contains('tag-pop-down') ? 'down' : 'up') : null,
    }
  })
  return m
}

function assertAll(m, tagLabel) {
  ok(`[${tagLabel}] 弹层存在`, !!m.pop)
  ok(`[${tagLabel}] 没被滚动容器 .content 上边界裁掉`, m.pop.top >= m.content.top - 0.5, `pop.top=${m.pop.top} content.top=${m.content.top}`)
  ok(`[${tagLabel}] 没被 .content 下边界裁掉`, m.pop.bottom <= m.content.bottom + 0.5, `pop.bottom=${m.pop.bottom} content.bottom=${m.content.bottom}`)
  ok(`[${tagLabel}] 完整在视口内`, m.pop.top >= -0.5 && m.pop.bottom <= m.viewport.h + 0.5, `top=${m.pop.top} bottom=${m.pop.bottom} vh=${m.viewport.h}`)
  ok(`[${tagLabel}] 标题在弹层可见区`, m.head.top >= m.pop.top - 0.5 && m.head.bottom <= m.pop.bottom + 0.5)
  ok(`[${tagLabel}] 「新建标签…」在弹层可见区`, m.newBtn.top >= m.pop.top - 0.5 && m.newBtn.bottom <= m.pop.bottom + 0.5, `newBtn=${JSON.stringify(m.newBtn)} pop=${JSON.stringify(m.pop)}`)
  ok(`[${tagLabel}] 第一个 chip 完整可见（不是半行）`, m.first.top >= Math.max(m.list.top, m.pop.top) - 0.5 && m.first.bottom <= Math.min(m.list.bottom, m.pop.bottom) + 0.5, `first=${JSON.stringify(m.first)} list=${JSON.stringify(m.list)} pop.top=${m.pop.top}`)
  ok(`[${tagLabel}] 弹层没被便签卡片盖住`, m.midInsidePop === true, '命中：' + m.midText)
  ok(`[${tagLabel}] 27 个标签都在 DOM 里`, m.chipCount >= 20, 'chipCount=' + m.chipCount)
}

for (const vp of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 1280, height: 420 }]) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'zh-CN' })
  const page = await ctx.newPage()
  page.on('console', (mm) => { if (mm.type() === 'error') errors.push('console: ' + mm.text()) })
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  await page.goto(BASE + '/notes', { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)

  const label = vp.width + 'x' + vp.height
  const m = await measure(page)
  console.log('[' + label + '] ' + JSON.stringify({ dir: m.dir, pop: m.pop, content: m.content }))
  assertAll(m, label)

  // 列表内部滚到最后一条，且最后一条完整可见
  const lastReach = await page.evaluate(() => {
    const list = document.querySelector('.tag-pop-list')
    list.scrollTop = list.scrollHeight
    const chips = [...document.querySelectorAll('.tag-pop-list .chip')]
    const last = chips[chips.length - 1]
    const lb = list.getBoundingClientRect(); const b = last.getBoundingClientRect()
    const pb = document.querySelector('.tag-pop').getBoundingClientRect()
    return { okTop: b.top >= Math.max(lb.top, pb.top) - 0.5, okBottom: b.bottom <= Math.min(lb.bottom, pb.bottom) + 0.5, text: last.textContent, scrollTop: list.scrollTop }
  })
  ok(`[${label}] 列表能滚到最后一条且完整可见`, lastReach.okTop && lastReach.okBottom, JSON.stringify(lastReach))

  // 点标签要能插进输入框并关掉弹层
  await page.evaluate(() => { document.querySelector('.tag-pop-list').scrollTop = 0 })
  await page.waitForTimeout(120)
  const firstName = m.firstText.replace(/^#/, '')
  await page.click('.tag-pop-list .chip >> nth=0')
  await page.waitForTimeout(250)
  const after = await page.evaluate(() => ({ draft: document.querySelector('.composer textarea')?.value || '', popGone: !document.querySelector('.tag-pop') }))
  ok(`[${label}] 点标签后插进输入框`, after.draft.includes('#' + firstName), 'draft=' + JSON.stringify(after.draft))
  ok(`[${label}] 点标签后弹层关闭`, after.popGone === true)

  // 矮窗口（弹层被压到很小）：列表必须自己滚，标题和「新建标签…」不能被滚走
  if (vp.height === 420) {
    const tight = await page.evaluate(async () => {
      document.querySelector('button[title="从已有标签里挑一个插进便签"]').click()
      await new Promise((r) => setTimeout(r, 300))
      const pop = document.querySelector('.tag-pop')
      const list = document.querySelector('.tag-pop-list')
      const pb = pop.getBoundingClientRect(); const lb = list.getBoundingClientRect()
      const head = document.querySelector('.tag-pop-head').getBoundingClientRect()
      const nb = document.querySelector('.tag-pop-new').getBoundingClientRect()
      const before = { listScrolls: list.scrollHeight > list.clientHeight + 1, headInPop: head.top >= pb.top - 0.5 && head.bottom <= pb.bottom + 0.5, newInPop: nb.top >= pb.top - 0.5 && nb.bottom <= pb.bottom + 0.5, popBottom: pb.bottom, contentBottom: document.querySelector('.content').getBoundingClientRect().bottom, listTop: lb.top, listBottom: lb.bottom, headTop: head.top, newTop: nb.top, popTop: pb.top }
      list.scrollTop = list.scrollHeight
      await new Promise((r) => setTimeout(r, 100))
      const head2 = document.querySelector('.tag-pop-head').getBoundingClientRect()
      const nb2 = document.querySelector('.tag-pop-new').getBoundingClientRect()
      return { ...before, afterScroll: { headSame: Math.abs(head2.top - before.headTop) < 0.5, newSame: Math.abs(nb2.top - before.newTop) < 0.5 } }
    })
    ok(`[${label}] 矮窗口里弹层没超出 .content`, tight.popBottom <= tight.contentBottom + 0.5, JSON.stringify(tight))
    ok(`[${label}] 矮窗口里列表自己滚（标题/按钮固定）`, tight.listScrolls === true && tight.headInPop && tight.newInPop && tight.afterScroll.headSame && tight.afterScroll.newSame, JSON.stringify(tight))
  }
  if (vp.width === 1440) await page.screenshot({ path: 'tmp/shot-tagpop-fixed.png' })
  await ctx.close()
}

// 便签写了很多行（composer 变高、上方空间足够）时应该改回往上展开，且同样不能被裁
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  page.on('console', (mm) => { if (mm.type() === 'error') errors.push('console: ' + mm.text()) })
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  await page.goto(BASE + '/notes', { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  // 用真实键盘输入（fill 不会触发 React 的 onChange，textarea 不会自动长高）
  await page.click('.composer textarea')
  await page.keyboard.type(Array.from({ length: 16 }, (_, i) => '第' + (i + 1) + '行').join('\n'))
  await page.waitForTimeout(400)
  const m2 = await measure(page)
  console.log('[长草稿] ' + JSON.stringify({ dir: m2.dir, pop: m2.pop }))
  ok('[长草稿] 空间够时改为往上展开', m2.dir === 'up', 'dir=' + m2.dir)
  assertAll(m2, '长草稿')
  await page.screenshot({ path: 'tmp/shot-tagpop-up.png' })
  await ctx.close()
}

ok('没有 console 报错', errors.length === 0, errors.join(' | '))
await browser.close()
console.log('\n通过 ' + pass + ' 条，失败 ' + fails.length + ' 条')
if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1) }
