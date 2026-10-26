import type { MonitorSummary } from '../../lib/api'
import { pct } from './status'
import { t } from '../../lib/i18n'

/** 顶部四个数字：观测项 / 正常 / 异常 / 24h 可用率 */
export function MonitorStats({ summary: s }: { summary?: MonitorSummary }) {
  return (
    <div className="stat-strip">
      <div className="stat">
        <div className="stat-label">{t('观测项')}</div>
        <div className="stat-value">{s ? t('{n}个', { n: s.total }) : '—'}</div>
      </div>
      <div className="stat">
        <div className="stat-label">{t('正常')}</div>
        <div className="stat-value" style={{ color: s && s.down === 0 ? 'var(--ok)' : undefined }}>{s ? t('{n}个', { n: s.up }) : '—'}</div>
      </div>
      <div className="stat">
        <div className="stat-label">{t('异常')}</div>
        <div className="stat-value" style={{ color: s && s.down ? 'var(--danger)' : undefined }}>{s ? t('{n}个', { n: s.down }) : '—'}</div>
      </div>
      <div className="stat">
        <div className="stat-label">{t('24h 可用率')}</div>
        <div className="stat-value">{s ? pct(s.uptime24) : '—'}</div>
      </div>
    </div>
  )
}
