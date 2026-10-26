// 便签图片：粘贴 / 拖拽 / 选文件 → 上传 → 正文 Markdown → 渲染 → 灯箱 → 删除回收。
// 数据全在隔离实例里（tests/run.mjs 起的那份），不碰 data/pinboard.db。
import { BASE } from './env.mjs'
import { CHROME as exe } from '../tools/chrome-path.mjs'
import { login } from './login.mjs'
import { chromium } from 'playwright-core'

const fails = []
const ok = (name, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name)
  if (!cond) fails.push(name)
}

// 1×1 的 PNG（67 字节，够 sniffImage 认出来）
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const marker = 'E2E图片-' + Date.now()

// ---------- 接口层 ----------
const up = (body, type) => fetch(BASE + '/api/attachments', { method: 'POST', headers: { 'Content-Type': type }, body })

const r1 = await up(PNG, 'image/png')
const up1 = r1.ok ? await r1.json() : null
ok('POST /api/attachments 收下 PNG', r1.status === 201 && !!up1 && up1.mime === 'image/png')
ok('上传返回可直接用的 url', !!up1 && up1.url === '/api/attachments/' + up1.id)
ok('上传返回字节数', !!up1 && up1.bytes === PNG.length)

const img = await fetch(BASE + '/api/attachments/' + up1.id)
const imgBuf = Buffer.from(await img.arrayBuffer())
ok('GET 取回原图字节', img.ok && imgBuf.equals(PNG))
ok('GET 的 Content-Type 是图片', (img.headers.get('content-type') || '').startsWith('image/png'))
ok('GET 带 immutable 长缓存', (img.headers.get('cache-control') || '').includes('immutable'))

ok('不收 SVG（同源脚本风险，坑 57）', (await up(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml')).status === 415)
ok('不收纯文本', (await up(Buffer.from('hello world, definitely not an image'), 'image/png')).status === 415)
ok('空文件 400', (await up(Buffer.alloc(0), 'image/png')).status === 400)
const big = Buffer.alloc(10 * 1024 * 1024 + 1)
PNG.copy(big)
ok('超过 10 MB 给 413', (await up(big, 'image/png')).status === 413)
ok('不存在的 id 给 404', (await fetch(BASE + '/api/attachments/99999999')).status === 404)

// 手写一条带图的便签（模拟「图是别的客户端传的」），后面用来验渲染与回收
const apiNote = await (await fetch(BASE + '/api/notes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ content: marker + ' 接口建的\n\n![](/api/attachments/' + up1.id + ')' }),
})).json()
ok('正文引用图片的便签能建', !!apiNote.id)

// ---------- 界面层 ----------
const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: 'zh-CN' })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('dialog', (d) => d.accept())

await login(page)
await page.goto(BASE + '/', { waitUntil: 'networkidle' })

// 选文件上传
await page.setInputFiles('.composer input[type=file]', { name: '截图.png', mimeType: 'image/png', buffer: PNG })
await page.waitForFunction(() => {
  const ta = document.querySelector('.composer textarea')
  return !!ta && /\/api\/attachments\/\d+/.test(ta.value)
}, null, { timeout: 15000 })
const draft = await page.inputValue('.composer textarea')
ok('选文件后正文插入了 Markdown', /!\[\]\(\/api\/attachments\/\d+\)/.test(draft))

// 粘贴上传（模拟剪贴板里的图）
const pasteMarker = marker + ' 粘贴'
await page.fill('.composer textarea', pasteMarker + ' ')
await page.evaluate(async (b64) => {
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  const dt = new DataTransfer()
  dt.items.add(new File([arr], 'paste.png', { type: 'image/png' }))
  const ta = document.querySelector('.composer textarea')
  ta.focus()
  ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
}, PNG.toString('base64'))
await page.waitForFunction((m) => {
  const ta = document.querySelector('.composer textarea')
  return !!ta && ta.value.includes(m) && /\/api\/attachments\/\d+/.test(ta.value)
}, pasteMarker, { timeout: 15000 })
ok('粘贴图片后正文插入了 Markdown', /\/api\/attachments\/\d+/.test(await page.inputValue('.composer textarea')))

await page.click('.composer button.btn-primary')
await page.waitForTimeout(900)

const card = page.locator('.note', { hasText: pasteMarker }).first()
ok('带图便签出现在列表', await card.count() === 1)
const cardImg = card.locator('.note-body img').first()
ok('便签里的图渲染成 <img>', await card.locator('.note-body img').count() === 1)
const src = await cardImg.getAttribute('src')
// 存进正文的是部署无关的 /api/attachments/<id>；渲染时再按 API_BASE 补前缀（公网是 /pinfolio/api），
// 开发态（API_BASE = /api）重写后仍是同一串，所以这里只断言「本站绝对路径 + 指向图片接口」
ok('图片地址是本站的 /api/attachments/<id>', !!src && /\/api\/attachments\/\d+$/.test(src) && !/^https?:/.test(src))
ok('图片真的加载出来了（naturalWidth > 0）', await cardImg.evaluate((el) => el.complete && el.naturalWidth > 0))

// 灯箱
await cardImg.click()
await page.waitForTimeout(300)
ok('点图打开灯箱', await page.locator('.lightbox img').count() === 1)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
ok('Esc 关闭灯箱', await page.locator('.lightbox').count() === 0)

// 行内编辑里也能加图
await card.locator('button[title="编辑"]').click()
await page.waitForTimeout(250)
await page.setInputFiles('.note input[type=file]', { name: 'second.png', mimeType: 'image/png', buffer: PNG })
await page.waitForFunction(() => {
  const ta = document.querySelector('.note textarea')
  return !!ta && (ta.value.match(/\/api\/attachments\//g) || []).length === 2
}, null, { timeout: 15000 })
ok('行内编辑里插图成功', ((await page.inputValue('.note textarea')).match(/\/api\/attachments\//g) || []).length === 2)
await page.click('.note button.btn-primary')
await page.waitForTimeout(800)
ok('保存后两张图都在', await card.locator('.note-body img').count() === 2)

// 拖拽上传（新便签）
const dropMarker = marker + ' 拖拽'
await page.fill('.composer textarea', dropMarker + ' ')
await page.evaluate(async (b64) => {
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  const dt = new DataTransfer()
  dt.items.add(new File([arr], 'drop.png', { type: 'image/png' }))
  const box = document.querySelector('.composer')
  box.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
  box.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
}, PNG.toString('base64'))
await page.waitForFunction((m) => {
  const ta = document.querySelector('.composer textarea')
  return !!ta && ta.value.includes(m) && /\/api\/attachments\/\d+/.test(ta.value)
}, dropMarker, { timeout: 15000 })
ok('拖拽图片后正文插入了 Markdown', /\/api\/attachments\/\d+/.test(await page.inputValue('.composer textarea')))

// 清空草稿，别把这条留在库里
await page.fill('.composer textarea', '')

// ---------- 回收 ----------
const notes = await (await fetch(BASE + '/api/notes?archived=all')).json()
const ids = new Set()
for (const n of notes) {
  if (!n.content.includes(marker)) continue
  for (const m of n.content.matchAll(/\/api\/attachments\/(\d+)/g)) ids.add(Number(m[1]))
  await fetch(BASE + '/api/notes/' + n.id, { method: 'DELETE' })
}
ok('删掉便签后它的图也回收了', ids.size > 0 && (await fetch(BASE + '/api/attachments/' + [...ids][0])).status === 404)
await fetch(BASE + '/api/notes/' + apiNote.id, { method: 'DELETE' })

console.log('ERRORS:', errors.length ? JSON.stringify(errors, null, 1) : 'none')
await browser.close()

if (fails.length) {
  console.log('\nFAILED (' + fails.length + ')：' + fails.join(' | '))
  process.exit(1)
}
