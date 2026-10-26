import { t } from '../i18n.js'

/**
 * IMAP 账号的代理地址规范化。纯函数，单独放一个文件是为了能单测（store.ts 依赖 db.ts）。
 */

/** imapflow 支持的代理协议（http/https 走 CONNECT，其余走 SOCKS） */
export const PROXY_SCHEMES = ['socks', 'socks5', 'socks4', 'socks4a', 'http', 'https']

/**
 * 规范化代理地址：允许只写 host:port（默认按 socks5 处理），
 * 统一成 imapflow 能吃的 URL。空字符串 = 直连。
 */
export function normalizeProxy(raw: unknown): { value: string } | { error: string } {
  const text = String(raw ?? '').trim()
  if (!text) return { value: '' }
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : 'socks5://' + text)
  } catch {
    return { error: t('代理地址格式不对，应形如 socks5://127.0.0.1:10808') }
  }
  const scheme = url.protocol.replace(/:$/, '').toLowerCase()
  if (!PROXY_SCHEMES.includes(scheme)) {
    return { error: t('代理只支持 socks5 / socks4 / socks4a / socks / http / https') }
  }
  if (!url.hostname) return { error: t('代理地址缺少主机名') }
  if (url.pathname && url.pathname !== '/') return { error: t('代理地址不要带路径') }
  if (url.port && !(Number(url.port) >= 1 && Number(url.port) <= 65535)) {
    return { error: t('代理端口必须是 1-65535 之间的数字') }
  }
  const auth = url.username
    ? url.username + (url.password ? ':' + url.password : '') + '@'
    : ''
  return { value: scheme + '://' + auth + url.hostname + (url.port ? ':' + url.port : '') }
}
