import { ExternalLink } from 'lucide-react'
import type { Asset } from '../../lib/api'
import { cx } from '../../lib/cx'
import { KIND_META, STATUS_META, expiry, money } from '../../lib/format'
import { t } from '../../lib/i18n'

/** 表格视图：名称 / 类型 / 状态 / 位置 / 供应商 / 到期 / 价格 */
export function AssetTable({ assets, onOpen }: { assets: Asset[]; onOpen: (id: number) => void }) {
  return (
    <div className="table-wrap" style={{ marginTop: 14 }}>
      <table className="data">
        <thead>
          <tr>
            <th>{t('名称')}</th><th>{t('类型')}</th><th>{t('状态')}</th><th>{t('位置')}</th><th>{t('供应商')}</th><th>{t('到期')}</th><th>{t('价格')}</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => {
            const ex = expiry(a.expiresAt)
            return (
              <tr key={a.id} onClick={() => onOpen(a.id)}>
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
  )
}
