// 便签图片的前端纯逻辑：挑文件、按光标插入、把 /api/attachments/ 换成部署前缀、给 <img> 补懒加载。
// 全是纯函数，单测在 tests/unit/images.test.mts。

/** 只认这四种（与 server/attachments/core.ts 的魔数白名单一致）。SVG / HEIC 一律不收 */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

/** 有的系统给 image/jpg / image/pjpeg，归一成标准 MIME；不认识的返回 null */
export function normalizeImageType(type: string): string | null {
  const t = String(type || '').toLowerCase().trim()
  if (t === 'image/jpg' || t === 'image/pjpeg') return 'image/jpeg'
  return (IMAGE_TYPES as readonly string[]).includes(t) ? t : null
}

/** 从粘贴 / 拖拽 / 选择里挑出能收的图；其它文件直接忽略（拖一整段文字进来不该弹错） */
export function pickImageFiles(files: ArrayLike<File> | null | undefined): File[] {
  const out: File[] = []
  if (!files) return out
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    if (f && normalizeImageType(f.type) && f.size > 0) out.push(f)
  }
  return out
}

/** 插到光标处（有选区就替换选区）。前后补换行，让图片自己成一块，不粘在上一句末尾 */
export function insertSnippet(
  text: string,
  snippet: string,
  start?: number,
  end?: number,
): { text: string; caret: number } {
  const src = String(text ?? '')
  const s = Math.min(Math.max(0, start ?? src.length), src.length)
  const e = Math.min(Math.max(s, end ?? s), src.length)
  const before = src.slice(0, s)
  const after = src.slice(e)
  // 替换选区时原样替换（用户框住了要换的东西），只有「在光标处插入」才补空行让图自成一块
  const pad = s === e
  const lead = pad && before && !/\n$/.test(before) ? '\n\n' : ''
  const trail = pad && after && !/^\n/.test(after) ? '\n\n' : ''
  const inserted = lead + snippet + trail
  // 光标停在插入内容的末尾（不是补的空行之后），接着打字就贴在图下面
  return { text: before + inserted + after, caret: before.length + lead.length + snippet.length }
}

/** 插进正文的那段 Markdown（与 server/attachments/core.ts 的 imageMarkdown 一致） */
export function imageMarkdown(id: number, alt = ''): string {
  return '![' + String(alt).replace(/[[\]]/g, '') + '](/api/attachments/' + id + ')'
}

/**
 * 渲染前把 `/api/attachments/` 换成部署前缀：公网挂在 /pinfolio/ 下时 API_BASE 是 /pinfolio/api，
 * 正文里存的还是 `/api/attachments/12`（跟部署位置无关，库换机器不用改数据）。
 * 只改 src / href 的属性值，正文里的其它文字一概不碰。
 */
export function rewriteAttachmentUrls(html: string, apiBase: string): string {
  const base = String(apiBase || '').replace(/\/$/, '')
  if (!base) return String(html)
  return String(html).replace(/(\s(?:src|href)=["'])\/api\/attachments\//g, '$1' + base + '/attachments/')
}

/** 给 <img> 补 loading="lazy" / decoding="async"：一屏十几张图时别一次性全下 */
export function addImageAttrs(html: string): string {
  return String(html).replace(/<img\b([^>]*)>/g, (all, attrs: string) => {
    let extra = ''
    if (!/\sloading=/.test(attrs)) extra += ' loading="lazy"'
    if (!/\sdecoding=/.test(attrs)) extra += ' decoding="async"'
    return extra ? '<img' + attrs + extra + '>' : all
  })
}
