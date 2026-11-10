import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FALLBACK_FILE,
  MAX_UPLOAD_BYTES,
  attachmentIdsIn,
  attachmentUrl,
  attachmentsAsText,
  canInline,
  cleanFileName,
  contentDisposition,
  fileMarkdown,
  imageMarkdown,
  parseByteRange,
  sniffFile,
  sniffImage,
  uploadFileName,
} from '../../server/attachments/core.js'

// 造一个够长的假文件头（sniffFile 要求至少 12 字节）
const head = (bytes: number[] | Uint8Array, pad = 16) => {
  const arr = Array.from(bytes)
  return new Uint8Array([...arr, ...new Array(Math.max(0, pad - arr.length)).fill(0)])
}
const PNG = head([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPG = head([0xff, 0xd8, 0xff, 0xe0])
const GIF89 = head([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20])
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0, 0, 0, 0])
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

/** ISO BMFF：4 字节长度 + 'ftyp' + brand */
const ftyp = (brand: string, extra = '') => {
  const buf = new Uint8Array(32)
  buf.set([0, 0, 0, 0x18], 0)
  buf.set(new TextEncoder().encode('ftyp'), 4)
  buf.set(new TextEncoder().encode(brand.slice(0, 4)), 8)
  if (extra) buf.set(new TextEncoder().encode(extra.slice(0, 20)), 16)
  return buf
}

test('sniffFile：图片四种按魔数认出来', () => {
  assert.deepEqual(sniffFile(PNG), { kind: 'image', mime: 'image/png', ext: 'png' })
  assert.deepEqual(sniffFile(JPG), { kind: 'image', mime: 'image/jpeg', ext: 'jpg' })
  assert.deepEqual(sniffFile(GIF89), { kind: 'image', mime: 'image/gif', ext: 'gif' })
  assert.deepEqual(sniffFile(WEBP), { kind: 'image', mime: 'image/webp', ext: 'webp' })
})

test('sniffFile：mp4 / mov / m4a / avif / heic 靠 ftyp brand 分辨', () => {
  assert.deepEqual(sniffFile(ftyp('isom')), { kind: 'video', mime: 'video/mp4', ext: 'mp4' })
  assert.deepEqual(sniffFile(ftyp('qt  ')), { kind: 'video', mime: 'video/quicktime', ext: 'mov' })
  assert.deepEqual(sniffFile(ftyp('M4A ')), { kind: 'audio', mime: 'audio/mp4', ext: 'm4a' })
  assert.deepEqual(sniffFile(ftyp('avif')), { kind: 'image', mime: 'image/avif', ext: 'avif' })
  assert.deepEqual(sniffFile(ftyp('heic')), { kind: 'image', mime: 'image/heic', ext: 'heic' })
})

test('sniffFile：视频（webm / mkv / avi / mp2t）与音频（wav / ogg / mp3 / flac）', () => {
  const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new TextEncoder().encode('webm'), ...new Array(24).fill(0)])
  assert.deepEqual(sniffFile(webm), { kind: 'video', mime: 'video/webm', ext: 'webm' })
  const mkv = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new Array(28).fill(0)])
  assert.deepEqual(sniffFile(mkv), { kind: 'video', mime: 'video/x-matroska', ext: 'mkv' })
  const avi = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20, 0, 0, 0, 0])
  assert.deepEqual(sniffFile(avi), { kind: 'video', mime: 'video/x-msvideo', ext: 'avi' })
  assert.deepEqual(sniffFile(WAV), { kind: 'audio', mime: 'audio/wav', ext: 'wav' })
  const ogg = new Uint8Array([0x4f, 0x67, 0x67, 0x53, ...new Array(28).fill(0)])
  assert.deepEqual(sniffFile(ogg), { kind: 'audio', mime: 'audio/ogg', ext: 'ogg' })
  const ogv = new Uint8Array([0x4f, 0x67, 0x67, 0x53, ...new TextEncoder().encode('theora'), ...new Array(20).fill(0)])
  assert.deepEqual(sniffFile(ogv), { kind: 'video', mime: 'video/ogg', ext: 'ogv' })
  const mp3 = new Uint8Array([0x49, 0x44, 0x33, 4, ...new Array(24).fill(0)])
  assert.deepEqual(sniffFile(mp3), { kind: 'audio', mime: 'audio/mpeg', ext: 'mp3' })
  const flac = new Uint8Array([0x66, 0x4c, 0x61, 0x43, ...new Array(24).fill(0)])
  assert.deepEqual(sniffFile(flac), { kind: 'audio', mime: 'audio/flac', ext: 'flac' })
  const ts = new Uint8Array(400)
  ts[0] = 0x47
  ts[188] = 0x47
  assert.deepEqual(sniffFile(ts), { kind: 'video', mime: 'video/mp2t', ext: 'ts' })
})

test('sniffFile：pdf / zip / 7z / gz / rar 都是「普通文件」', () => {
  const pdf = head(new TextEncoder().encode('%PDF-1.7'))
  assert.deepEqual(sniffFile(pdf), { kind: 'file', mime: 'application/pdf', ext: 'pdf' })
  const zip = head([0x50, 0x4b, 0x03, 0x04])
  assert.deepEqual(sniffFile(zip), { kind: 'file', mime: 'application/zip', ext: 'zip' })
  const sevenZip = head([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])
  assert.deepEqual(sniffFile(sevenZip), { kind: 'file', mime: 'application/x-7z-compressed', ext: '7z' })
  const gz = head([0x1f, 0x8b])
  assert.deepEqual(sniffFile(gz), { kind: 'file', mime: 'application/gzip', ext: 'gz' })
  const rar = head(new TextEncoder().encode('Rar!'))
  assert.deepEqual(sniffFile(rar), { kind: 'file', mime: 'application/vnd.rar', ext: 'rar' })
})

test('sniffFile：认不出来就是 null（路由用 FALLBACK_FILE 兜底）', () => {
  assert.equal(sniffFile(null), null)
  assert.equal(sniffFile(undefined), null)
  assert.equal(sniffFile(new Uint8Array(0)), null)
  assert.equal(sniffFile(new TextEncoder().encode('GIF89a')), null) // 只有 6 字节，不够判
  assert.equal(sniffFile(new TextEncoder().encode('hello world, not a known file')), null)
  assert.deepEqual(FALLBACK_FILE, { kind: 'file', mime: 'application/octet-stream', ext: 'bin' })
})

test('sniffImage / sniffFile：SVG 一律不收（同源 <script> 能跑，坑 57）', () => {
  assert.equal(sniffImage(SVG), null)
  assert.equal(sniffFile(SVG), null)
})

test('canInline：只有白名单能就地渲染，svg / html 永远不行', () => {
  assert.equal(canInline('image/png'), true)
  assert.equal(canInline('video/mp4'), true)
  assert.equal(canInline('audio/mpeg'), true)
  assert.equal(canInline('application/pdf'), true)
  assert.equal(canInline('image/svg+xml'), false)
  assert.equal(canInline('text/html'), false)
  assert.equal(canInline('application/octet-stream'), false)
  assert.equal(canInline(''), false)
})

test('MAX_UPLOAD_BYTES：单个 100 MB', () => {
  assert.equal(MAX_UPLOAD_BYTES, 100 * 1024 * 1024)
})

test('attachmentIdsIn：抽出正文引用的附件 id，去重升序', () => {
  const content = '看图\n\n![](/api/attachments/12)\n\n![](/api/attachments/3)\n\n![](/api/attachments/12)'
  assert.deepEqual(attachmentIdsIn(content), [3, 12])
  assert.deepEqual(attachmentIdsIn('[报告.pdf](/api/attachments/9)'), [9])
  assert.deepEqual(attachmentIdsIn(''), [])
  assert.deepEqual(attachmentIdsIn('/api/attachments/abc'), [])
  assert.deepEqual(attachmentIdsIn('![](attachments/7)'), [7])
})

test('attachmentUrl / imageMarkdown / fileMarkdown', () => {
  assert.equal(attachmentUrl(5), '/api/attachments/5')
  assert.equal(imageMarkdown(5), '![](/api/attachments/5)')
  assert.equal(imageMarkdown(5, '截图'), '![截图](/api/attachments/5)')
  assert.equal(imageMarkdown(1, 'a[b]c'), '![abc](/api/attachments/1)')
  assert.equal(fileMarkdown(7, '报告 2026.pdf'), '[报告 2026.pdf](/api/attachments/7)')
  assert.equal(fileMarkdown(8, 'a[b]\nc'), '[abc](/api/attachments/8)')
  assert.equal(fileMarkdown(9), '[附件-9](/api/attachments/9)')
})

test('attachmentsAsText：快照里图片收成 [图片]，文件收成 [附件：名字]', () => {
  assert.equal(attachmentsAsText('![](/api/attachments/1)'), '[图片]')
  assert.equal(attachmentsAsText('![截图](/api/attachments/2)'), '[图片：截图]')
  assert.equal(attachmentsAsText('前文\n![](/api/attachments/3)\n后文'), '前文\n[图片]\n后文')
  assert.equal(attachmentsAsText('[合同.pdf](/api/attachments/4)'), '[附件：合同.pdf]')
})

test('attachmentsAsText：普通链接和文字不动', () => {
  assert.equal(attachmentsAsText('[看这个](https://example.com/a.png)'), '[看这个](https://example.com/a.png)')
  assert.equal(attachmentsAsText('纯文本 [图片] 字样'), '纯文本 [图片] 字样')
})

test('parseByteRange：没有头 = null，正常区间 = 206，越界 = invalid', () => {
  assert.equal(parseByteRange(null, 100), null)
  assert.equal(parseByteRange('', 100), null)
  assert.deepEqual(parseByteRange('bytes=0-49', 100), { start: 0, end: 49 })
  assert.deepEqual(parseByteRange('bytes=50-', 100), { start: 50, end: 99 })
  assert.deepEqual(parseByteRange('bytes=-10', 100), { start: 90, end: 99 })
  assert.deepEqual(parseByteRange('bytes=0-999', 100), { start: 0, end: 99 }) // 超出末尾就截到末尾
  assert.deepEqual(parseByteRange('bytes=-999', 100), { start: 0, end: 99 })
  assert.equal(parseByteRange('bytes=100-', 100), 'invalid')
  assert.equal(parseByteRange('bytes=5-2', 100), 'invalid')
  assert.equal(parseByteRange('bytes=abc', 100), 'invalid')
  assert.equal(parseByteRange('bytes=-', 100), 'invalid')
  assert.equal(parseByteRange('items=0-1', 100), 'invalid')
})

test('contentDisposition：inline / attachment + 中文文件名走 filename*', () => {
  const img = contentDisposition('', '12.png', true)
  assert.equal(img, 'inline; filename="12.png"; filename*=UTF-8\'\'12.png')
  const pdf = contentDisposition('合同 2026.pdf', '7.pdf', false)
  assert.ok(pdf.startsWith('attachment; '))
  assert.ok(pdf.includes('filename="__ 2026.pdf"'))
  assert.ok(pdf.includes("filename*=UTF-8''%E5%90%88%E5%90%8C%202026.pdf"))
})

test('uploadFileName：只用 id + 扩展名', () => {
  assert.equal(uploadFileName(12, 'png'), '12.png')
})

test('cleanFileName：去掉路径，只留文件名', () => {
  assert.equal(cleanFileName('C:\\Users\\a\\图片.png'), '图片.png')
  assert.equal(cleanFileName('../../etc/passwd'), 'passwd')
  assert.equal(cleanFileName('/var/tmp/x.jpg'), 'x.jpg')
  assert.equal(cleanFileName('a\u0000b\u001fc.png'), 'abc.png')
  assert.equal(cleanFileName('  shot.png  '), 'shot.png')
  assert.equal(cleanFileName('x'.repeat(300)).length, 200)
  assert.equal(cleanFileName(''), '')
  assert.equal(cleanFileName(undefined as any), '')
})
