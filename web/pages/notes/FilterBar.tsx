import { Pin, Plus, Search, Archive, CheckCircle2 } from 'lucide-react'
import { cx, type Tag } from '../../lib/api'
import type { DoneFilter } from './useNotes'
import { t } from '../../lib/i18n'

export type FilterBarProps = {
  archivedMode: boolean
  archivedCount: number
  pinnedOnly: boolean
  tag: string | null
  doneFilter: DoneFilter
  usedTags: Tag[]
  searchInput: string
  onShowAll: () => void
  onToggleDoneFilter: (v: Exclude<DoneFilter, ''>) => void
  onTogglePinned: () => void
  onToggleArchived: () => void
  onToggleTag: (name: string) => void
  onNewTag: () => void
  onSearchInput: (v: string) => void
}

/** 筛选行：全部/未完成/已完成/置顶 + 已归档 + 标签 chips + 搜索框。 */
export function FilterBar(p: FilterBarProps) {
  return (
    <div className="filters" style={{ marginTop: 18 }}>
      {p.archivedMode ? null : (
        <>
          <button className={cx('chip', !p.pinnedOnly && !p.tag && !p.doneFilter && 'active')} onClick={p.onShowAll}>{t('全部')}</button>
          <button className={cx('chip', p.doneFilter === '0' && 'active')} onClick={() => p.onToggleDoneFilter('0')}>{t('未完成')}</button>
          <button className={cx('chip', p.doneFilter === '1' && 'active')} onClick={() => p.onToggleDoneFilter('1')}>
            <CheckCircle2 size={12} /> {t('已完成')}
          </button>
          <button className={cx('chip', p.pinnedOnly && 'active')} onClick={p.onTogglePinned}>
            <Pin size={12} /> {t('置顶')}
          </button>
        </>
      )}
      <button
        className={cx('chip', p.archivedMode && 'active')}
        onClick={p.onToggleArchived}
        title={t('归档的便签默认不显示；在这里查看、恢复或永久删除')}
      >
        <Archive size={12} /> {t('已归档')}{p.archivedCount > 0 ? <span className="chip-count">{p.archivedCount}</span> : null}
      </button>
      {p.archivedMode ? null : (
        <>
          <div style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 2px' }} />
          {p.usedTags.map((tg) => (
            <button
              key={tg.id}
              className={cx('chip', p.tag === tg.name && 'active')}
              onClick={() => p.onToggleTag(tg.name)}
            >
              #{tg.name} <span className="chip-count">{tg.notes}</span>
            </button>
          ))}
          <button className="chip chip-add" onClick={p.onNewTag} title={t('新建一个标签')}>
            <Plus size={12} /> {t('新标签')}
          </button>
        </>
      )}
      <div className="grow" />
      <div style={{ position: 'relative', width: 190 }}>
        <Search size={13} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--muted)' }} />
        <input
          className="input input-sm"
          style={{ paddingLeft: 27 }}
          placeholder={t('搜索便签')}
          value={p.searchInput}
          onChange={(e) => p.onSearchInput(e.target.value)}
        />
      </div>
    </div>
  )
}
