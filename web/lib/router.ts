import { useCallback, useEffect, useState } from 'react'

export type Page = 'notes' | 'assets' | 'monitors' | 'settings'

/** 每个页面在地址栏里的规范路径。改这里等于改 URL 约定。 */
const PATHS: Record<Page, string> = {
  notes: '/notes',
  assets: '/assets',
  monitors: '/monitors',
  settings: '/settings',
}

const TITLES: Record<Page, string> = {
  notes: '便签',
  assets: '资产台账',
  monitors: '观测台',
  settings: '设置',
}

/**
 * 路径 → 页面。根路径 /、未知路径、带不带尾斜杠都归到便签页，
 * 保证任何深链都不会白屏（server 的 SPA fallback 已经把非文件路径都回成 index.html）。
 */
export function pageFromPath(pathname: string): Page {
  const p = pathname.replace(/\/+$/, '').toLowerCase()
  if (p === '/assets' || p === '/monitors' || p === '/settings') return p.slice(1) as Page
  return 'notes'
}

export function pathForPage(page: Page): string {
  return PATHS[page]
}

function applyTitle(page: Page) {
  document.title = TITLES[page] + ' · 便签夹'
}

/** 页面状态由 URL 驱动：刷新、直接开链接、前进后退都跟着走。 */
export function usePage(): [Page, (page: Page, replace?: boolean) => void] {
  const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname))

  // 地址栏归一到规范路径（/ → /notes、未知路径 → /notes），不新增历史记录。
  useEffect(() => {
    const canonical = PATHS[page]
    if (window.location.pathname !== canonical) {
      window.history.replaceState(null, '', canonical)
    }
    applyTitle(page)
  }, [page])

  useEffect(() => {
    const onPop = () => setPage(pageFromPath(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const go = useCallback((next: Page, replace = false) => {
    const path = PATHS[next]
    if (window.location.pathname !== path) {
      if (replace) window.history.replaceState(null, '', path)
      else window.history.pushState(null, '', path)
    }
    setPage(next)
  }, [])

  return [page, go]
}
