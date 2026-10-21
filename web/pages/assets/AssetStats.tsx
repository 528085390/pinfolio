import type { Stats } from '../../lib/api'

/** 顶部四格：资产总数 / 在用 / 30 天内到期 / 已过期 */
export function AssetStats({ stats }: { stats: Stats | null }) {
  if (!stats) return null
  return (
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
  )
}
