// 便签附件（任意文件）：视频 / 音频 / 压缩包上传 → 正文 Markdown → 播放器 / 下载卡片 → 删除回收。
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

const UP = { 'x-pinfolio-upload': '1' }
// 原始文件名走 ?name=（服务端 cleanFileName 后入库，取回时用来拼 Content-Disposition / 卡片标题）
const up = (body, type, name) =>
  fetch(BASE + '/api/attachments' + (name ? '?name=' + encodeURIComponent(name) : ''), {
    method: 'POST',
    headers: { ...UP, 'Content-Type': type },
    body,
  })

/** 最小的 ISO BMFF 头：4 字节长度 + 'ftyp' + brand */
const ftyp = (brand) => {
  const buf = Buffer.alloc(32)
  buf.writeUInt32BE(0x18, 0)
  buf.write('ftyp', 4, 'ascii')
  buf.write(brand.padEnd(4, ' '), 8, 'ascii')
  return buf
}
const MP4 = ftyp('isom')
const MP3 = Buffer.concat([Buffer.from('ID3\x04', 'latin1'), Buffer.alloc(60, 7)])
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(60, 1)])
const marker = 'E2E附件-' + Date.now()

// ---------- 接口层 ----------
const rMp4 = await up(MP4, 'video/mp4', '录制.mp4')
const mp4 = rMp4.ok ? await rMp4.json() : null
ok('MP4 收下且 kind=video', rMp4.status === 201 && !!mp4 && mp4.kind === 'video' && mp4.mime === 'video/mp4')
ok('原始文件名原样带回', !!mp4 && mp4.name === '录制.mp4')

const gMp4 = await fetch(BASE + '/api/attachments/' + mp4.id)
ok('视频 inline 返回 video/mp4', (gMp4.headers.get('content-type') || '') === 'video/mp4')
ok('视频响应带 nosniff', (gMp4.headers.get('x-content-type-options') || '') === 'nosniff')
ok('视频响应支持 Range', (gMp4.headers.get('accept-ranges') || '') === 'bytes')

const range = await fetch(BASE + '/api/attachments/' + mp4.id, { headers: { Range: 'bytes=0-7' } })
const rangeBuf = Buffer.from(await range.arrayBuffer())
ok('Range 请求给 206', range.status === 206)
ok('Range 响应有 Content-Range', (range.headers.get('content-range') || '') === 'bytes 0-7/' + MP4.length)
ok('Range 返回的字节正确', rangeBuf.equals(MP4.subarray(0, 8)))
ok('越界的 Range 给 416', (await fetch(BASE + '/api/attachments/' + mp4.id, { headers: { Range: 'bytes=99999-' } })).status === 416)

const rZip = await up(ZIP, 'application/zip', '安装包.zip')
const zip = rZip.ok ? await rZip.json() : null
ok('压缩包收下且 kind=file', rZip.status === 201 && !!zip && zip.kind === 'file')
const gZip = await fetch(BASE + '/api/attachments/' + zip.id)
ok('未知类型一律 octet-stream', (gZip.headers.get('content-type') || '') === 'application/octet-stream')
ok('未知类型强制下载', (gZip.headers.get('content-disposition') || '').startsWith('attachment'))
ok('下载文件名带原名的 UTF-8 形式', (gZip.headers.get('content-disposition') || '').includes("filename*=UTF-8''"))

const rMp3 = await up(MP3, 'audio/mpeg', '录音.mp3')
const mp3 = rMp3.ok ? await rMp3.json() : null
ok('MP3 收下且 kind=audio', rMp3.status === 201 && !!mp3 && mp3.kind === 'audio')

// ---------- 渲染 ----------
const content = [
  marker + ' 附件渲染',
  '',
  '[录制.mp4](/api/attachments/' + mp4.id + ')',
  '',
  '[录音.mp3](/api/attachments/' + mp3.id + ')',
  '',
  '[安装包.zip](/api/attachments/' + zip.id + ')',
].join('\n')
const note = await (await fetch(BASE + '/api/notes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ content }),
})).json()
ok('便签能引用附件', !!note.id)
ok('hydrate 带出附件元数据', Array.isArray(note.attachments) && note.attachments.length === 3)
ok('元数据里有 kind / bytes', !!note.attachments && note.attachments.some((a) => a.kind === 'video' && a.bytes === MP4.length))

const browser = await chromium.launch({ executablePath: exe })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: 'zh-CN' })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

await login(page)
await page.goto(BASE + '/', { waitUntil: 'networkidle' })

const card = page.locator('.note', { hasText: marker }).first()
ok('附件便签出现在列表', (await card.count()) === 1)
ok('视频渲染成播放器', (await card.locator('.note-body video.attach-video').count()) === 1)
ok('音频渲染成音频条', (await card.locator('.note-body audio.attach-audio').count()) === 1)
const zipCard = card.locator('.note-body a.attach-card').first()
ok('压缩包渲染成下载卡片', (await card.locator('.note-body a.attach-card').count()) === 1)
ok('卡片上显示文件名', (await zipCard.locator('.attach-name').innerText()) === '安装包.zip')
ok('卡片上显示体积', /B|KB|MB/.test(await zipCard.locator('.attach-size').innerText()))
ok('视频地址指向附件接口', /\/api\/attachments\/\d+$/.test(await card.locator('.note-body video').getAttribute('src')))

// ---------- 回收 ----------
const notes = await (await fetch(BASE + '/api/notes?archived=all')).json()
const ids = new Set()
for (const n of notes) {
  if (!n.content.includes(marker)) continue
  for (const m of n.content.matchAll(/\/api\/attachments\/(\d+)/g)) ids.add(Number(m[1]))
  await fetch(BASE + '/api/notes/' + n.id, { method: 'DELETE' })
}
ok('删便签后附件一起回收', ids.size === 3 && (await fetch(BASE + '/api/attachments/' + [...ids][0])).status === 404)

console.log('ERRORS:', errors.length ? JSON.stringify(errors, null, 1) : 'none')
await browser.close()

if (fails.length) {
  console.log('\nFAILED (' + fails.length + ')：' + fails.join(' | '))
  process.exit(1)
}
