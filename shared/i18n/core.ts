// 中英双语的公共内核（前端与服务端共用）。
//
// 字典是「中文原文 → 英文译文」的扁平映射，源码里直接写 t('保存') 就行：
// 好处是没翻译的条目自动回落到中文原文（渐进式，永不报错），也不用为每条文案起 key。
// 占位符用 {name}，中文原文里也可以有（t('共 {n} 封', { n })）。
export type Locale = 'zh' | 'en'
export type Vars = Record<string, string | number>
/** 英译可以是字符串（支持 {name} 占位），也可以是函数（复数、语序特殊时用） */
export type Entry = string | ((vars: Vars) => string)
export type Dict = Record<string, Entry>

export function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

export function translate(dict: Dict, locale: Locale, text: string, vars?: Vars): string {
  if (locale === 'en') {
    const e = dict[text]
    if (typeof e === 'function') return e(vars ?? {})
    if (typeof e === 'string') return interpolate(e, vars)
  }
  return interpolate(text, vars)
}

/**
 * Accept-Language → 界面语言（纯函数，有单测）。
 * 没这个头就是中文（源码语言）；按 q 值取最高优先，zh* 判中文，其余判英文。
 */
export function pickLocale(header?: string | null): Locale {
  if (!header) return 'zh'
  let best = -1
  let picked: Locale = 'zh'
  for (const part of header.split(',')) {
    const [tag, ...params] = part.trim().split(';')
    // `*` 是「随便什么语言」，Node 的 fetch 默认就发这个 —— 当成没偏好，回落源码语言
    if (!tag || tag === '*') continue
    const qp = params.map((s) => s.trim()).find((s) => s.startsWith('q='))
    const q = qp ? Number(qp.slice(2)) : 1
    if (Number.isNaN(q)) continue
    if (q > best) {
      best = q
      picked = /^zh\b/i.test(tag) ? 'zh' : 'en'
    }
  }
  return best < 0 ? 'zh' : picked
}
