import type { Tag } from '../../lib/api'
import { cx } from '../../lib/cx'
import { t } from '../../lib/i18n'

/** 标签栏：只在有资产带标签时出现；e2e（e2e-tagbar.mjs）依赖 .tag-bar 与里面的 .chip */
export function AssetTagBar({ usedTags, tag, onTag }: { usedTags: Tag[]; tag: string; onTag: (v: string) => void }) {
  if (usedTags.length === 0) return null
  return (
    <div className="filters tag-bar">
      <span className="filter-label">{t('标签')}</span>
      <button className={cx('chip', !tag && 'active')} onClick={() => onTag('')}>{t('全部标签')}</button>
      {usedTags.map((tg) => (
        <button
          key={tg.id}
          className={cx('chip', tag === tg.name && 'active')}
          onClick={() => onTag(tag === tg.name ? '' : tg.name)}
          title={t('{name}：{n} 条资产', { name: tg.name, n: tg.assets ?? 0 })}
        >
          #{tg.name}<span className="chip-count">{tg.assets}</span>
        </button>
      ))}
    </div>
  )
}
