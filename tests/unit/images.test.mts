import test from 'node:test'
import assert from 'node:assert/strict'
import {
  IMAGE_TYPES,
  addImageAttrs,
  imageMarkdown,
  insertSnippet,
  normalizeImageType,
  pickImageFiles,
  rewriteAttachmentUrls,
} from '../../web/lib/images.js'

const file = (type: string, size = 100, name = 'a.png') =>
  ({ type, size, name }) as unknown as File

test('IMAGE_TYPES：只收 png / jpeg / webp / gif', () => {
  assert.deepEqual([...IMAGE_TYPES], ['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
})

test('normalizeImageType：image/jpg 归一成 image/jpeg', () => {
  assert.equal(normalizeImageType('image/jpg'), 'image/jpeg')
  assert.equal(normalizeImageType('IMAGE/PNG'), 'image/png')
  assert.equal(normalizeImageType('image/pjpeg'), 'image/jpeg')
})

test('normalizeImageType：svg / heic / 空都不收', () => {
  assert.equal(normalizeImageType('image/svg+xml'), null)
  assert.equal(normalizeImageType('image/heic'), null)
  assert.equal(normalizeImageType(''), null)
  assert.equal(normalizeImageType('text/plain'), null)
})

test('pickImageFiles：只挑图，别的文件默默忽略', () => {
  const got = pickImageFiles([file('image/png'), file('text/plain'), file('image/gif'), file('image/webp')])
  assert.equal(got.length, 3)
  assert.deepEqual(got.map((f) => f.type), ['image/png', 'image/gif', 'image/webp'])
})

test('pickImageFiles：0 字节的丢掉（粘贴空文件不算图）', () => {
  assert.deepEqual(pickImageFiles([file('image/png', 0)]), [])
})

test('pickImageFiles：null / 空数组', () => {
  assert.deepEqual(pickImageFiles(null), [])
  assert.deepEqual(pickImageFiles([]), [])
})

test('insertSnippet：插在光标处，前后补空行', () => {
  const r = insertSnippet('上句下句', '![](/api/attachments/1)', 2, 2)
  assert.equal(r.text, '上句\n\n![](/api/attachments/1)\n\n下句')
  assert.equal(r.text.slice(0, r.caret), '上句\n\n![](/api/attachments/1)')
})

test('insertSnippet：前面已经有空行就不重复补', () => {
  const r = insertSnippet('上句\n下句', '![](/api/attachments/1)', 3, 3)
  assert.equal(r.text, '上句\n![](/api/attachments/1)\n\n下句')
})

test('insertSnippet：有选区就原样替换（不补空行）', () => {
  const r = insertSnippet('abcdef', 'X', 2, 4)
  assert.equal(r.text, 'abXef')
  assert.equal(r.caret, 3)
})

test('insertSnippet：空正文 / 不传位置就追加到末尾', () => {
  assert.deepEqual(insertSnippet('', 'X'), { text: 'X', caret: 1 })
  assert.deepEqual(insertSnippet('abc', 'X'), { text: 'abc\n\nX', caret: 6 })
})

test('insertSnippet：末尾已经换行就不重复补', () => {
  const r = insertSnippet('abc\n\n', 'X')
  assert.equal(r.text, 'abc\n\nX')
})

test('insertSnippet：越界的位置会被夹回正文范围内', () => {
  const r = insertSnippet('abc', 'X', 99, 99)
  assert.equal(r.text, 'abc\n\nX')
})

test('imageMarkdown：与后端拼出来的完全一致', () => {
  assert.equal(imageMarkdown(12), '![](/api/attachments/12)')
  assert.equal(imageMarkdown(12, 'a[b]'), '![ab](/api/attachments/12)')
})

test('rewriteAttachmentUrls：按部署前缀重写 src / href', () => {
  const html = '<p><img src="/api/attachments/1" alt=""></p>'
  assert.equal(rewriteAttachmentUrls(html, '/api'), '<p><img src="/api/attachments/1" alt=""></p>')
  assert.equal(rewriteAttachmentUrls(html, '/pinfolio/api'), '<p><img src="/pinfolio/api/attachments/1" alt=""></p>')
  assert.equal(
    rewriteAttachmentUrls('<a href="/api/attachments/2">x</a>', '/pinfolio/api'),
    '<a href="/pinfolio/api/attachments/2">x</a>',
  )
})

test('rewriteAttachmentUrls：空前缀 / 无关链接不动', () => {
  const html = '<img src="/api/attachments/1"><a href="https://example.com/api/attachments/9">x</a>'
  assert.equal(rewriteAttachmentUrls(html, ''), html)
  assert.equal(rewriteAttachmentUrls(html, '/api'), '<img src="/api/attachments/1"><a href="https://example.com/api/attachments/9">x</a>')
})

test('rewriteAttachmentUrls：只改属性值，正文文字里的同样字串不动', () => {
  const html = '<p>看 /api/attachments/3 这个</p><img src="/api/attachments/3">'
  assert.equal(
    rewriteAttachmentUrls(html, '/pinfolio/api'),
    '<p>看 /api/attachments/3 这个</p><img src="/pinfolio/api/attachments/3">',
  )
})

test('addImageAttrs：给 <img> 补 loading / decoding', () => {
  assert.equal(addImageAttrs('<img src="a.png">'), '<img src="a.png" loading="lazy" decoding="async">')
})

test('addImageAttrs：已有属性不重复加', () => {
  assert.equal(addImageAttrs('<img src="a.png" loading="eager">'), '<img src="a.png" loading="eager" decoding="async">')
  assert.equal(addImageAttrs('<img src="a.png" loading="lazy" decoding="async">'), '<img src="a.png" loading="lazy" decoding="async">')
})

test('addImageAttrs：非 img 标签不动', () => {
  const html = '<p>x</p><video src="a.mp4"></video>'
  assert.equal(addImageAttrs(html), html)
})
