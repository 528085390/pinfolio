import { Hono } from 'hono'
import { attachmentUrl, cleanFileName, MAX_UPLOAD_BYTES, sniffImage } from '../attachments/core.js'
import { findAttachment, readAttachmentFile, saveAttachment } from '../attachments/store.js'

export const attachmentsRoute = new Hono()

/**
 * 上传一张图：请求体就是图片二进制（不走 multipart，省一层解析、也省一个依赖）。
 * 鉴权 + CSRF 在 auth/middleware.ts：那里按 `content-type: image/*` 单独放行这一条（见坑 57）。
 */
attachmentsRoute.post('/', async (c) => {
  const buf = Buffer.from(await c.req.arrayBuffer())
  if (!buf.length) return c.json({ error: '空文件' }, 400)
  if (buf.length > MAX_UPLOAD_BYTES) return c.json({ error: '图片太大，单张上限 10 MB' }, 413)
  const kind = sniffImage(buf)
  if (!kind) return c.json({ error: '只支持 PNG / JPEG / WebP / GIF 图片' }, 415)
  const noteId = Number(c.req.query('noteId') || '') || null
  const name = cleanFileName(c.req.query('name') || c.req.header('x-file-name') || '')
  const row = saveAttachment({ data: buf, mime: kind.mime, ext: kind.ext, name, noteId })
  return c.json({ id: row.id, url: attachmentUrl(row.id), mime: row.mime, bytes: row.bytes, name: row.name }, 201)
})

/**
 * 取图：和其他 /api 路由一样要登录。
 * 同一个 id 的内容永不改写（改图 = 新 id），所以可以 immutable 缓存一年。
 */
attachmentsRoute.get('/:id', (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: '图片不存在' }, 404)
  const row = findAttachment(id)
  if (!row) return c.json({ error: '图片不存在' }, 404)
  const data = readAttachmentFile(row)
  if (!data) return c.json({ error: '图片文件已丢失' }, 404)
  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      'Content-Type': row.mime,
      'Content-Length': String(data.length),
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Disposition': 'inline; filename="' + row.id + '.' + row.ext + '"',
    },
  })
})
