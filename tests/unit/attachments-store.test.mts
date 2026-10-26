// attachments 表的落盘 / 回收逻辑：真开一个临时库（PINBOARD_DATA 指到 %TEMP%），不碰 data/pinboard.db。
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'pinfolio-att-'))
process.env.PINBOARD_DATA = DIR

// db.ts 在 import 时就打开库并跑迁移，所以 env 必须先设好，这里用动态 import
const store = await import('../../server/attachments/store.js')
const { run, get } = await import('../../server/db.js')

after(() => { try { rmSync(DIR, { recursive: true, force: true }) } catch { /* ignore */ } })

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])

function makeNote(content = ''): number {
  const now = new Date().toISOString()
  return run('INSERT INTO notes (content, created_at, updated_at) VALUES (?, ?, ?)', content, now, now).id
}

function markdownFor(id: number): string {
  return '看图\n\n![](/api/attachments/' + id + ')'
}

test('UPLOAD_DIR：跟着 PINBOARD_DATA 走，落在 uploads/', () => {
  assert.equal(store.UPLOAD_DIR, join(DIR, 'uploads'))
})

test('saveAttachment：写库 + 落盘，文件名是 <id>.<ext>', () => {
  const row = store.saveAttachment({ data: PNG, mime: 'image/png', ext: 'png', name: '截图.png' })
  assert.ok(row.id > 0)
  assert.equal(row.mime, 'image/png')
  assert.equal(row.ext, 'png')
  assert.equal(row.bytes, PNG.length)
  assert.equal(row.name, '截图.png')
  assert.equal(row.note_id, null)
  const file = join(store.UPLOAD_DIR, row.id + '.png')
  assert.ok(existsSync(file))
  assert.deepEqual(readFileSync(file), PNG)
})

test('saveAttachment：不留 .tmp 中间文件', () => {
  store.saveAttachment({ data: JPG, mime: 'image/jpeg', ext: 'jpg' })
  assert.equal(readdirSync(store.UPLOAD_DIR).filter((n) => n.endsWith('.tmp')).length, 0)
})

test('findAttachment / readAttachmentFile', () => {
  const row = store.saveAttachment({ data: PNG, mime: 'image/png', ext: 'png' })
  assert.equal(store.findAttachment(row.id)?.id, row.id)
  assert.equal(store.findAttachment(999999), null)
  assert.deepEqual(store.readAttachmentFile(row), PNG)
  // 行还在但文件被手工删了 → null，由路由给 404
  rmSync(store.attachmentPath(row))
  assert.equal(store.readAttachmentFile(row), null)
})

test('syncNoteAttachments：按正文绑定 / 解绑', () => {
  const note = makeNote()
  const row = store.saveAttachment({ data: PNG, mime: 'image/png', ext: 'png' })
  store.syncNoteAttachments(note, markdownFor(row.id))
  assert.equal(store.findAttachment(row.id)?.note_id, note)
  // 正文里把图删了 → 立刻变孤儿（文件先留着，7 天后清扫）
  store.syncNoteAttachments(note, '没有图了')
  assert.equal(store.findAttachment(row.id)?.note_id, null)
  assert.ok(existsSync(store.attachmentPath(row)))
})

test('syncNoteAttachments：已属于别的便签的图不会被抢走', () => {
  const a = makeNote()
  const b = makeNote()
  const row = store.saveAttachment({ data: PNG, mime: 'image/png', ext: 'png' })
  store.syncNoteAttachments(a, markdownFor(row.id))
  store.syncNoteAttachments(b, markdownFor(row.id))
  assert.equal(store.findAttachment(row.id)?.note_id, a)
})

test('deleteAttachmentsForNote：没人再引用就删行 + 删文件', () => {
  const note = makeNote()
  const row = store.saveAttachment({ data: PNG, mime: 'image/png', ext: 'png' })
  store.syncNoteAttachments(note, markdownFor(row.id))
  assert.equal(store.deleteAttachmentsForNote(note), 1)
  assert.equal(store.findAttachment(row.id), null)
  assert.equal(existsSync(store.attachmentPath(row)), false)
})

test('deleteAttachmentsForNote：别的便签还引用就只解绑、文件留着', () => {
  const a = makeNote()
  const row = store.saveAttachment({ data: PNG, mime: 'image/png', ext: 'png' })
  store.syncNoteAttachments(a, markdownFor(row.id))
  // 整段正文被复制到另一条便签
  makeNote(markdownFor(row.id))
  assert.equal(store.deleteAttachmentsForNote(a), 0)
  assert.equal(store.findAttachment(row.id)?.note_id, null)
  assert.ok(existsSync(store.attachmentPath(row)))
})

test('deleteAttachmentsForNote：id 前缀相同不算引用（12 不会被 123 骗到）', () => {
  const note = makeNote()
  const row = store.saveAttachment({ data: PNG, mime: 'image/png', ext: 'png' })
  assert.ok(row.id < 1000)
  store.syncNoteAttachments(note, markdownFor(row.id))
  makeNote('![](/api/attachments/' + row.id + '9)')
  assert.equal(store.deleteAttachmentsForNote(note), 1)
  assert.equal(store.findAttachment(row.id), null)
})

test('sweepAttachments：孤儿放满 7 天才清，刚上传的不动', () => {
  const fresh = store.saveAttachment({ data: PNG, mime: 'image/png', ext: 'png' })
  const old = store.saveAttachment({ data: PNG, mime: 'image/png', ext: 'png' })
  const oldIso = new Date(Date.now() - 8 * 86400_000).toISOString()
  run('UPDATE attachments SET created_at = ? WHERE id = ?', oldIso, old.id)
  store.sweepAttachments()
  assert.ok(store.findAttachment(fresh.id))
  assert.equal(store.findAttachment(old.id), null)
  assert.equal(existsSync(store.attachmentPath(old)), false)
})

test('sweepAttachments：绑在便签上的旧图不清', () => {
  const note = makeNote()
  const row = store.saveAttachment({ data: PNG, mime: 'image/png', ext: 'png' })
  store.syncNoteAttachments(note, markdownFor(row.id))
  run('UPDATE attachments SET created_at = ? WHERE id = ?', new Date(Date.now() - 30 * 86400_000).toISOString(), row.id)
  store.sweepAttachments()
  assert.ok(store.findAttachment(row.id))
})

test('sweepAttachments：库里没登记的野文件顺手清掉，别的文件不碰', () => {
  const stray = join(store.UPLOAD_DIR, '987654.png')
  writeFileSync(stray, PNG)
  const keep = join(store.UPLOAD_DIR, 'README.txt')
  writeFileSync(keep, 'x')
  store.sweepAttachments()
  assert.equal(existsSync(stray), false)
  assert.ok(existsSync(keep))
  rmSync(keep)
})

test('sweepAttachments：可调 ttl（传 0 等于「立刻清孤儿」）', () => {
  const row = store.saveAttachment({ data: PNG, mime: 'image/png', ext: 'png' })
  run('UPDATE attachments SET created_at = ? WHERE id = ?', new Date(Date.now() - 60_000).toISOString(), row.id)
  assert.ok(store.sweepAttachments(Date.now(), 0) >= 1)
  assert.equal(store.findAttachment(row.id), null)
})

test('附件表跟着便签硬删除：note_id 只是解绑，行不级联删', () => {
  const note = makeNote()
  const row = store.saveAttachment({ data: PNG, mime: 'image/png', ext: 'png' })
  store.syncNoteAttachments(note, markdownFor(row.id))
  run('DELETE FROM notes WHERE id = ?', note)
  assert.equal(get<{ n: number }>('SELECT COUNT(*) AS n FROM attachments WHERE id = ?', row.id)?.n, 1)
})
