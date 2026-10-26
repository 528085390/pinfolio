import { useSyncExternalStore } from 'react'
import { translate, type Locale, type Vars } from '../../../shared/i18n/core'
import { en } from '../../../shared/i18n/en/index'

// 界面语言：localStorage 记住手动选择；第一次访问跟随浏览器（zh* → 中文，其余 → 英文）。
//
// 关键约束：t() 是**普通函数**（不是 hook），所以纯函数、模块级常量、事件回调里都能用。
// 语言变化时靠 useLocale() 订阅一次（App 根部），整个树重渲染即可；
// 以后谁用 React.memo 包组件，那个组件必须自己再调一次 useLocale()，否则切语言时不会重渲染
// （目前 web/ 里没有一处 memo，重复订阅是无害的空操作；见 docs/i18n.md 的「前端」一节）。
export const LOCALE_KEY = 'pinboard-locale'

export type { Locale }

export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_KEY)
    if (saved === 'zh' || saved === 'en') return saved
  } catch {
    // 隐私模式下 localStorage 会抛，忽略
  }
  const langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || '']
  const list = langs.filter(Boolean)
  if (!list.length) return 'zh'
  return list.some((l) => /^zh/i.test(l)) ? 'zh' : 'en'
}

let current: Locale = detectLocale()
const listeners = new Set<() => void>()

export function getLocale(): Locale {
  return current
}

/** BCP-47 标签，给 <html lang> 和 toLocaleString / localeCompare 用 */
export function localeTag(): string {
  return current === 'zh' ? 'zh-CN' : 'en'
}

export function applyLocale(): void {
  document.documentElement.lang = localeTag()
}

export function setLocale(next: Locale): void {
  if (next === current) return
  current = next
  try {
    localStorage.setItem(LOCALE_KEY, next)
  } catch {
    // 同上，存不下就只在本次生效
  }
  applyLocale()
  for (const fn of listeners) fn()
}

export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 取当前语言的译文（缺条目回落中文原文） */
export function t(text: string, vars?: Vars): string {
  return translate(en, current, text, vars)
}

/** 用「 · 」把非空片段连起来：顶栏副标题、卡片副行这类地方统一走它 */
export function dot(...parts: Array<string | null | undefined | false>): string {
  return parts.filter(Boolean).join(' · ')
}

/** 组件里订阅语言变化；切语言时用它所在的树重渲染 */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale)
}
