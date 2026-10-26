/**
 * 便签瀑布流的几何计算（纯函数，有单测 tests/unit/masonry.test.mts）。
 *
 * 做法：把列表变成 CSS Grid，每行只有 8px 高，每张卡片按自己的实际高度「跨 N 行」，
 * 于是长短卡片各占各的高度，长便签只往下长自己那一列，不会把同一行的邻居撑高（坑 65）。
 * 顺序仍是「行优先」（左→右、上→下），与按时间排列的语义一致；纯 CSS 的 `columns`
 * 是列优先（先填满一列再填下一列），会打乱时间顺序，所以不用它。
 */

/** 网格的一行有多高（px），与 web/styles/notes.css 里 `.note-grid.masonry` 的 grid-auto-rows 一致。 */
export const MASONRY_ROW = 8

/** 卡片之间的间距（px），行距列距相同，与 notes.css 里的 gap 一致。 */
export const MASONRY_GAP = 12

/**
 * 一张高 `height` 的卡片要跨几行。
 *
 * N 行实际占的高度是 `N * row + (N - 1) * gap`，要求它 ≥ height：
 * `N = ceil((height + gap) / (row + gap))`。高度算不出来（0 / NaN / 负）时按 1 行处理。
 */
export function rowSpan(height: number, row: number = MASONRY_ROW, gap: number = MASONRY_GAP): number {
  if (!Number.isFinite(height) || height <= 0) return 1
  if (!Number.isFinite(row) || !Number.isFinite(gap) || row <= 0 || gap < 0) return 1
  return Math.max(1, Math.ceil((height + gap) / (row + gap)))
}
