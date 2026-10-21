import { AlertCircle, ExternalLink } from 'lucide-react'
import type { Asset, FieldDef } from '../../lib/api'
import { KIND_META, STATUS_META, expiry, money } from '../../lib/format'
import { TagChip } from '../../components/ui'
import { KindIcon } from '../../components/KindIcon'
import { cardMeta } from './meta'

/** 卡片视图的一件资产。e2e 依赖 .asset-card / .asset-name / .asset-icon */
export function AssetCard({ asset, fields, onClick }: { asset: Asset; fields: FieldDef[]; onClick: () => void }) {
  const ex = expiry(asset.expiresAt)
  const meta = cardMeta(asset, fields)

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
