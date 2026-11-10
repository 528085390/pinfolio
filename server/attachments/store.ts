// 便签附件的存取与回收：本地 data/uploads/<id>.<ext> 或对象存储 <prefix><id>.<ext>，外加 attachments 表。
// 「正文是唯一真相」这条规矩全在这里实现（syncNoteAttachments / sweepAttachments）。
//
// 两处存储的分工：写入看当前配置（storage().config.driver），读取看行里记的 storage 列 ——
// 这样从本地切到对象存储后，老附件照样能打开，不用先搬数据。
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { DATA_DIR, all, get, run, nowIso } from '../db.js'
import { sha256Hex } from '../storage/sigv4.js'
import { quotaBytes, storage } from '../storage/index.js'
import { attachmentIdsIn, parseByteRange, uploadFileName } from './core.js'

/** 本地附件真身目录。跟着库一起进备份包（见 server/backup/collect.ts），否则换机恢复全是破图 */
export const UPLOAD_DIR = join(DATA_DIR, 'uploads')

/** 正文里没人引用后还留多久（给「删了又想粘回来」留后悔窗口） */
export const ORPHAN_TTL_DAYS = 7

export type AttachmentStorage = 'local' | 's3'

export type AttachmentRow = {
  id: number
  note_id: number | null
  kind: string
  mime: string
  ext: string
  bytes: number
  name: string
  storage: AttachmentStorage
  object_key: string | null
  sha256: string | null
  created_at: string
}

const COLS = 'id, note_id, kind, mime, ext, bytes, name, storage, object_key, sha256, created_at'

/** 附件总量满了。路由据此回 507，别让用户以为是自己网络坏了 */
export class AttachmentQuotaError extends Error {
  bytes: number
  quota: number
  constructor(bytes: number, quota: number) {
    super('附件空间已满')
    this.name = 'AttachmentQuotaError'
    this.bytes = bytes
    this.quota = quota
  }
}

export function ensureUploadDir(): void {
  mkdirSync(UPLOAD_DIR, { recursive: true })
}

export function attachmentPath(row: Pick<AttachmentRow, 'id' | 'ext'>): string {
  return join(UPLOAD_DIR, uploadFileName(row.id, row.ext))
}

/** 对象键：前缀 + id.ext（键只由我们生成，不掺用户文件名） */
export function storageKey(id: number, ext: string): string {
  return storage().config.prefix + uploadFileName(id, ext)
}

/** 已经用掉多少字节（本地 + 对象存储一起算，配额是总量） */
export function totalAttachmentBytes(): number {
  const row = get<{ n: number | null }>('SELECT SUM(bytes) AS n FROM attachments')
  return Number(row?.n ?? 0)
}

/**
 * 存一个附件：先插行拿 id（文件名要用 id），再写字节。
 * 写失败就把行删掉，不留半条记录；配额先算，别等传完 100 MB 才说满了。
 */
export async function saveAttachment(input: {
  data: Buffer
  kind: string
  mime: string
  ext: string
  name?: string
  noteId?: number | null
}): Promise<AttachmentRow> {
  const quota = quotaBytes()
  const used = totalAttachmentBytes()
  if (used + input.data.length > quota) throw new AttachmentQuotaError(used + input.data.length, quota)

  const driver = storage().config.driver
  const { id } = run(
    'INSERT INTO attachments (note_id, kind, mime, ext, bytes, name, storage, object_key, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    input.noteId ?? null,
    input.kind,
    input.mime,
    input.ext,
    input.data.length,
    input.name ?? '',
    driver,
    null,
    sha256Hex(input.data),
    nowIso(),
  )
  try {
    if (driver === 's3') {
      const key = storageKey(id, input.ext)
      await storage().client!.putObject(key, input.data, input.mime)
      run('UPDATE attachments SET object_key = ? WHERE id = ?', key, id)
    } else {
      ensureUploadDir()
      const target = join(UPLOAD_DIR, uploadFileName(id, input.ext))
      const tmp = target + '.tmp'
      writeFileSync(tmp, input.data)
      renameSync(tmp, target)
    }
  } catch (err) {
    try { rmSync(join(UPLOAD_DIR, uploadFileName(id, input.ext)), { force: true }) } catch { /* ignore */ }
    run('DELETE FROM attachments WHERE id = ?', id)
    throw err
  }
  return get<AttachmentRow>('SELECT ' + COLS + ' FROM attachments WHERE id = ?', id)!
}

export function findAttachment(id: number): AttachmentRow | null {
  return get<AttachmentRow>('SELECT ' + COLS + ' FROM attachments WHERE id = ?', id) ?? null
}

/** 读本地文件；行还在但文件没了（手工删过 data/uploads）就返回 null，由路由给 404 */
export function readAttachmentFile(row: AttachmentRow): Buffer | null {
  if (row.storage !== 'local') return null
  const p = attachmentPath(row)
  if (!existsSync(p)) return null
  try { return readFileSync(p) } catch { return null }
}

export type AttachmentBlob = {
  /** 200 = 整份，206 = 一段（Range），416 = 区间越界 */
  status: number
  size: number
  contentRange?: string
  body: ReadableStream<Uint8Array> | null
}

/**
 * 打开一个附件给路由流式转发。
 * 本地走 createReadStream（100 MB 视频不会一次读进内存），对象存储直接把 undici 的流转手过去。
 */
export async function openAttachment(row: AttachmentRow, rangeHeader?: string | null): Promise<AttachmentBlob | null> {
  if (row.storage === 's3') {
    if (!row.object_key) return null
    const range = String(rangeHeader ?? '').trim()
    const res = await storage().client!.getObject(row.object_key, range || undefined)
    const size = Number(res.headers['content-length'] ?? 0)
    return {
      status: res.status === 206 ? 206 : 200,
      size,
      contentRange: res.headers['content-range'],
      body: res.body,
    }
  }

  const path = attachmentPath(row)
  if (!existsSync(path)) return null
  const size = statSync(path).size
  const parsed = parseByteRange(rangeHeader, size)
  if (parsed === 'invalid') return { status: 416, size: 0, body: null }
  if (!parsed) {
    return {
      status: 200,
      size,
      body: Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>,
    }
  }
  const len = parsed.end - parsed.start + 1
  return {
    status: 206,
    size: len,
    contentRange: 'bytes ' + parsed.start + '-' + parsed.end + '/' + size,
    body: Readable.toWeb(createReadStream(path, { start: parsed.start, end: parsed.end })) as ReadableStream<Uint8Array>,
  }
}

/** 删真身：本地删文件，对象存储删对象。删不掉只记日志 —— 图省事，别让一次网络抖动卡住删便签 */
async function removeBlob(row: AttachmentRow): Promise<void> {
  if (row.storage === 's3') {
    if (!row.object_key) return
    try { await storage().client!.deleteObject(row.object_key) } catch (err) {
      console.error('[attachments] 删除对象失败 ' + row.object_key + '：' + (err instanceof Error ? err.message : String(err)))
    }
    return
  }
  try { rmSync(attachmentPath(row), { force: true }) } catch { /* ignore */ }
}

/** 这个附件是否还被**别的**便签正文引用（复制粘贴过整段正文时会这样） */
function referencedElsewhere(id: number, exceptNoteId: number): boolean {
  const row = get<{ n: number }>(
    'SELECT COUNT(*) AS n FROM notes WHERE id <> ? AND content GLOB ?',
    exceptNoteId,
    '*/attachments/' + id + '[^0-9]*',
  )
  return Number(row?.n ?? 0) > 0
}

/**
 * 便签被永久删除：它的附件立刻删。
 * 但要是别的便签正文里还引用着同一个（整段复制过），只解绑、不删真身。
 */
export async function deleteAttachmentsForNote(noteId: number): Promise<number> {
  const rows = all<AttachmentRow>('SELECT ' + COLS + ' FROM attachments WHERE note_id = ?', noteId)
  let removed = 0
  for (const row of rows) {
    if (referencedElsewhere(row.id, noteId)) {
      run('UPDATE attachments SET note_id = NULL WHERE id = ?', row.id)
      continue
    }
    await removeBlob(row)
    run('DELETE FROM attachments WHERE id = ?', row.id)
    removed++
  }
  return removed
}

/**
 * 正文变了：把 note_id 跟着正文重新绑一遍。
 * 正文里删掉的附件立刻变孤儿（7 天后清扫），新引用的附件绑到这条便签上。
 */
export function syncNoteAttachments(noteId: number, content: string): void {
  run('UPDATE attachments SET note_id = NULL WHERE note_id = ?', noteId)
  for (const id of attachmentIdsIn(content)) {
    run('UPDATE attachments SET note_id = ? WHERE id = ? AND note_id IS NULL', noteId, id)
  }
}

/**
 * 清扫：正文里没人引用、且放满 ttlDays 天的附件连真身一起删；
 * 顺手清掉 data/uploads 里库里没登记的野文件（比如迁移失败留下的）。
 */
export async function sweepAttachments(now = Date.now(), ttlDays = ORPHAN_TTL_DAYS): Promise<number> {
  const cutoff = new Date(now - ttlDays * 86400_000).toISOString()
  const stale = all<AttachmentRow>(
    'SELECT ' + COLS + ' FROM attachments WHERE note_id IS NULL AND created_at < ?',
    cutoff,
  )
  for (const row of stale) await removeBlob(row)
  if (stale.length) run('DELETE FROM attachments WHERE note_id IS NULL AND created_at < ?', cutoff)

  ensureUploadDir()
  const known = new Set(all<{ id: number }>('SELECT id FROM attachments').map((r) => Number(r.id)))
  let strays = 0
  for (const name of readdirSync(UPLOAD_DIR)) {
    const m = /^(\d+)\.[a-z0-9]+$/.exec(name)
    if (!m) continue
    if (known.has(Number(m[1]))) continue
    try { rmSync(join(UPLOAD_DIR, name), { force: true }); strays++ } catch { /* ignore */ }
  }
  return stale.length + strays
}

let bootTimer: ReturnType<typeof setTimeout> | null = null
let timer: ReturnType<typeof setInterval> | null = null

/** 关服务时调：停掉开机 1 分钟后的首扫与 24 小时周期（重复调用无害）。 */
export function stopAttachmentSweep(): void {
  if (bootTimer) clearTimeout(bootTimer)
  if (timer) clearInterval(timer)
  bootTimer = null
  timer = null
}

/**
 * 每天扫一次（启动 1 分钟后先跑一次）。unref 掉，不挡进程退出。
 * 返回 stop（startServer 收集起来、close() 时调）；已经在跑时不会再挂第二份。
 */
export function startAttachmentSweep(intervalMs = 24 * 3600_000): () => void {
  if (timer) return stopAttachmentSweep
  const tick = () => {
    void sweepAttachments()
      .then((n) => { if (n) console.log('  清理未引用附件  ->  ' + n + ' 个') })
      .catch((err) => {
        console.error('[attachments] 清理失败：' + (err instanceof Error ? err.message : String(err)))
      })
  }
  bootTimer = setTimeout(tick, 60_000)
  bootTimer.unref()
  timer = setInterval(tick, intervalMs)
  timer.unref()
  return stopAttachmentSweep
}
