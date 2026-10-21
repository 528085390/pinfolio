import { Plus, Search, LayoutGrid, List } from 'lucide-react'
import { cx } from '../../lib/cx'
import { KIND_META, KINDS, STATUS_META } from '../../lib/format'
import { Button } from '../../components/ui'

const STATUSES = ['active', 'idle', 'retired', 'lost']

export type AssetFiltersProps = {
  kind: string
  onKind: (v: string) => void
  status: string
  onStatus: (v: string) => void
  searchInput: string
  onSearchInput: (v: string) => void
  view: 'grid' | 'table'
  onView: (v: 'grid' | 'table') => void
  onNew: () => void
}

/** 类型 chips + 状态下拉 + 搜索 + 视图切换 + 登记按钮 */
export function AssetFilters({ kind, onKind, status, onStatus, searchInput, onSearchInput, view, onView, onNew }: AssetFiltersProps) {
  return (
    <div className="filters" style={{ marginTop: 18 }}>
      <button className={cx('chip', !kind && 'active')} onClick={() => onKind('')}>全部</button>
      {KINDS.map((k) => (
        <button key={k} className={cx('chip', kind === k && 'active')} onClick={() => onKind(kind === k ? '' : k)}>
          {KIND_META[k].label}
        </button>
      ))}
      <div style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 2px' }} />
      <select className="select input-sm" style={{ width: 110 }} value={status} onChange={(e) => onStatus(e.target.value)}>
        <option value="">所有状态</option>
        {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
      </select>
      <div className="grow" />
      <div style={{ position: 'relative', width: 190 }}>
        <Search size={13} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--muted)' }} />
        <input
          className="input input-sm"
          style={{ paddingLeft: 27 }}
          placeholder="搜索名称/序列号/备注"
          value={searchInput}
          onChange={(e) => onSearchInput(e.target.value)}
        />
      </div>
      <div className="row" style={{ gap: 2 }}>
        <Button variant={view === 'grid' ? 'default' : 'ghost'} size="sm" icon onClick={() => onView('grid')} title="卡片视图">
          <LayoutGrid size={14} />
        </Button>
        <Button variant={view === 'table' ? 'default' : 'ghost'} size="sm" icon onClick={() => onView('table')} title="表格视图">
          <List size={14} />
        </Button>
      </div>
      <Button variant="primary" size="sm" onClick={onNew}>
        <Plus size={14} /> 登记资产
      </Button>
    </div>
  )
}
