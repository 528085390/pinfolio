// 便签图片的纯逻辑：类型识别、正文引用解析、文件名与 Markdown 拼装。
// 无副作用、不碰文件系统与数据库，单测直接打这里（tests/unit/attachments-core.test.mts）。

/** 单张图上限。手机原图压完通常 100–400 KB，10 MB 是给「不压也硬传」留的兜底 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/** 只收这四种：浏览器原生能显示。**SVG 一律拒** —— 同源 SVG 里的 <script> 能跑（坑 57） */
export type ImageKind = { mime: string; ext: string }

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_SIG = [0xff, 0xd8, 0xff]

function startsWith(buf: Uint8Array, sig: number[]): boolean {
  if (buf.length < sig.length) return false
  for (let i = 0; i < sig.length; i++) if (buf[i] !== sig[i]) return false
  return true
}

function ascii(buf: Uint8Array, at: number, len: number): string {
  let s = ''
  for (let i = 0; i < len && at + i < buf.length; i++) s += String.fromCharCode(buf[at + i])
  return s
}

/**
 * 按魔数判类型：不看文件名、也不信请求头。
 * 后缀随手改、Content-Type 随手写，只有开头几个字节骗不了人。
 */
export function sniffImage(buf: Uint8Array | null | undefined): ImageKind | null {
  if (!buf || buf.length < 12) return null
  if (startsWith(buf, PNG_SIG)) return { mime: 'image/png', ext: 'png' }
  if (startsWith(buf, JPEG_SIG)) return { mime: 'image/jpeg', ext: 'jpg' }
  const head = ascii(buf, 0, 6)
  if (head === 'GIF87a' || head === 'GIF89a') return { mime: 'image/gif', ext: 'gif' }
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WEBP') return { mime: 'image/webp', ext: 'webp' }
  return null
}

/** 正文里引用了哪几张图（去重、升序）。认 `/api/attachments/12`，也认手写的 `attachments/12` */
export function attachmentIdsIn(content: string): number[] {
  const ids = new Set<number>()
  const re = /(?:\/|\b)attachments\/(\d+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(String(content || '')))) {
    const id = Number(m[1])
    if (Number.isSafeInteger(id) && id > 0) ids.add(id)
  }
  return [...ids].sort((a, b) => a - b)
}

/** 图片的取用地址（相对站点根；前端渲染时再按 API_BASE 重写，公网子路径也能用） */
export function attachmentUrl(id: number): string {
  return '/api/attachments/' + id
}

/** 插进正文的那段 Markdown。alt 里的方括号会破坏语法，先去掉 */
export function imageMarkdown(id: number, alt = ''): string {
  return '![' + String(alt).replace(/[[\]]/g, '') + '](' + attachmentUrl(id) + ')'
}

/**
 * SNAPSHOT.md 用：把图片引用收成 `[图片]`。
 * 快照是给人看 / 给 grep 用的，刷一屏 URL 没意义；真身在 data/uploads/。
 */
export function imagesAsText(content: string): string {
  return String(content || '').replace(/!\[([^\]]*)\]\(([^)\s]*\/attachments\/\d+[^)\s]*)\)/g, (_all, alt: string) =>
    alt ? '[图片：' + alt + ']' : '[图片]',
  )
}

/** 存盘文件名：只用 id + 扩展名（原始文件名只记在库里，免得路径穿越 / 重名 / 中文编码问题） */
export function uploadFileName(id: number, ext: string): string {
  return id + '.' + ext
}

/** 库里记的原始文件名：去掉路径与控制字符，只留 200 字，纯展示用 */
export function cleanFileName(name: string): string {
  const base = String(name || '').split(/[\\/]/).pop() ?? ''
  return base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200)
}
