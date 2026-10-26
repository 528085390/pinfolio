// 便签图片的落盘与回收：data/uploads/<id>.<ext> + attachments 表。
// 「正文是唯一真相」这条规矩全在这里实现（syncNoteAttachments / sweepAttachments）。
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR, all, get, run, nowIso } from '../db.js'
import { attachmentIdsIn, uploadFileName } from './core.js'

/** 图片真身目录。跟着库一起进备份包（见 server/backup/collect.ts），否则换机恢复全是破图 */
export const UPLOAD_DIR = join(DATA_DIR, 'uploads')

/** 正文里没人引用后还留多久（给「删了又想粘回来」留后悔窗口） */
export const ORPHAN_TTL_DAYS = 7

export type AttachmentRow = {
  id: number
  note_id: number | null
  mime: string
  ext: string
  bytes: number
  name: string
  created_at: string
}

const COLS = 'id, note_id, mime, ext, bytes, name, created_at'

export function ensureUploadDir(): void {
  mkdirSync(UPLOAD_DIR, { recursive: true })
}

export function attachmentPath(row: Pick<AttachmentRow, 'id' | 'ext'>): string {
  return join(UPLOAD_DIR, uploadFileName(row.id, row.ext))
}

/** 先插行拿 id（文件名要用 id），再写文件；写失败就把行删掉，不留半条记录 */
export function saveAttachment(input: {
  data: Buffer
  mime: string
  ext: string
  name?: string
  noteId?: number | null
}): AttachmentRow {
  ensureUploadDir()
  const { id } = run(
    'INSERT INTO attachments (note_id, mime, ext, bytes, name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    input.noteId ?? null,
    input.mime,
    input.ext,
    input.data.length,
    input.name ?? '',
    nowIso(),
  )
  const target = join(UPLOAD_DIR, uploadFileName(id, input.ext))
  const tmp = target + '.tmp'
  try {
    writeFileSync(tmp, input.data)
    renameSync(tmp, target)
  } catch (err) {
    try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
    run('DELETE FROM attachments WHERE id = ?', id)
    throw err
  }
  return get<AttachmentRow>('SELECT ' + COLS + ' FROM attachments WHERE id = ?', id)!
}

export function findAttachment(id: number): AttachmentRow | null {
  return get<AttachmentRow>('SELECT ' + COLS + ' FROM attachments WHERE id = ?', id) ?? null
}

/** 读文件；行还在但文件没了（手工删过 data/uploads）就返回 null，由路由给 404 */
export function readAttachmentFile(row: AttachmentRow): Buffer | null {
  const p = attachmentPath(row)
  if (!existsSync(p)) return null
  try { return readFileSync(p) } catch { return null }
}

function removeFile(row: Pick<AttachmentRow, 'id' | 'ext'>): void {
  try { rmSync(attachmentPath(row), { force: true }) } catch { /* ignore */ }
}

/** 这张图是否还被**别的**便签正文引用（复制粘贴过整段正文时会这样） */
function referencedElsewhere(id: number, exceptNoteId: number): boolean {
  const row = get<{ n: number }>(
    'SELECT COUNT(*) AS n FROM notes WHERE id <> ? AND content GLOB ?',
    exceptNoteId,
    '*/attachments/' + id + '[^0-9]*',
  )
  return Number(row?.n ?? 0) > 0
}

/**
 * 便签被永久删除：它的图立刻删。
 * 但要是别的便签正文里还引用着同一张（整段复制过），只解绑、不删文件。
 */
export function deleteAttachmentsForNote(noteId: number): number {
  const rows = all<AttachmentRow>('SELECT ' + COLS + ' FROM attachments WHERE note_id = ?', noteId)
  let removed = 0
  for (const row of rows) {
    if (referencedElsewhere(row.id, noteId)) {
      run('UPDATE attachments SET note_id = NULL WHERE id = ?', row.id)
      continue
    }
    removeFile(row)
    run('DELETE FROM attachments WHERE id = ?', row.id)
    removed++
  }
  return removed
}

/**
 * 正文变了：把 note_id 跟着正文重新绑一遍。
 * 正文里删掉的图立刻变孤儿（7 天后清扫），新引用的图绑到这条便签上。
 */
export function syncNoteAttachments(noteId: number, content: string): void {
  run('UPDATE attachments SET note_id = NULL WHERE note_id = ?', noteId)
  for (const id of attachmentIdsIn(content)) {
    run('UPDATE attachments SET note_id = ? WHERE id = ? AND note_id IS NULL', noteId, id)
  }
}

/**
 * 清扫：正文里没人引用、且放满 ttlDays 天的图连文件一起删；
 * 顺手清掉 data/uploads 里库里没登记的野文件（比如迁移失败留下的）。
 */
export function sweepAttachments(now = Date.now(), ttlDays = ORPHAN_TTL_DAYS): number {
  ensureUploadDir()
  const cutoff = new Date(now - ttlDays * 86400_000).toISOString()
  const stale = all<AttachmentRow>('SELECT ' + COLS + ' FROM attachments WHERE note_id IS NULL AND created_at < ?', cutoff)
  for (const row of stale) removeFile(row)
  if (stale.length) run('DELETE FROM attachments WHERE note_id IS NULL AND created_at < ?', cutoff)

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

/** 每天扫一次（启动 1 分钟后先跑一次）。unref 掉，不挡进程退出 */
export function startAttachmentSweep(intervalMs = 24 * 3600_000): void {
  const tick = () => {
    try {
      const n = sweepAttachments()
      if (n) console.log('  清理未引用图片  ->  ' + n + ' 个')
    } catch (err) {
      console.error('[attachments] 清理失败：' + (err instanceof Error ? err.message : String(err)))
    }
  }
  setTimeout(tick, 60_000).unref()
  setInterval(tick, intervalMs).unref()
}
