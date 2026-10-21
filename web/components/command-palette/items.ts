// 命令面板里可以单测的那几件（2026-10-21 从 CommandPalette.tsx 抽出来）。
// 组件的 JSX 与 effect 留在 CommandPalette.tsx；这里只管「一条便签/资产怎么变成一行结果」与键盘上下移动的下标。
import type { Asset } from '../../lib/api'
import { KIND_META } from '../../lib/format'

/** 便签结果行最多显示多少个字（把连续空白压成一个空格之后）。 */
export const NOTE_LABEL_MAX = 70

/** 便签结果行的标题：压成一行再截断。 */
export function noteLabel(content: string): string {
  return content.replace(/\s+/g, ' ').slice(0, NOTE_LABEL_MAX)
}

/** 便签结果行的副标题：有标签就列 `#标签`，没有就写「便签」。 */
export function noteSub(tags: { name: string }[]): string {
  return tags.length ? tags.map((t) => '#' + t.name).join(' ') : '便签'
}

/** 资产结果行的副标题：类型中文名 + 位置（没位置就只有类型名）。 */
export function assetSub(a: Pick<Asset, 'kind' | 'location'>): string {
  return KIND_META[a.kind]?.label + (a.location ? ' · ' + a.location : '')
}

/**
 * 键盘上下移动选中项。**长度为 0 时按 ↓ 会变成 -1**（原实现就是 `Math.min(-1, s + 1)`，
 * 此时列表里没有可点的项，下一轮 `items.length` 变化会把 sel 重置回 0）——实测行为，别改成 0。
 */
export function moveSel(sel: number, delta: number, length: number): number {
  if (delta > 0) return Math.min(length - 1, sel + delta)
  if (delta < 0) return Math.max(0, sel + delta)
  return sel
}

/** 列表顶部的分组标题与空态文案：`group` 为空表示不显示标题，`empty` 为空表示不显示空态。 */
export function paletteHint(term: string, loading: boolean, count: number): { group: string; empty: string } {
  const t = term.trim()
  const group = count > 0 ? (t ? '结果' : '命令') : ''
  const empty = !loading && t && count === 0 ? `没有找到「${t}」` : ''
  return { group, empty }
}
