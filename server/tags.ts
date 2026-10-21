/**
 * 标签的纯函数：配色、正文里的 #标签 解析、预设标签。
 * 单独放一个文件是为了能单测 —— db.ts 一 import 就会打开 SQLite、跑迁移，测试环境不该碰真库。
 */

export const TAG_COLORS = ['#b45309', '#0f766e', '#7c3aed', '#be123c', '#0369a1', '#4d7c0f', '#a16207', '#c2410c', '#0e7490', '#9333ea']

/** 同一个标签名永远得到同一种颜色：对码点做 31 进制滚动哈希再取模。 */
export function tagColor(name: string) {
  let h = 0
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) || 0)) >>> 0
  return TAG_COLORS[h % TAG_COLORS.length]
}

// 前面必须是行首或空白/标点，避免把 URL 里的 #anchor 当成标签。
const TAG_RE = /(?:^|[\s(（\[【,，、。．！!？?；;：:>"'“”‘’《》「」『』])#([\p{L}\p{N}_\-\/]+)/gu

export function extractTags(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(TAG_RE)) {
    const t = m[1].replace(/[.,;:!?]+$/, '')
    if (t) out.add(t)
  }
  return [...out]
}

export const PRESET_TAGS: [string, string][] = [
  ['待办', '#d97706'],
  ['想法', '#7c3aed'],
  ['阅读', '#0369a1'],
  ['工作', '#0f766e'],
  ['学习', '#4d7c0f'],
  ['生活', '#15803d'],
  ['灵感', '#a16207'],
  ['重要', '#b91c1c'],
  ['整理', '#65a30d'],
  ['运维', '#57534e'],
  ['账号', '#be123c'],
  ['购物', '#c2410c'],
]
