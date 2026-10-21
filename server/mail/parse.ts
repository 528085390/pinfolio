// 邮件内容解析（纯函数）：地址/时间归一、把正文前 800 字节压成列表摘要。
// 不碰网络、不碰 IMAP、不碰数据库，所以能直接单测（tests/unit/mail-parse.test.mts）。
import type { Addr } from './types.js'

export function addrList(input: any): Addr[] {
  // mailparser 返回 AddressObject { value: [...] }，imapflow 的 envelope 返回数组
  const list = Array.isArray(input) ? input : Array.isArray(input?.value) ? input.value : input ? [input] : []
  return list
    .map((a: any) => ({ name: String(a?.name || ''), address: String(a?.address || '') }))
    .filter((a: Addr) => a.address || a.name)
}

export function addrOne(input: any): Addr | null {
  const list = addrList(input)
  return list[0] || null
}

export function toIso(d: any): string | null {
  if (!d) return null
  const date = d instanceof Date ? d : new Date(d)
  return isNaN(date.getTime()) ? null : date.toISOString()
}

// ---------- 摘要提取（列表页只抓 BODY[TEXT] 前 800 字节，不下载整封信）----------

function decodeQuotedPrintable(s: string): string {
  const txt = s.replace(/=\r?\n/g, '')
  const bytes: number[] = []
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i]
    if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(txt.slice(i + 1, i + 3))) {
      bytes.push(parseInt(txt.slice(i + 1, i + 3), 16))
      i += 2
    } else {
      bytes.push(txt.charCodeAt(i) & 0xff)
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&mdash;': '—', '&hellip;': '…',
}

function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<!--[\s\S]*$/g, ' ')
    .replace(/<![^>]*>/g, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&[a-zA-Z]+;/g, (m) => ENTITIES[m.toLowerCase()] ?? ' ')
    .replace(/[ \t\u00a0]+/g, ' ')
}

type RawPart = { headers: string; body: string }

function splitParts(text: string): RawPart[] {
  const out: RawPart[] = []
  const chunks = text.split(/^--[^\r\n]+/m)
  if (chunks.length <= 1) return []
  for (const chunk of chunks.slice(1)) {
    if (/^--\s*$/.test(chunk.split(/\r?\n/)[0] || '')) continue
    const idx = chunk.search(/\r?\n\r?\n/)
    if (idx < 0) continue
    const headers = chunk.slice(0, idx)
    let body = chunk.slice(idx).replace(/^\r?\n\r?\n/, '')
    if (/content-type:\s*multipart/i.test(headers)) continue
    out.push({ headers, body })
  }
  return out
}

function decodePart(part: RawPart): string {
  let body = part.body
  const cte = /content-transfer-encoding:\s*([\w-]+)/i.exec(part.headers)?.[1]?.toLowerCase() || ''
  const charset = /charset="?([\w-]+)/i.exec(part.headers)?.[1] || 'utf-8'
  if (cte === 'base64') {
    body = Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64').toString('utf8')
  } else if (cte === 'quoted-printable') {
    body = decodeQuotedPrintable(body)
  }
  if (charset && !/^utf-?8$/i.test(charset)) {
    // 非 UTF-8 的邮件不多，能解就解，解不了保留原文
    try {
      const bytes = Buffer.from(body, 'latin1')
      body = new TextDecoder(charset as string).decode(bytes)
    } catch { /* keep as is */ }
  }
  return body
}

export function snippetFromText(raw: Buffer | undefined): string {
  if (!raw || !raw.length) return ''
  const text = raw.toString('utf8')
  const parts = splitParts(text)
  let body = ''
  if (parts.length) {
    const plain = parts.find((p) => /content-type:\s*text\/plain/i.test(p.headers))
    const html = parts.find((p) => /content-type:\s*text\/html/i.test(p.headers))
    body = plain ? decodePart(plain) : html ? htmlToText(decodePart(html)) : ''
    if (!body.trim()) body = parts.map((p) => decodePart(p)).join(' ')
  } else {
    body = text
  }
  if (/<html|<body|<div|<p[\s>]|<br|<!--|<!\[/i.test(body)) body = htmlToText(body)
  // 有些发件人把 HTML（含 Outlook 条件注释）塞进 text/plain 分支，
  // 还有些正文里是 [image: xxx] / [cid:xxx] 这种内嵌图占位符——列表摘要里都得清掉
  return body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // 注释可能被 IMAP 的 maxLength 截断成「<!--[if …」没有收尾，剩下的一律当注释吃掉
    .replace(/<!--[\s\S]*$/g, ' ')
    .replace(/<![^>]*>/g, ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/\[(?:image|cid)\s*:[^\]]*\]/gi, ' ')
    // 营销邮件爱用零宽字符/组合字形连接符撑开摘要预览，摘要里没意义
    .replace(/[\u034f\u00ad\u200b-\u200d\u2060\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
}
