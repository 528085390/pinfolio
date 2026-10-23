import { useCallback, useEffect, useState } from 'react'
import { PATHS, TITLES, pageFromPath, pathForPage, type Page } from './paths'

// 页面 ↔ URL 的映射在 paths.ts（纯函数，可单测）；这里只管 React 状态与地址栏同步。
export type { Page }
export { pageFromPath, pathForPage } from './paths'

/** 子路径部署时的前缀（Vite 的 BASE_URL，形如 '/pinfolio/' 或 '/'）。 */
const BASE = import.meta.env.BASE_URL || '/'

function applyTitle(page: Page) {
  document.title = TITLES[page] + ' · pinfolio'
}

/** 页面状态由 URL 驱动：刷新、直接开链接、前进后退都跟着走。 */
export function usePage(): [Page, (page: Page, replace?: boolean) => void] {
  const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname, BASE))

  // 地址栏归一到规范路径（/ → /notes、未知路径 → /notes），不新增历史记录。
  useEffect(() => {
    const canonical = pathForPage(page, BASE)
    if (window.location.pathname !== canonical) {
      window.history.replaceState(null, '', canonical)
    }
    applyTitle(page)
  }, [page])

  useEffect(() => {
    const onPop = () => setPage(pageFromPath(window.location.pathname, BASE))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const go = useCallback((next: Page, replace = false) => {
    const path = pathForPage(next, BASE)
    if (window.location.pathname !== path) {
      if (replace) window.history.replaceState(null, '', path)
      else window.history.pushState(null, '', path)
    }
    setPage(next)
  }, [])

  return [page, go]
}
