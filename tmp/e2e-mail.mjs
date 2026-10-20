import { chromium } from 'playwright-core'
import { startFakeImap } from './fakeimap/server.mjs'

const exe = 'C:\\Users\\you\\AppData\\Local\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe'
const B = 'http://127.0.0.1:7788'

const fake = await startFakeImap(120)
const PORT = fake.port

// 起始状态：清空邮箱账号与本地已读标记
const accs0 = (await (await fetch(B + '/api/mail/accounts')).json()).accounts
for (const a of accs0) await fetch(B + '/api/mail/accounts/' + a.id, { method: 'DELETE' })
await fetch(B + '/api/mail/local-read?account=all', { method: 'DELETE' })

const browser = await chromium.launch({ executablePath: exe })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1.5, locale: 'zh-CN' })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => {
  if (m.type() !== 'error') return
  // 「显示图片」故意去拉 track.example.com，拉不到是预期内的资源加载失败，不算页面报错
  if (/^Failed to load resource/.test(m.text())) return
  errors.push('console: ' + m.text())
})
page.on('dialog', (d) => d.accept())

const results = []
const ok = (name, cond, extra) => results.push((cond ? 'PASS ' : 'FAIL ') + name + (cond || !extra ? '' : '  → ' + extra))
async function step(name, fn) {
  try { await fn() } catch (e) { results.push('FAIL ' + name + ' 异常: ' + e.message) }
}
const rows = () => page.locator('.mail-row')
const subjOf = async (i) => (await rows().nth(i).locator('.mail-row-subject').innerText()).trim()
const waitRows = async (n) => {
  await page.waitForFunction((k) => document.querySelectorAll('.mail-row').length === k, n, { timeout: 15000 })
}
/** 等第一行主题变成期望值：翻页 / 切文件夹时 50 行没变，只等行数会拿到旧数据 */
const waitFirst = async (subject) => {
  await page.waitForFunction((t) => {
    const el = document.querySelector('.mail-row .mail-row-subject')
    return el && el.textContent.trim() === t
  }, subject, { timeout: 20000 })
}

try {
  // ---------- 1. 空态 + 侧栏位置 ----------
  await page.goto(B + '/mail', { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  ok('深链 /mail 停在邮件页', new URL(page.url()).pathname === '/mail', page.url())
  ok('标题是「邮件 · 便签夹」', (await page.title()).includes('邮件'), await page.title())
  ok('侧栏第 2 项是邮件', (await page.locator('.nav-item').nth(1).locator('.nav-label').innerText()).trim() === '邮件')
  ok('侧栏高亮邮件', (await page.locator('.nav-item.active .nav-label').first().innerText()).trim() === '邮件')
  ok('无账号时显示引导', (await page.locator('.empty-title').first().innerText()).includes('还没有添加邮箱'))

  // Ctrl+K 里也能进邮件页
  await page.keyboard.press('Control+k')
  await page.waitForSelector('.palette-wrap', { timeout: 5000 })
  ok('命令面板有「邮件」入口', (await page.locator('.palette-wrap').innerText()).includes('邮件'))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // ---------- 2. 添加账号（含连接测试） ----------
  await page.locator('.mail-page-empty .btn-primary').click()
  await page.waitForSelector('.drawer .mail-form', { timeout: 5000 })
  ok('打开添加邮箱抽屉', (await page.locator('.drawer .mail-form').count()) === 1)

  const inputs = page.locator('.mail-form-grid input')
  await inputs.nth(0).fill('测试邮箱')
  await inputs.nth(1).fill('me@example.com')
  await inputs.nth(2).fill('127.0.0.1')
  await inputs.nth(3).fill(String(PORT))
  await inputs.nth(4).fill('testuser')
  await inputs.nth(5).fill('testpass')
  await page.locator('.mail-form-grid select').selectOption('none')

  await page.locator('.drawer-foot button', { hasText: '测试连接' }).click()
  await page.waitForSelector('.mail-msg', { timeout: 15000 })
  const testMsg = await page.locator('.mail-msg').innerText()
  ok('连接测试成功并回显服务器名', testMsg.includes('连接成功') && testMsg.includes('hoodiecrow'), testMsg)

  await page.locator('.drawer-foot .btn-primary').click()
  await page.waitForSelector('.drawer .mail-acc-item', { timeout: 15000 })
  ok('添加后抽屉里出现账号', (await page.locator('.drawer .mail-acc-item').count()) === 1)
  await page.locator('.drawer-head button').click()
  await page.waitForTimeout(300)

  // ---------- 3. 列表 ----------
  await waitRows(50)
  ok('列表第一页 50 封', (await rows().count()) === 50, String(await rows().count()))
  ok('第一行是最新一封（120）', (await subjOf(0)) === '第 120 封邮件', await subjOf(0))
  ok('最后一行是 71', (await subjOf(49)) === '第 71 封邮件', await subjOf(49))
  ok('第一行带账号标识', (await rows().nth(0).locator('.mail-row-acc').innerText()).trim() === '测试邮箱')
  ok('行内有发件人', (await rows().nth(0).locator('.mail-row-from').innerText()).includes('发件人120'))
  ok('行内有时间', (await rows().nth(0).locator('.mail-row-time').innerText()).trim().length > 0)
  ok('行内有摘要', (await rows().nth(0).locator('.mail-row-snippet').innerText()).includes('纯文本正文'))
  ok('摘要不含 HTML 标签', !(await rows().nth(0).locator('.mail-row-snippet').innerText()).includes('<'))

  const unreadCount = await page.locator('.mail-row.unread').count()
  const seenCount = await page.locator('.mail-row:not(.unread)').count()
  ok('未读行有 unread 标记（第一页 40 未读 / 10 已读）', unreadCount === 40 && seenCount === 10, unreadCount + '/' + seenCount)
  const boldUnread = await page.locator('.mail-row.unread').nth(0).locator('.mail-row-subject').evaluate((el) => getComputedStyle(el).fontWeight)
  const normalRead = await rows().nth(0).locator('.mail-row-subject').evaluate((el) => getComputedStyle(el).fontWeight)
  ok('未读主题加粗、已读不加粗', Number(boldUnread) >= 600 && Number(normalRead) < 600, boldUnread + ' / ' + normalRead)

  // ---------- 4. 账号 chips ----------
  const chips = page.locator('.mail-chips .chip')
  ok('chips = 全部 + 1 个账号', (await chips.count()) === 2, String(await chips.count()))
  const allChip = await chips.nth(0).innerText()
  ok('「全部」带未读数 96', allChip.includes('96'), allChip)
  ok('账号 chip 带未读数', (await chips.nth(1).innerText()).includes('96'))

  // ---------- 5. 打开邮件（正文 / 头部 / 附件 / 拦图） ----------
  await rows().nth(0).click()
  await page.waitForSelector('.mail-reader-subject', { timeout: 15000 })
  ok('阅读区标题正确', (await page.locator('.mail-reader-subject').innerText()).includes('第 120 封邮件'))
  const metaText = await page.locator('.mail-reader-meta').innerText()
  ok('头部含发件人（名+地址）', metaText.includes('发件人120') && metaText.includes('sender120@example.com'), metaText)
  ok('头部含收件人', metaText.includes('收件人'))
  ok('头部含时间', metaText.includes('时间'))
  ok('头部含账号', metaText.includes('测试邮箱'))
  ok('HTML 正文已渲染', (await page.locator('.mail-html').count()) === 1)
  ok('正文内容正确（第 120 封是带附件那封）', (await page.locator('.mail-html').textContent()).includes('带附件的邮件'), await page.locator('.mail-html').textContent())
  ok('附件列了 1 个', (await page.locator('.mail-attach-item').count()) === 1)
  ok('附件名是 报告.txt', (await page.locator('.mail-attach-name').innerText()).includes('报告.txt'))
  const blockedBtn = page.locator('.mail-viewbar button', { hasText: '显示图片' })
  ok('远程图片默认拦住并提示', (await blockedBtn.count()) === 1, await page.locator('.mail-viewbar').innerText())
  ok('被拦的 img 没有 src', (await page.locator('.mail-html img[data-blocked]').count()) === 1)
  ok('被拦的 img 保留 data-src', (await page.locator('.mail-html img[data-blocked]').getAttribute('data-src')).includes('track.example.com'))
  await blockedBtn.click()
  await page.waitForTimeout(300)
  ok('点「显示图片」后真正加载', (await page.locator('.mail-html img[data-blocked]').count()) === 0 && (await page.locator('.mail-html img[src^="https://track.example.com"]').count()) === 1)

  await page.locator('.mail-seg-btn', { hasText: '纯文本' }).click()
  await page.waitForTimeout(200)
  ok('切纯文本显示 pre', (await page.locator('.mail-text').count()) === 1)
  ok('纯文本内容正确', (await page.locator('.mail-text').innerText()).includes('这是第 120 封邮件的纯文本正文'))
  await page.locator('.mail-seg-btn', { hasText: 'HTML' }).click()
  await page.waitForTimeout(200)
  ok('切回 HTML', (await page.locator('.mail-html').count()) === 1)

  // ---------- 6. 本地已读：行变暗、服务器未读数不变 ----------
  await rows().nth(1).click()
  await page.waitForTimeout(800)
  const readCls = await rows().nth(1).getAttribute('class')
  ok('点过的行带 local-read', (readCls || '').includes('local-read'), readCls)
  const api1 = await (await fetch(B + '/api/mail/messages?account=all&folder=INBOX&limit=1')).json()
  ok('服务器未读数仍是 96（没写回 \\Seen）', api1.unseen === 96, String(api1.unseen))

  // ---------- 7. 客户端筛选 ----------
  const search = page.locator('.mail-search input[type="text"], .mail-search input.input')
  await search.fill('第 11')
  await page.waitForTimeout(400)
  const filtered = await rows().count()
  ok('搜索缩小结果', filtered > 0 && filtered < 50, String(filtered))
  const allMatch = await page.locator('.mail-row-subject').allInnerTexts()
  ok('搜索结果都匹配', allMatch.every((t) => t.includes('第 11')), allMatch.slice(0, 3).join('|'))
  await search.fill('')
  await page.waitForTimeout(400)
  ok('清空搜索恢复 50 行', (await rows().count()) === 50, String(await rows().count()))

  await page.locator('.mail-check input').check()
  await page.waitForTimeout(400)
  const unreadRows = await page.locator('.mail-row').count()
  const readRows = await page.locator('.mail-row:not(.unread)').count()
  ok('只看未读：列表里没有已读行', readRows === 0 && unreadRows > 0, unreadRows + '/' + readRows)
  await page.locator('.mail-check input').uncheck()
  await page.waitForTimeout(400)

  // ---------- 8. 翻页 ----------
  await page.locator('.mail-pager button', { hasText: '下一页' }).click()
  await waitFirst('第 70 封邮件')
  await waitRows(50)
  ok('第 2 页第一行是 70', (await subjOf(0)) === '第 70 封邮件', await subjOf(0))
  ok('第 2 页页码文案', (await page.locator('.mail-pager-info').innerText()).includes('51–100'), await page.locator('.mail-pager-info').innerText())
  await page.locator('.mail-pager button', { hasText: '上一页' }).click()
  await waitFirst('第 120 封邮件')
  await waitRows(50)
  ok('上一页回到 120', (await subjOf(0)) === '第 120 封邮件', await subjOf(0))
  await page.locator('.mail-pager button', { hasText: '下一页' }).click()
  await waitFirst('第 70 封邮件')
  await page.locator('.mail-pager button', { hasText: '下一页' }).click()
  await waitFirst('第 20 封邮件')
  await waitRows(20)
  ok('第 3 页只剩 20 封', (await rows().count()) === 20, String(await rows().count()))
  ok('第 3 页第一行是 20', (await subjOf(0)) === '第 20 封邮件', await subjOf(0))
  ok('最后一页「下一页」禁用', await page.locator('.mail-pager button', { hasText: '下一页' }).isDisabled())
  await page.locator('.mail-pager button', { hasText: '上一页' }).click()
  await waitFirst('第 70 封邮件')
  await waitRows(50)

  // ---------- 9. 键盘 J/K ----------
  await rows().nth(0).click()
  await page.waitForTimeout(600)
  await page.keyboard.press('j')
  await page.waitForTimeout(600)
  ok('按 j 选中下一封', (await page.locator('.mail-row.active .mail-row-subject').innerText()).trim() === (await subjOf(1)), await page.locator('.mail-row.active .mail-row-subject').innerText())
  await page.keyboard.press('k')
  await page.waitForTimeout(600)
  ok('按 k 回到上一封', (await page.locator('.mail-row.active .mail-row-subject').innerText()).trim() === (await subjOf(0)), await page.locator('.mail-row.active .mail-row-subject').innerText())

  // ---------- 10. 文件夹 ----------
  await page.locator('.mail-folder select').selectOption('Trash')
  await waitFirst('垃圾箱邮件')
  ok('切到废件箱只剩 1 封', (await rows().count()) === 1, String(await rows().count()))
  await page.locator('.mail-folder select').selectOption('INBOX')
  await waitFirst('第 120 封邮件')
  await waitRows(50)

  // ---------- 11. 顶栏摘要 + 刷新 ----------
  ok('顶栏显示邮箱数与未读数', (await page.locator('.topbar-sub').innerText()).includes('个邮箱'), await page.locator('.topbar-sub').innerText())
  await page.locator('.mail-tools button', { hasText: '刷新' }).click()
  await page.waitForTimeout(1500)
  ok('刷新后列表仍在（没有白屏）', (await rows().count()) === 50, String(await rows().count()))

  // ---------- 12. 编辑账号 ----------
  await page.locator('.mail-tools button', { hasText: '邮箱' }).click()
  await page.waitForSelector('.drawer .mail-acc-item')
  await page.locator('.drawer .mail-acc-item button', { hasText: '编辑' }).click()
  await page.waitForSelector('.drawer .mail-form')
  await page.locator('.mail-form-grid input').nth(0).fill('测试邮箱2')
  await page.locator('.drawer-foot .btn-primary').click()
  await page.waitForTimeout(1200)
  ok('改名后 chips 跟着变', (await page.locator('.mail-chips .chip').nth(1).innerText()).includes('测试邮箱2'), await page.locator('.mail-chips .chip').nth(1).innerText())
  ok('编辑时密码留空不影响（账号仍在）', (await page.locator('.drawer .mail-acc-item').count()) === 1)

  // ---------- 13. 删除账号 ----------
  await page.locator('.drawer .mail-acc-item button').last().click()
  await page.waitForTimeout(300)
  await page.locator('.drawer .mail-acc-item button', { hasText: '确认删除' }).click()
  await page.waitForTimeout(1500)
  await page.locator('.drawer-head button').click()
  await page.waitForTimeout(800)
  ok('删完回到空态', (await page.locator('.empty-title').first().innerText()).includes('还没有添加邮箱'), await page.locator('.empty-title').first().innerText())

  // ---------- 14. 其它页面没被影响 ----------
  await page.locator('.nav-item', { hasText: '便签' }).click()
  await page.waitForTimeout(600)
  ok('便签页仍正常', (await page.locator('.composer').count()) === 1)
  await page.locator('.nav-item', { hasText: '邮件' }).click()
  await page.waitForTimeout(600)
  ok('从便签切回邮件仍在 /mail', new URL(page.url()).pathname === '/mail', page.url())

  await page.screenshot({ path: 'shot-mail-empty.png', fullPage: false })
} catch (e) {
  results.push('FAIL 顶层异常: ' + e.message)
}

ok('无 console / pageerror', errors.length === 0, errors.slice(0, 4).join(' | '))
await browser.close()
fake.close()

const failed = results.filter((r) => r.startsWith('FAIL'))
console.log(results.join('\n'))
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed, ' + failed.length + ' failed')
process.exit(failed.length ? 1 : 0)
