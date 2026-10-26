import { useEffect, type RefObject } from 'react'
import { rowSpan } from '../../lib/masonry'

/**
 * 把便签列表排成瀑布流：给容器加 `masonry` 类（打开 `grid-auto-rows: 8px`），
 * 再给每张卡片写 `grid-row-end: span N`。
 *
 * 只在便签页用；资产抽屉里的「关联便签」是窄容器，保持原来的单列 flex。
 * `deps` 变了（换筛选、加删便签、置顶变化）就重新量一遍；单张卡片变高变矮
 * （展开编辑框、图片加载完）由 ResizeObserver 兜住。容器或卡片被卸载时把行跨度清掉。
 */
export function useMasonry(ref: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useEffect(() => {
    const box = ref.current
    if (!box) return
    const cards = () => Array.from(box.children) as HTMLElement[]
    const measure = () => {
      for (const el of cards()) {
        el.style.gridRowEnd = 'span ' + rowSpan(el.getBoundingClientRect().height)
      }
    }
    const observer = new ResizeObserver(measure)
    const observe = () => {
      observer.disconnect()
      for (const el of cards()) observer.observe(el)
      measure()
    }
    box.classList.add('masonry')
    observe()
    // 窗口变宽变窄会换列数，每张卡片的高度都跟着变，所以整个重量一遍。
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('resize', measure)
      observer.disconnect()
      box.classList.remove('masonry')
      for (const el of cards()) el.style.gridRowEnd = ''
    }
  }, deps)
}
