import type { MonitorSummary } from '../../lib/api'
import { pct } from './status'

/** 顶部四个数字：观测项 / 正常 / 异常 / 24h 可用率 */
export function MonitorStats({ summary: s }: { summary?: MonitorSummary }) {
  return (
    <div className="stat-strip">
      <div className="stat">
        <div className="stat-label">观测项</div>
        <div className="stat-value">{s ? s.total : '—'}<small>个</small></div>
      </div>
      <div className="stat">
        <div className="stat-label">正常</div>
        <div className="stat-value" style={{ color: s && s.down === 0 ? 'var(--ok)' : undefined }}>{s ? s.up : '—'}<small>个</small></div>
      </div>
      <div className="stat">
        <div className="stat-label">异常</div>
        <div className="stat-value" style={{ color: s && s.down ? 'var(--danger)' : undefined }}>{s ? s.down : '—'}<small>个</small></div>
      </div>
      <div className="stat">
        <div className="stat-label">24h 可用率</div>
        <div className="stat-value">{s ? pct(s.uptime24) : '—'}</div>
      </div>
    </div>
  )
}
