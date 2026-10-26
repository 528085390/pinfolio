import { Search, RefreshCw, LayoutGrid, List } from 'lucide-react'
import type { MonitorGroup } from '../../lib/api'
import { cx } from '../../lib/cx'
import { relativeTime } from '../../lib/format'
import { shortGroup } from '../../lib/monitors'
import { Button } from '../../components/ui'
import { t } from '../../lib/i18n'

export type MonitorFiltersProps = {
  groups: MonitorGroup[]
  group: number | ''
  onGroup: (v: number | '') => void
  allCount: number
  status: string
  onStatus: (v: string) => void
  searchInput: string
  onSearchInput: (v: string) => void
  auto: boolean
  onToggleAuto: () => void
  view: 'grid' | 'table'
  onView: (v: 'grid' | 'table') => void
  loading: boolean
  onRefresh: () => void
  updatedAt?: string
}

/** 分组 chips + 状态下拉 + 搜索 + 自动刷新 + 视图切换 + 手动刷新 */
export function MonitorFilters({
  groups, group, onGroup, allCount, status, onStatus, searchInput, onSearchInput,
  auto, onToggleAuto, view, onView, loading, onRefresh, updatedAt,
}: MonitorFiltersProps) {
  return (
    <div className="filters" style={{ marginTop: 18 }}>
      <button className={cx('chip', group === '' && 'active')} onClick={() => onGroup('')}>
        {t('全部')}<span className="chip-count">{allCount}</span>
      </button>
      {groups.map((g) => (
        <button
          key={g.id}
          className={cx('chip', group === g.id && 'active')}
          onClick={() => onGroup(group === g.id ? '' : g.id)}
          title={g.name}
        >
          {shortGroup(g.name)}
          <span className="chip-count">{g.monitors.length}</span>
        </button>
      ))}
      <div style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 2px' }} />
      <select className="select input-sm" style={{ width: 104 }} value={status} onChange={(e) => onStatus(e.target.value)}>
        <option value="">{t('所有状态')}</option>
        <option value="up">{t('正常')}</option>
        <option value="down">{t('故障')}</option>
        <option value="pending">{t('待定')}</option>
      </select>
      <div className="grow" />
      <div style={{ position: 'relative', width: 180 }}>
        <Search size={13} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--muted)' }} />
        <input
          className="input input-sm"
          style={{ paddingLeft: 27 }}
          placeholder={t('搜索观测项')}
          value={searchInput}
          onChange={(e) => onSearchInput(e.target.value)}
        />
      </div>
      <button className={cx('chip', auto && 'active')} onClick={onToggleAuto} title={t('每 30 秒自动刷新')}>
        {t('自动刷新')}
      </button>
      <div className="row" style={{ gap: 2 }}>
        <Button variant={view === 'grid' ? 'default' : 'ghost'} size="sm" icon onClick={() => onView('grid')} title={t('卡片视图')}>
          <LayoutGrid size={14} />
        </Button>
        <Button variant={view === 'table' ? 'default' : 'ghost'} size="sm" icon onClick={() => onView('table')} title={t('表格视图')}>
          <List size={14} />
        </Button>
      </div>
      <Button variant="ghost" size="sm" icon onClick={onRefresh} title={t('立即刷新')}>
        <RefreshCw size={14} className={loading ? 'spin' : undefined} />
      </Button>
      {updatedAt ? <span className="monitor-updated">{relativeTime(updatedAt)}</span> : null}
    </div>
  )
}
