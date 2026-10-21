import type { Tag } from '../../lib/api'
import { cx } from '../../lib/cx'

/** 标签栏：只在有资产带标签时出现；e2e（e2e-tagbar.mjs）依赖 .tag-bar 与里面的 .chip */
export function AssetTagBar({ usedTags, tag, onTag }: { usedTags: Tag[]; tag: string; onTag: (v: string) => void }) {
  if (usedTags.length === 0) return null
  return (
    <div className="filters tag-bar">
      <span className="filter-label">标签</span>
      <button className={cx('chip', !tag && 'active')} onClick={() => onTag('')}>全部标签</button>
      {usedTags.map((t) => (
        <button
          key={t.id}
          className={cx('chip', tag === t.name && 'active')}
          onClick={() => onTag(tag === t.name ? '' : t.name)}
          title={t.name + '：' + t.assets + ' 条资产'}
        >
          #{t.name}<span className="chip-count">{t.assets}</span>
        </button>
      ))}
    </div>
  )
}
