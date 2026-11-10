// 便签附件的纯逻辑：类型识别、正文引用解析、文件名与 Markdown 拼装。
// 无副作用、不碰文件系统与数据库，单测直接打这里（tests/unit/attachments-core.test.mts）。

import { t } from '../i18n.js'

/** 单个附件上限。视频随手一拍就几十 MB，100 MB 是「别再大了」的红线 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

/** kind 决定前端怎么渲染：image 直接显示，video / audio 用播放器，file 给下载卡片 */
export type AttachmentKind = 'image' | 'video' | 'audio' | 'file'

/** 识别结果：mime 决定浏览器怎么处理，ext 决定落盘文件名 / 对象键后缀 */
export type SniffedFile = { kind: AttachmentKind; mime: string; ext: string }

/** 认不出来的二进制一律当普通文件：只给下载，绝不让浏览器就地渲染 */
export const FALLBACK_FILE: SniffedFile = { kind: 'file', mime: 'application/octet-stream', ext: 'bin' }

/**
 * 只有这些类型允许 inline 显示在浏览器里。
 * **SVG 不在其中，也永远别加**：同源 SVG 里的 <script> 能跑（坑 57）。
 * text/html、application/xhtml+xml、xml 同理 —— 上传一个 .html 就等于拿到同源 XSS。
 */
const INLINE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/flac',
  'application/pdf',
])

export function canInline(mime: string): boolean {
  return INLINE_MIME.has(String(mime || '').toLowerCase())
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_SIG = [0xff, 0xd8, 0xff]
const ZIP_SIG = [0x50, 0x4b, 0x03, 0x04]
const GZIP_SIG = [0x1f, 0x8b]
const SEVENZIP_SIG = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]
const FLAC_SIG = [0x66, 0x4c, 0x61, 0x43]

function startsWith(buf: Uint8Array, sig: number[], at = 0): boolean {
  if (buf.length < at + sig.length) return false
  for (let i = 0; i < sig.length; i++) if (buf[at + i] !== sig[i]) return false
  return true
}

function ascii(buf: Uint8Array, at: number, len: number): string {
  let s = ''
  for (let i = 0; i < len && at + i < buf.length; i++) s += String.fromCharCode(buf[at + i])
  return s
}

/** ISO BMFF（mp4 / mov / m4a）的 brand 在第 8–12 字节 */
function isobmff(buf: Uint8Array): SniffedFile | null {
  if (ascii(buf, 4, 4) !== 'ftyp') return null
  const brand = ascii(buf, 8, 4)
  const compat = ascii(buf, 16, 24)
  const has = (needle: string) => brand === needle || compat.includes(needle)
  if (has('qt  ')) return { kind: 'video', mime: 'video/quicktime', ext: 'mov' }
  if (has('M4A ') || has('M4B ')) return { kind: 'audio', mime: 'audio/mp4', ext: 'm4a' }
  if (has('avif') || has('avis')) return { kind: 'image', mime: 'image/avif', ext: 'avif' }
  if (has('heic') || has('heix') || has('mif1')) return { kind: 'image', mime: 'image/heic', ext: 'heic' }
  // 剩下的 isom / mp42 / avc1 / M4V / dash 都是 mp4 家族
  return { kind: 'video', mime: 'video/mp4', ext: 'mp4' }
}

/**
 * 按魔数判类型：不看文件名、也不信请求头。
 * 后缀随手改、Content-Type 随手写，只有开头几个字节骗不了人。
 * 认不出来就返回 null，由调用方当成 FALLBACK_FILE（普通文件、只给下载）。
 */
export function sniffFile(buf: Uint8Array | null | undefined): SniffedFile | null {
  if (!buf || buf.length < 12) return null
  // 图片
  if (startsWith(buf, PNG_SIG)) return { kind: 'image', mime: 'image/png', ext: 'png' }
  if (startsWith(buf, JPEG_SIG)) return { kind: 'image', mime: 'image/jpeg', ext: 'jpg' }
  const head6 = ascii(buf, 0, 6)
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return { kind: 'image', mime: 'image/gif', ext: 'gif' }
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WEBP') return { kind: 'image', mime: 'image/webp', ext: 'webp' }
  const iso = isobmff(buf)
  if (iso) return iso

  // 音视频
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WAVE') return { kind: 'audio', mime: 'audio/wav', ext: 'wav' }
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'AVI ') return { kind: 'video', mime: 'video/x-msvideo', ext: 'avi' }
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) {
    const probe = ascii(buf, 0, Math.min(buf.length, 512))
    return probe.includes('webm')
      ? { kind: 'video', mime: 'video/webm', ext: 'webm' }
      : { kind: 'video', mime: 'video/x-matroska', ext: 'mkv' }
  }
  if (ascii(buf, 0, 4) === 'OggS') {
    const probe = ascii(buf, 0, Math.min(buf.length, 512))
    return probe.includes('theora')
      ? { kind: 'video', mime: 'video/ogg', ext: 'ogv' }
      : { kind: 'audio', mime: 'audio/ogg', ext: 'ogg' }
  }
  if (ascii(buf, 0, 4) === 'fLaC' || startsWith(buf, FLAC_SIG)) return { kind: 'audio', mime: 'audio/flac', ext: 'flac' }
  if (ascii(buf, 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) {
    return { kind: 'audio', mime: 'audio/mpeg', ext: 'mp3' }
  }
  // 0x47 是 MPEG-TS 的同步字节，188 字节一个包
  if (buf[0] === 0x47 && buf.length > 376 && buf[188] === 0x47) return { kind: 'video', mime: 'video/mp2t', ext: 'ts' }

  // 文档 / 压缩包：都是「下载就行」的类型
  if (ascii(buf, 0, 5) === '%PDF-') return { kind: 'file', mime: 'application/pdf', ext: 'pdf' }
  if (startsWith(buf, ZIP_SIG)) return { kind: 'file', mime: 'application/zip', ext: 'zip' }
  if (startsWith(buf, SEVENZIP_SIG)) return { kind: 'file', mime: 'application/x-7z-compressed', ext: '7z' }
  if (startsWith(buf, GZIP_SIG)) return { kind: 'file', mime: 'application/gzip', ext: 'gz' }
  if (ascii(buf, 0, 4) === 'Rar!') return { kind: 'file', mime: 'application/vnd.rar', ext: 'rar' }
  return null
}

/** 只要图片的旧接口（浏览器端压缩前判断用）。不是图片就返回 null */
export function sniffImage(buf: Uint8Array | null | undefined): { mime: string; ext: string } | null {
  const sniffed = sniffFile(buf)
  if (!sniffed || sniffed.kind !== 'image') return null
  return { mime: sniffed.mime, ext: sniffed.ext }
}

/** 正文里引用了哪些附件（去重、升序）。认 `/api/attachments/12`，也认手写的 `attachments/12` */
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

/** 附件的取用地址（相对站点根；前端渲染时再按 API_BASE 重写，公网子路径也能用） */
export function attachmentUrl(id: number): string {
  return '/api/attachments/' + id
}

/** 插进正文的图片 Markdown。alt 里的方括号会破坏语法，先去掉 */
export function imageMarkdown(id: number, alt = ''): string {
  return '![' + String(alt).replace(/[[\]]/g, '') + '](' + attachmentUrl(id) + ')'
}

/** 插进正文的普通文件 Markdown：显示成可点的文件名，点了就是下载 */
export function fileMarkdown(id: number, name = ''): string {
  const label = String(name || '').replace(/[[\]\r\n]/g, '').trim() || t('附件') + '-' + id
  return '[' + label + '](' + attachmentUrl(id) + ')'
}

/**
 * SNAPSHOT.md 用：把附件引用收成 `[图片]` / `[附件：名字]`。
 * 快照是给人看 / 给 grep 用的，刷一屏 URL 没意义；真身在对象存储或 data/uploads/。
 */
export function attachmentsAsText(content: string): string {
  return String(content || '')
    .replace(/!\[([^\]]*)\]\(([^)\s]*\/attachments\/\d+[^)\s]*)\)/g, (_all, alt: string) =>
      alt ? t('[图片：{alt}]', { alt }) : t('[图片]'),
    )
    .replace(/(?<!!)\[([^\]]*)\]\(([^)\s]*\/attachments\/\d+[^)\s]*)\)/g, (_all, label: string) =>
      label ? t('[附件：{name}]', { name: label }) : t('[附件]'),
    )
}

/** 旧名字留着：别的地方还在 import 它 */
export const imagesAsText = attachmentsAsText

/** 解析 Range 头（下载 100 MB 视频要能拖动进度条）。null = 不用管；'invalid' = 给 416 */
export type ByteRange = { start: number; end: number }

export function parseByteRange(header: string | null | undefined, size: number): ByteRange | null | 'invalid' {
  const raw = String(header ?? '').trim()
  if (!raw) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(raw)
  if (!m) return 'invalid'
  const size0 = Number(size)
  if (!Number.isSafeInteger(size0) || size0 <= 0) return 'invalid'
  const [, a, b] = m
  if (a === '' && b === '') return 'invalid'
  if (a === '') {
    const suffix = Number(b)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'invalid'
    return { start: Math.max(0, size0 - suffix), end: size0 - 1 }
  }
  const start = Number(a)
  if (!Number.isSafeInteger(start) || start >= size0) return 'invalid'
  const end = b === '' ? size0 - 1 : Math.min(Number(b), size0 - 1)
  if (!Number.isSafeInteger(end) || end < start) return 'invalid'
  return { start, end }
}

/** Content-Disposition：ASCII 回退 + RFC 5987 的 filename*，中文文件名也能正确落地 */
export function contentDisposition(name: string, fallback: string, inline: boolean): string {
  const verb = inline ? 'inline' : 'attachment'
  const full = String(name || '').trim() || fallback
  const ascii = full.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_').slice(0, 120) || fallback
  const encoded = encodeURIComponent(full)
    .replace(/['()*]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase())
  return verb + '; filename="' + ascii + '"; filename*=UTF-8\'\'' + encoded
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
