import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_UPLOAD_BYTES,
  attachmentIdsIn,
  attachmentUrl,
  cleanFileName,
  imageMarkdown,
  imagesAsText,
  sniffImage,
  uploadFileName,
} from '../../server/attachments/core.js'

// 造一个够长的假图片头（sniffImage 要求至少 12 字节）
const head = (bytes: number[], pad = 16) => new Uint8Array([...bytes, ...new Array(Math.max(0, pad - bytes.length)).fill(0)])
const PNG = head([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPG = head([0xff, 0xd8, 0xff, 0xe0])
const GIF87 = head([0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
const GIF89 = head([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20])
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

test('sniffImage：四种支持的格式按魔数认出来', () => {
  assert.deepEqual(sniffImage(PNG), { mime: 'image/png', ext: 'png' })
  assert.deepEqual(sniffImage(JPG), { mime: 'image/jpeg', ext: 'jpg' })
  assert.deepEqual(sniffImage(GIF87), { mime: 'image/gif', ext: 'gif' })
  assert.deepEqual(sniffImage(GIF89), { mime: 'image/gif', ext: 'gif' })
  assert.deepEqual(sniffImage(WEBP), { mime: 'image/webp', ext: 'webp' })
})

test('sniffImage：SVG 一律不收（同源 <script> 能跑，坑 57）', () => {
  assert.equal(sniffImage(SVG), null)
})

test('sniffImage：空 / 太短 / 纯文本都返回 null', () => {
  assert.equal(sniffImage(null), null)
  assert.equal(sniffImage(undefined), null)
  assert.equal(sniffImage(new Uint8Array(0)), null)
  assert.equal(sniffImage(new TextEncoder().encode('GIF89a')), null) // 只有 6 字节，不够判
  assert.equal(sniffImage(new TextEncoder().encode('hello world, not an image')), null)
})

test('sniffImage：RIFF 但不是 WEBP（比如 wav）不算图', () => {
  const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0, 0, 0, 0])
  assert.equal(sniffImage(wav), null)
})

test('MAX_UPLOAD_BYTES：单张 10 MB', () => {
  assert.equal(MAX_UPLOAD_BYTES, 10 * 1024 * 1024)
})

test('attachmentIdsIn：抽出正文引用的图片 id，去重升序', () => {
  const content = '看图\n\n![](/api/attachments/12)\n\n![](/api/attachments/3)\n\n![](/api/attachments/12)'
  assert.deepEqual(attachmentIdsIn(content), [3, 12])
})

test('attachmentIdsIn：没有图 / 空正文', () => {
  assert.deepEqual(attachmentIdsIn(''), [])
  assert.deepEqual(attachmentIdsIn('普通正文，没有图'), [])
  assert.deepEqual(attachmentIdsIn('/api/attachments/abc'), [])
})

test('attachmentIdsIn：手写相对路径也认', () => {
  assert.deepEqual(attachmentIdsIn('![](attachments/7)'), [7])
})

test('attachmentUrl / imageMarkdown', () => {
  assert.equal(attachmentUrl(5), '/api/attachments/5')
  assert.equal(imageMarkdown(5), '![](/api/attachments/5)')
  assert.equal(imageMarkdown(5, '截图'), '![截图](/api/attachments/5)')
})

test('imageMarkdown：alt 里的方括号会破坏语法，先去干净', () => {
  assert.equal(imageMarkdown(1, 'a[b]c'), '![abc](/api/attachments/1)')
})

test('imagesAsText：快照里收成 [图片] / [图片：alt]', () => {
  assert.equal(imagesAsText('![](/api/attachments/1)'), '[图片]')
  assert.equal(imagesAsText('![截图](/api/attachments/2)'), '[图片：截图]')
  assert.equal(imagesAsText('前文\n![](/api/attachments/3)\n后文'), '前文\n[图片]\n后文')
})

test('imagesAsText：普通链接和文字不动', () => {
  assert.equal(imagesAsText('[看这个](https://example.com/a.png)'), '[看这个](https://example.com/a.png)')
  assert.equal(imagesAsText('纯文本 [图片] 字样'), '纯文本 [图片] 字样')
})

test('uploadFileName：只用 id + 扩展名', () => {
  assert.equal(uploadFileName(12, 'png'), '12.png')
})

test('cleanFileName：去掉路径，只留文件名', () => {
  assert.equal(cleanFileName('C:\\Users\\a\\图片.png'), '图片.png')
  assert.equal(cleanFileName('../../etc/passwd'), 'passwd')
  assert.equal(cleanFileName('/var/tmp/x.jpg'), 'x.jpg')
})

test('cleanFileName：控制字符去掉、首尾空白去掉、截 200 字', () => {
  assert.equal(cleanFileName('a\u0000b\u001fc.png'), 'abc.png')
  assert.equal(cleanFileName('  shot.png  '), 'shot.png')
  assert.equal(cleanFileName('x'.repeat(300)).length, 200)
  assert.equal(cleanFileName(''), '')
  assert.equal(cleanFileName(undefined as any), '')
})
