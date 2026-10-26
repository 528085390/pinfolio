import { AsyncLocalStorage } from 'node:async_hooks'
import { pickLocale, translate, type Locale, type Vars } from '../shared/i18n/core.js'
import { en } from '../shared/i18n/en/index.js'

// 服务端文案的翻译。语言来自请求头 Accept-Language（前端每次请求都会带上），
// 用 AsyncLocalStorage 传下去，这样各处只要写 t('…')，不用把 locale 一路当参数传。
const als = new AsyncLocalStorage<Locale>()

export { pickLocale }

/** 在一个请求的作用域里指定语言 */
export function withLocale<T>(locale: Locale, fn: () => T): T {
  return als.run(locale, fn)
}

export function currentLocale(): Locale {
  return als.getStore() ?? 'zh'
}

export function t(text: string, vars?: Vars): string {
  return translate(en, currentLocale(), text, vars)
}
