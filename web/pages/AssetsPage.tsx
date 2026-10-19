import { useCallback, useEffect, useState } from 'react'
import { Plus, Search, LayoutGrid, List, Package, AlertCircle, ExternalLink } from 'lucide-react'
import { api, cx, type Asset, type FieldDef, type Tag, type Stats } from '../lib/api'
import { KIND_META, KINDS, STATUS_META, expiry, money, daysBetween } from '../lib/format'
import { Button, Empty, TagChip, Spinner } from '../components/ui'
import { KindIcon } from '../components/KindIcon'
import { AssetDrawer } from '../components/AssetDrawer'

const STATUSES = ['active', 'idle', 'retired', 'lost']

export function AssetsPage({ tags, fields, stats, refreshMeta, openAssetId, setOpenAssetId }: {
  tags: Tag[]
  fields: FieldDef[]
  stats: Stats | null
  refreshMeta: () => void
  openAssetId: number | 'new' | null
  setOpenAssetId: (v: number | 'new' | null) => void
}) {
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [kind, setKind] = useState('')
  const [status, setStatus] = useState('')
  const [tag, setTag] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [q, setQ] = useState('')
  const [view, setView] = useState<'grid' | 'table'>('grid')

  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 220)
    return () => clearTimeout(t)
  }, [searchInput])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.assets.list({ q, kind, status, tag })
      setAssets(data)
      setError('')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [q, kind, status, tag])

  useEffect(() => { load() }, [load])

  // 标签栏：只列有资产关联的标签，按关联数降序（同数量按名称升序），标签后带数量
  const usedTags = tags
    .filter((t) => (t.assets || 0) > 0)
    .slice()
    .sort((a, b) => (b.assets || 0) - (a.assets || 0) || a.name.localeCompare(b.name, 'zh-CN'))

  function onSaved() {
    load()
    refreshMeta()
  }

  return (
    <div className="page page-wide">
      {stats ? (
        <div className="stat-strip">
          <div className="stat">
            <div className="stat-label">资产总数</div>
            <div className="stat-value">{stats.assets}<small>件</small></div>
          </div>
          <div className="stat">
            <div className="stat-label">在用</div>
            <div className="stat-value">{stats.active}<small>件</small></div>
          </div>
          <div className="stat">
            <div className="stat-label">30 天内到期</div>
            <div className="stat-value" style={{ color: stats.expiringSoon ? 'var(--warn)' : undefined }}>{stats.expiringSoon}<small>项</small></div>
          </div>
          <div className="stat">
            <div className="stat-label">已过期</div>
            <div className="stat-value" style={{ color: stats.expired ? 'var(--danger)' : undefined }}>{stats.expired}<small>项</small></div>
          </div>
        </div>
      ) : null}

      <div className="filters" style={{ marginTop: 18 }}>
        <button className={cx('chip', !kind && 'active')} onClick={() => setKind('')}>全部</button>
        {KINDS.map((k) => (
          <button key={k} className={cx('chip', kind === k && 'active')} onClick={() => setKind(kind === k ? '' : k)}>
            {KIND_META[k].label}
          </button>
        ))}
        <div style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 2px' }} />
        <select className="select input-sm" style={{ width: 110 }} value={status} onChange={(e) => setStatus(e.target.value)}>
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
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <div className="row" style={{ gap: 2 }}>
          <Button variant={view === 'grid' ? 'default' : 'ghost'} size="sm" icon onClick={() => setView('grid')} title="卡片视图">
            <LayoutGrid size={14} />
          </Button>
          <Button variant={view === 'table' ? 'default' : 'ghost'} size="sm" icon onClick={() => setView('table')} title="表格视图">
            <List size={14} />
          </Button>
        </div>
        <Button variant="primary" size="sm" onClick={() => setOpenAssetId('new')}>
          <Plus size={14} /> 登记资产
        </Button>
      </div>

      {usedTags.length > 0 ? (
        <div className="filters tag-bar">
          <span className="filter-label">标签</span>
          <button className={cx('chip', !tag && 'active')} onClick={() => setTag('')}>全部标签</button>
          {usedTags.map((t) => (
            <button
              key={t.id}
              className={cx('chip', tag === t.name && 'active')}
              onClick={() => setTag(tag === t.name ? '' : t.name)}
              title={t.name + '：' + t.assets + ' 条资产'}
            >
              #{t.name}<span className="chip-count">{t.assets}</span>
            </button>
          ))}
        </div>
      ) : null}

      {error ? <div className="alert" style={{ marginTop: 14 }}>{error}</div> : null}

      {loading && assets.length === 0 ? (
        <div className="empty"><Spinner /></div>
      ) : assets.length === 0 ? (
        <Empty
          icon={<Package size={22} />}
          title={q || kind || status || tag ? '没有匹配的资产' : '还没有登记资产'}
          text={q || kind || status || tag ? '换个筛选条件试试。' : '设备、服务器、域名、订阅账号——都记在这里。字段可以自己加。'}
          action={<Button variant="primary" size="sm" onClick={() => setOpenAssetId('new')}><Plus size={14} /> 登记第一件</Button>}
        />
      ) : view === 'grid' ? (
        <div className="asset-grid" style={{ marginTop: 14 }}>
          {assets.map((a) => <AssetCard key={a.id} asset={a} fields={fields} onClick={() => setOpenAssetId(a.id)} />)}
        </div>
      ) : (
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table className="data">
            <thead>
              <tr>
                <th>名称</th><th>类型</th><th>状态</th><th>位置</th><th>供应商</th><th>到期</th><th>价格</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => {
                const ex = expiry(a.expiresAt)
                return (
                  <tr key={a.id} onClick={() => setOpenAssetId(a.id)}>
                    <td style={{ fontWeight: 550 }}>
                      {a.name}
                      {a.url ? (
                        <a className="asset-link-inline" href={a.url} target="_blank" rel="noreferrer" title={a.url}
                          onClick={(e) => e.stopPropagation()}>
                          <ExternalLink size={11} />
                        </a>
                      ) : null}
                    </td>
                    <td className="muted">{KIND_META[a.kind]?.label || a.kind}</td>
                    <td>
                      <span className="status-pill">
                        <span className="status-dot" style={{ background: STATUS_META[a.status]?.color }} />
                        {STATUS_META[a.status]?.label || a.status}
                      </span>
                    </td>
                    <td className="muted">{a.location || '—'}</td>
                    <td className="muted">{a.vendor || '—'}</td>
                    <td className={cx(ex && ex.tone === 'bad' && 'text-danger')} style={ex ? { color: ex.tone === 'bad' ? 'var(--danger)' : ex.tone === 'warn' ? 'var(--warn)' : undefined } : undefined}>
                      {a.expiresAt || '—'}
                    </td>
                    <td className="mono">{a.price !== null ? money(a.price, a.currency) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <AssetDrawer
        open={openAssetId !== null}
        assetId={openAssetId}
        fields={fields}
        tags={tags}
        onClose={() => setOpenAssetId(null)}
        onSaved={onSaved}
      />
    </div>
  )
}

function AssetCard({ asset, fields, onClick }: { asset: Asset; fields: FieldDef[]; onClick: () => void }) {
  const ex = expiry(asset.expiresAt)
  const meta: { k: string; v: string }[] = []
  if (asset.serial) meta.push({ k: '序列号', v: asset.serial })
  if (asset.location) meta.push({ k: '位置', v: asset.location })
  const customKeys = Object.keys(asset.custom || {}).filter((k) => asset.custom[k] !== '' && asset.custom[k] !== null)
  for (const k of customKeys.slice(0, 2)) {
    const label = fields.find((f) => f.key === k)?.label || k
    meta.push({ k: label, v: String(asset.custom[k]) })
  }
  if (asset.vendor) meta.push({ k: '供应商', v: asset.vendor })

  return (
    <div className="asset-card" onClick={onClick}>
      <div className="asset-card-head">
        <div className="asset-icon"><KindIcon kind={asset.kind} /></div>
        <div className="grow">
          <div className="asset-name">{asset.name}</div>
          <div className="asset-sub">
            {KIND_META[asset.kind]?.label || asset.kind}
            {asset.price !== null ? ' · ' + money(asset.price, asset.currency) : ''}
            {asset.noteCount > 0 ? ' · ' + asset.noteCount + ' 条便签' : ''}
          </div>
        </div>
        <span className="status-pill" title={STATUS_META[asset.status]?.label}>
          <span className="status-dot" style={{ background: STATUS_META[asset.status]?.color }} />
          {STATUS_META[asset.status]?.label}
        </span>
      </div>

      {meta.length > 0 ? (
        <div className="asset-meta">
          {meta.slice(0, 3).map((m) => (
            <div className="asset-meta-row" key={m.k}>
              <span className="asset-meta-key">{m.k}</span>
              <span className="asset-meta-val">{m.v}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="asset-foot">
        {ex ? (
          <span style={{ fontSize: 11.5, color: ex.tone === 'bad' ? 'var(--danger)' : ex.tone === 'warn' ? 'var(--warn)' : 'var(--muted)' }}>
            <AlertCircle size={11} style={{ verticalAlign: -1, marginRight: 3 }} />
            {ex.text}
          </span>
        ) : null}
        {asset.tags.map((t) => <TagChip key={t.id} name={'#' + t.name} color={t.color} />)}
        {asset.url ? (
          <a className="asset-link" href={asset.url} target="_blank" rel="noreferrer" title={asset.url}
            onClick={(e) => e.stopPropagation()}>
            打开 <ExternalLink size={11} />
          </a>
        ) : null}
      </div>
    </div>
  )
}
