/**
 * 页面与 URL 的对应关系。纯函数，放在这里是为了能单测 —— router.ts 里带着 React hooks。
 */

export type Page = 'notes' | 'mail' | 'assets' | 'monitors' | 'hosts' | 'settings'

/** 每个页面在地址栏里的规范路径。改这里等于改 URL 约定。 */
export const PATHS: Record<Page, string> = {
  notes: '/notes',
  mail: '/mail',
  assets: '/assets',
  monitors: '/monitors',
  hosts: '/hosts',
  settings: '/settings',
}

export const TITLES: Record<Page, string> = {
  notes: '便签',
  mail: '邮件',
  assets: '资产台账',
  monitors: '观测台',
  hosts: '主机',
  settings: '设置',
}

/**
 * 路径 → 页面。根路径 /、未知路径、带不带尾斜杠都归到便签页，
 * 保证任何深链都不会白屏（server 的 SPA fallback 已经把非文件路径都回成 index.html）。
 */
/** 部署在子路径时（base = '/pinfolio/'），先剥掉前缀再匹配。 */
function stripBase(pathname: string, base: string): string {
  const b = base.replace(/\/+$/, '')
  if (!b) return pathname
  if (pathname === b) return '/'
  return pathname.startsWith(b + '/') ? pathname.slice(b.length) : pathname
}

export function pageFromPath(pathname: string, base = ''): Page {
  const p = stripBase(pathname, base).replace(/\/+$/, '').toLowerCase()
  if (p === '/mail' || p === '/assets' || p === '/monitors' || p === '/hosts' || p === '/settings') return p.slice(1) as Page
  return 'notes'
}

export function pathForPage(page: Page, base = ''): string {
  return base.replace(/\/+$/, '') + PATHS[page]
}
