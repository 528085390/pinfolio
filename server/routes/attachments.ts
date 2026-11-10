import { Hono } from 'hono'
import {
  attachmentUrl,
  canInline,
  cleanFileName,
  contentDisposition,
  FALLBACK_FILE,
  MAX_UPLOAD_BYTES,
  sniffFile,
} from '../attachments/core.js'
import { AttachmentQuotaError, findAttachment, openAttachment, saveAttachment } from '../attachments/store.js'
import { t } from '../i18n.js'

export const attachmentsRoute = new Hono()

/** 上传必带的标记头：跨站表单发不出自定义请求头，这条就是 CSRF 防线（见 auth/middleware.ts） */
export const UPLOAD_HEADER = 'x-pinfolio-upload'

/**
 * 上传一个附件：请求体就是文件二进制（不走 multipart，省一层解析、也省一个依赖）。
 * 类型只看魔数：后缀和 Content-Type 都不可信。
 */
attachmentsRoute.post('/', async (c) => {
  if (c.req.header(UPLOAD_HEADER) !== '1') {
    return c.json({ error: t('上传请求缺少标记头') }, 400)
  }
  const declared = Number(c.req.header('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
    return c.json({ error: t('文件太大，单个上限 100 MB') }, 413)
  }
  const buf = Buffer.from(await c.req.arrayBuffer())
  if (!buf.length) return c.json({ error: t('空文件') }, 400)
  if (buf.length > MAX_UPLOAD_BYTES) return c.json({ error: t('文件太大，单个上限 100 MB') }, 413)
  const sniffed = sniffFile(buf) ?? FALLBACK_FILE
  const noteId = Number(c.req.query('noteId') || '') || null
  const name = cleanFileName(c.req.query('name') || c.req.header('x-file-name') || '')
  try {
    const row = await saveAttachment({
      data: buf,
      kind: sniffed.kind,
      mime: sniffed.mime,
      ext: sniffed.ext,
      name,
      noteId,
    })
    return c.json(
      { id: row.id, url: attachmentUrl(row.id), kind: row.kind, mime: row.mime, bytes: row.bytes, name: row.name },
      201,
    )
  } catch (err) {
    if (err instanceof AttachmentQuotaError) {
      return c.json({ error: t('附件空间已满（上限 15 GB），先清理旧文件') }, 507)
    }
    throw err
  }
})

/**
 * 取附件：和其他 /api 路由一样要登录。
 * 同一个 id 的内容永不改写（改内容 = 新 id），所以可以 immutable 缓存一年。
 * 只有白名单里的类型 inline 显示，其余一律 attachment 下载 + nosniff —— 上传的 html / svg 永远进不了解析器。
 */
attachmentsRoute.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: t('附件不存在') }, 404)
  const row = findAttachment(id)
  if (!row) return c.json({ error: t('附件不存在') }, 404)

  let blob
  try {
    blob = await openAttachment(row, c.req.header('range'))
  } catch (err) {
    console.error('[attachments] 读取失败 ' + id + '：' + (err instanceof Error ? err.message : String(err)))
    return c.json({ error: t('附件读取失败') }, 502)
  }
  if (!blob) return c.json({ error: t('附件文件已丢失') }, 404)
  if (blob.status === 416) {
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + row.bytes } })
  }

  const inline = canInline(row.mime)
  const headers: Record<string, string> = {
    'Content-Type': inline ? row.mime : 'application/octet-stream',
    'Content-Length': String(blob.size),
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Content-Disposition': contentDisposition(row.name, row.id + '.' + row.ext, inline),
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
  }
  if (blob.contentRange) headers['Content-Range'] = blob.contentRange
  return new Response(blob.body, { status: blob.status, headers })
})
