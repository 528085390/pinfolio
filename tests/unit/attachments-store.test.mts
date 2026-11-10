// attachments 表的落盘 / 回收逻辑：真开一个临时库（PINBOARD_DATA 指到 %TEMP%），不碰 data/pinboard.db。
// 末尾几组用 __setStorageForTests 注入假对象存储，验证 s3 分支不发真请求。
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

const DIR = mkdtempSync(join(tmpdir(), 'pinfolio-att-'))
process.env.PINBOARD_DATA = DIR
process.env.S3_DRIVER = 'local' // 本地那几组要确定跑在本地分支上

// db.ts 在 import 时就打开库并跑迁移，所以 env 必须先设好，这里用动态 import
const store = await import('../../server/attachments/store.js')
const { run, get } = await import('../../server/db.js')
const { sha256Hex } = await import('../../server/storage/sigv4.js')
const { __setStorageForTests, __resetStorageForTests } = await import('../../server/storage/index.js')

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

const savePng = (extra: Record<string, any> = {}) =>
  store.saveAttachment({ data: PNG, kind: 'image', mime: 'image/png', ext: 'png', ...extra })

test('UPLOAD_DIR：跟着 PINBOARD_DATA 走，落在 uploads/', () => {
  assert.equal(store.UPLOAD_DIR, join(DIR, 'uploads'))
})

test('saveAttachment：写库 + 落盘，文件名是 <id>.<ext>，sha256 记下来', async () => {
  const row = await savePng({ name: '截图.png' })
  assert.ok(row.id > 0)
  assert.equal(row.kind, 'image')
  assert.equal(row.mime, 'image/png')
  assert.equal(row.ext, 'png')
  assert.equal(row.bytes, PNG.length)
  assert.equal(row.name, '截图.png')
  assert.equal(row.note_id, null)
  assert.equal(row.storage, 'local')
  assert.equal(row.object_key, null)
  assert.equal(row.sha256, sha256Hex(PNG))
  const file = join(store.UPLOAD_DIR, row.id + '.png')
  assert.ok(existsSync(file))
  assert.deepEqual(readFileSync(file), PNG)
})

test('saveAttachment：不留 .tmp 中间文件', async () => {
  await store.saveAttachment({ data: JPG, kind: 'image', mime: 'image/jpeg', ext: 'jpg' })
  assert.equal(readdirSync(store.UPLOAD_DIR).filter((n) => n.endsWith('.tmp')).length, 0)
})

test('findAttachment / readAttachmentFile', async () => {
  const row = await savePng()
  assert.equal(store.findAttachment(row.id)?.id, row.id)
  assert.equal(store.findAttachment(999999), null)
  assert.deepEqual(store.readAttachmentFile(row), PNG)
  // 行还在但文件被手工删了 → null，由路由给 404
  rmSync(store.attachmentPath(row))
  assert.equal(store.readAttachmentFile(row), null)
})

test('openAttachment：整份 200、带 Range 的 206、越界 416、文件没了 null', async () => {
  const row = await savePng()
  const whole = await store.openAttachment(row)
  assert.equal(whole?.status, 200)
  assert.equal(whole?.size, PNG.length)
  assert.deepEqual(Buffer.from(await new Response(whole!.body).arrayBuffer()), PNG)

  const part = await store.openAttachment(row, 'bytes=2-5')
  assert.equal(part?.status, 206)
  assert.equal(part?.size, 4)
  assert.equal(part?.contentRange, 'bytes 2-5/' + PNG.length)
  assert.deepEqual(Buffer.from(await new Response(part!.body).arrayBuffer()), PNG.subarray(2, 6))

  assert.equal((await store.openAttachment(row, 'bytes=999-'))?.status, 416)

  rmSync(store.attachmentPath(row))
  assert.equal(await store.openAttachment(row), null)
})

test('totalAttachmentBytes：所有行的字节数之和（配额按总量算）', async () => {
  const before = store.totalAttachmentBytes()
  await savePng()
  assert.equal(store.totalAttachmentBytes(), before + PNG.length)
})

test('saveAttachment：超配额抛 AttachmentQuotaError，不留行', async () => {
  const used = store.totalAttachmentBytes()
  const old = process.env.ATTACHMENTS_QUOTA_BYTES
  process.env.ATTACHMENTS_QUOTA_BYTES = String(used + 4) // 只剩 4 字节
  try {
    await assert.rejects(() => savePng(), (err: any) => {
      assert.equal(err.name, 'AttachmentQuotaError')
      assert.equal(err.quota, used + 4)
      return true
    })
    assert.equal(store.totalAttachmentBytes(), used)
  } finally {
    if (old === undefined) delete process.env.ATTACHMENTS_QUOTA_BYTES
    else process.env.ATTACHMENTS_QUOTA_BYTES = old
  }
})

test('syncNoteAttachments：按正文绑定 / 解绑', async () => {
  const note = makeNote()
  const row = await savePng()
  store.syncNoteAttachments(note, markdownFor(row.id))
  assert.equal(store.findAttachment(row.id)?.note_id, note)
  // 正文里把图删了 → 立刻变孤儿（文件先留着，7 天后清扫）
  store.syncNoteAttachments(note, '没有图了')
  assert.equal(store.findAttachment(row.id)?.note_id, null)
  assert.ok(existsSync(store.attachmentPath(row)))
})

test('syncNoteAttachments：已属于别的便签的附件不会被抢走', async () => {
  const a = makeNote()
  const b = makeNote()
  const row = await savePng()
  store.syncNoteAttachments(a, markdownFor(row.id))
  store.syncNoteAttachments(b, markdownFor(row.id))
  assert.equal(store.findAttachment(row.id)?.note_id, a)
})

test('deleteAttachmentsForNote：没人再引用就删行 + 删文件', async () => {
  const note = makeNote()
  const row = await savePng()
  store.syncNoteAttachments(note, markdownFor(row.id))
  assert.equal(await store.deleteAttachmentsForNote(note), 1)
  assert.equal(store.findAttachment(row.id), null)
  assert.equal(existsSync(store.attachmentPath(row)), false)
})

test('deleteAttachmentsForNote：别的便签还引用就只解绑、文件留着', async () => {
  const a = makeNote()
  const row = await savePng()
  store.syncNoteAttachments(a, markdownFor(row.id))
  // 整段正文被复制到另一条便签
  makeNote(markdownFor(row.id))
  assert.equal(await store.deleteAttachmentsForNote(a), 0)
  assert.equal(store.findAttachment(row.id)?.note_id, null)
  assert.ok(existsSync(store.attachmentPath(row)))
})

test('deleteAttachmentsForNote：id 前缀相同不算引用（12 不会被 123 骗到）', async () => {
  const note = makeNote()
  const row = await savePng()
  assert.ok(row.id < 1000)
  store.syncNoteAttachments(note, markdownFor(row.id))
  makeNote('![](/api/attachments/' + row.id + '9)')
  assert.equal(await store.deleteAttachmentsForNote(note), 1)
  assert.equal(store.findAttachment(row.id), null)
})

test('sweepAttachments：孤儿放满 7 天才清，刚上传的不动', async () => {
  const fresh = await savePng()
  const old = await savePng()
  const oldIso = new Date(Date.now() - 8 * 86400_000).toISOString()
  run('UPDATE attachments SET created_at = ? WHERE id = ?', oldIso, old.id)
  await store.sweepAttachments()
  assert.ok(store.findAttachment(fresh.id))
  assert.equal(store.findAttachment(old.id), null)
  assert.equal(existsSync(store.attachmentPath(old)), false)
})

test('sweepAttachments：绑在便签上的旧附件不清', async () => {
  const note = makeNote()
  const row = await savePng()
  store.syncNoteAttachments(note, markdownFor(row.id))
  run('UPDATE attachments SET created_at = ? WHERE id = ?', new Date(Date.now() - 30 * 86400_000).toISOString(), row.id)
  await store.sweepAttachments()
  assert.ok(store.findAttachment(row.id))
})

test('sweepAttachments：库里没登记的野文件顺手清掉，别的文件不碰', async () => {
  const stray = join(store.UPLOAD_DIR, '987654.png')
  writeFileSync(stray, PNG)
  const keep = join(store.UPLOAD_DIR, 'README.txt')
  writeFileSync(keep, 'x')
  await store.sweepAttachments()
  assert.equal(existsSync(stray), false)
  assert.ok(existsSync(keep))
  rmSync(keep)
})

test('sweepAttachments：可调 ttl（传 0 等于「立刻清孤儿」）', async () => {
  const row = await savePng()
  run('UPDATE attachments SET created_at = ? WHERE id = ?', new Date(Date.now() - 60_000).toISOString(), row.id)
  assert.ok((await store.sweepAttachments(Date.now(), 0)) >= 1)
  assert.equal(store.findAttachment(row.id), null)
})

test('附件表跟着便签硬删除：note_id 只是解绑，行不级联删', async () => {
  const note = makeNote()
  const row = await savePng()
  store.syncNoteAttachments(note, markdownFor(row.id))
  run('DELETE FROM notes WHERE id = ?', note)
  assert.equal(get<{ n: number }>('SELECT COUNT(*) AS n FROM attachments WHERE id = ?', row.id)?.n, 1)
})

// ---- 下面是对象存储分支：注入假客户端，不发真请求 ----

const puts: string[] = []
const deletes: string[] = []
const objects = new Map<string, Buffer>()
const fakeClient: any = {
  bucket: 'pinfolio',
  endpoint: 'http://fake',
  objectUrl: (key: string) => 'http://fake/pinfolio/' + key,
  async putObject(key: string, body: Uint8Array) {
    puts.push(key)
    objects.set(key, Buffer.from(body))
    return { etag: 'etag' }
  },
  async getObject(key: string, range?: string) {
    const data = objects.get(key) ?? Buffer.alloc(0)
    if (!range) {
      return { status: 200, headers: { 'content-length': String(data.length) }, body: new Response(new Uint8Array(data)).body }
    }
    const m = /^bytes=(\d+)-(\d+)$/.exec(range)!
    const start = Number(m[1])
    const end = Number(m[2])
    const slice = data.subarray(start, end + 1)
    return {
      status: 206,
      headers: { 'content-length': String(slice.length), 'content-range': 'bytes ' + start + '-' + end + '/' + data.length },
      body: new Response(new Uint8Array(slice)).body,
    }
  },
  async headObject(key: string) {
    const data = objects.get(key)
    return data ? { size: data.length, contentType: 'image/png' } : null
  },
  async deleteObject(key: string) {
    deletes.push(key)
    objects.delete(key)
  },
}
const FAKE_STORAGE = {
  config: {
    driver: 's3' as const,
    endpoint: 'http://fake',
    region: 'ap-tokyo-1',
    bucket: 'pinfolio',
    accessKeyId: 'AK',
    secretAccessKey: 'SK',
    prefix: 'att/',
  },
  client: fakeClient,
}

test('s3 分支：saveAttachment 走 putObject，键是 <prefix><id>.<ext>', async () => {
  __setStorageForTests(FAKE_STORAGE as any)
  try {
    const row = await store.saveAttachment({ data: PNG, kind: 'image', mime: 'image/png', ext: 'png', name: 'a.png' })
    assert.equal(row.storage, 's3')
    assert.equal(row.object_key, 'att/' + row.id + '.png')
    assert.deepEqual(puts.at(-1), 'att/' + row.id + '.png')
    // 本地磁盘上不该有它
    assert.equal(existsSync(store.attachmentPath(row)), false)
    assert.equal(store.readAttachmentFile(row), null)
  } finally {
    __resetStorageForTests()
  }
})

test('s3 分支：openAttachment 把对象流出来，Range 透传 206', async () => {
  __setStorageForTests(FAKE_STORAGE as any)
  try {
    const row = await store.saveAttachment({ data: PNG, kind: 'image', mime: 'image/png', ext: 'png' })
    const whole = await store.openAttachment(row)
    assert.equal(whole?.status, 200)
    assert.deepEqual(Buffer.from(await new Response(whole!.body).arrayBuffer()), PNG)

    const part = await store.openAttachment(row, 'bytes=0-3')
    assert.equal(part?.status, 206)
    assert.equal(part?.contentRange, 'bytes 0-3/' + PNG.length)
    assert.deepEqual(Buffer.from(await new Response(part!.body).arrayBuffer()), PNG.subarray(0, 4))
  } finally {
    __resetStorageForTests()
  }
})

test('s3 分支：删便签 / 清扫孤儿都会 deleteObject', async () => {
  __setStorageForTests(FAKE_STORAGE as any)
  try {
    const note = makeNote()
    const row = await store.saveAttachment({ data: PNG, kind: 'image', mime: 'image/png', ext: 'png' })
    store.syncNoteAttachments(note, markdownFor(row.id))
    assert.equal(await store.deleteAttachmentsForNote(note), 1)
    assert.ok(deletes.includes(row.object_key!))
    assert.equal(objects.has(row.object_key!), false)

    const stale = await store.saveAttachment({ data: PNG, kind: 'image', mime: 'image/png', ext: 'png' })
    run('UPDATE attachments SET created_at = ? WHERE id = ?', new Date(Date.now() - 9 * 86400_000).toISOString(), stale.id)
    await store.sweepAttachments()
    assert.ok(deletes.includes(stale.object_key!))
    assert.equal(store.findAttachment(stale.id), null)
  } finally {
    __resetStorageForTests()
  }
})

test('s3 分支：上传失败要回滚行，不留半条记录', async () => {
  const broken = { ...FAKE_STORAGE, client: { ...fakeClient, async putObject() { throw new Error('boom') } } }
  __setStorageForTests(broken as any)
  try {
    const before = store.totalAttachmentBytes()
    await assert.rejects(() => store.saveAttachment({ data: PNG, kind: 'image', mime: 'image/png', ext: 'png' }), /boom/)
    assert.equal(store.totalAttachmentBytes(), before)
  } finally {
    __resetStorageForTests()
  }
})
