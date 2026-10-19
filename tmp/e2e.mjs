
import { chromium } from 'playwright-core'
const exe = 'C:\\Users\\you\\AppData\\Local\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe'
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: 'zh-CN' })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('dialog', (d) => d.accept())

const ok = (name, cond) => console.log((cond ? 'PASS ' : 'FAIL ') + name)
await page.goto('http://127.0.0.1:7788/', { waitUntil: 'networkidle' })

// 1. create note with tag
const marker = 'E2E便签-' + Date.now()
await page.fill('.composer textarea', marker + ' 带 #e2e标签 的内容')
await page.click('.composer button.btn-primary')
await page.waitForTimeout(700)
ok('新建便签出现在列表', await page.locator('.note-body', { hasText: marker }).count() > 0)
ok('新标签出现在筛选', await page.locator('.filters .chip', { hasText: 'e2e标签' }).count() > 0)

// 2. tag filter
await page.locator('.filters .chip', { hasText: 'e2e标签' }).first().click()
await page.waitForTimeout(500)
ok('按标签筛选后能筛到新便签', await page.locator('.note', { hasText: marker }).count() === 1)
await page.locator('.filters .chip', { hasText: '全部' }).first().click()
await page.waitForTimeout(400)

// 3. inline edit
const note = page.locator('.note', { hasText: marker }).first()
await note.locator('button[title="编辑"]').click()
await page.waitForTimeout(200)
await page.fill('.note textarea', marker + ' 已编辑 #e2e标签')
await page.click('.note button.btn-primary')
await page.waitForTimeout(600)
ok('行内编辑生效', await page.locator('.note-body', { hasText: '已编辑' }).count() > 0)

// 4. pin
const note2 = page.locator('.note', { hasText: marker }).first()
await note2.locator('button[title="置顶"]').click()
await page.waitForTimeout(600)
ok('置顶后进入置顶区', await page.locator('.note.pinned', { hasText: marker }).count() > 0)

// 5. create asset through drawer
await page.click('button[title="资产台账"]')
await page.waitForTimeout(400)
await page.click('text=登记资产')
await page.waitForTimeout(400)
const aname = 'E2E资产-' + Date.now()
await page.fill('.drawer input.input >> nth=0', aname)
await page.fill('.drawer input[placeholder="阿里云 / 京东"]', '测试供应商')
await page.fill('.drawer input[type="number"]', '1234')
await page.click('.drawer button.btn-primary')
await page.waitForTimeout(900)
ok('资产保存后进入详情', (await page.locator('.drawer-head').innerText()).includes('资产详情'))
ok('资产卡片出现', await page.locator('.asset-card', { hasText: aname }).count() > 0)

// 6. add linked note from drawer
await page.fill('.drawer .composer textarea', '这条便签挂在 ' + aname + ' 上 #e2e标签')
await page.click('.drawer .composer button.btn-primary')
await page.waitForTimeout(800)
ok('抽屉内新增关联便签', await page.locator('.drawer .note .prose', { hasText: '挂在' }).count() > 0)
ok('抽屉便签显示标签', await page.locator('.drawer .note .tag', { hasText: 'e2e标签' }).count() > 0)

// 7. delete asset via drawer
await page.click('.drawer button.btn-danger')
await page.waitForTimeout(800)
ok('资产删除后卡片消失', await page.locator('.asset-card', { hasText: aname }).count() === 0)

// 8. table view
await page.click('button[title="表格视图"]')
await page.waitForTimeout(400)
ok('表格视图渲染', await page.locator('table.data tbody tr').count() > 0)
await page.click('button[title="卡片视图"]')

// 9. settings: add tag then delete it
await page.click('button[title="设置"]')
await page.waitForTimeout(400)
await page.fill('input[placeholder="新标签名"]', 'e2e临时标签')
await page.click('text=添加 >> nth=-1')
await page.waitForTimeout(600)
ok('设置页新增标签', await page.locator('.card', { hasText: '标签' }).locator('.tag', { hasText: 'e2e临时标签' }).count() > 0)

// 10. search in palette
await page.keyboard.press('Control+k')
await page.waitForTimeout(300)
await page.fill('.palette-input', 'E2E便签')
await page.waitForTimeout(600)
ok('命令面板搜索到便签', await page.locator('.palette-item').count() > 0)
await page.keyboard.press('Escape')

// 11. cleanup notes created by this run（此前会留脏数据在真实库里）
const allNotes = await (await fetch('http://127.0.0.1:7788/api/notes?archived=all')).json()
let cleaned = 0
for (const n of allNotes) {
  if (n.content.includes(marker) || n.content.includes('挂在 ' + aname)) {
    await fetch('http://127.0.0.1:7788/api/notes/' + n.id, { method: 'DELETE' })
    cleaned++
  }
}
// 顺手清掉测试标签（0 条便签时才删），否则下次跑「新标签」会撞 409
const allTags = await (await fetch('http://127.0.0.1:7788/api/tags')).json()
for (const t of allTags) {
  if ((t.name === 'e2e标签' || t.name === 'e2e临时标签') && t.notes === 0) {
    await fetch('http://127.0.0.1:7788/api/tags/' + t.id, { method: 'DELETE' })
  }
}
console.log('cleaned notes:', cleaned)

console.log('ERRORS:', errors.length ? JSON.stringify(errors, null, 1) : 'none')
await browser.close()
