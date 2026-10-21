import { AlertTriangle, X } from 'lucide-react'
import type { MonitorAlert } from '../lib/monitors'

/** 最多同时显示几条，多出来的折叠成「还有 N 条」 */
const MAX_VISIBLE = 4

/**
 * 右上角的观测异常通知。固定定位、不自动消失：
 * 观测恢复正常时由 useMonitorAlerts 自动摘掉，也可以点 × 手动关。
 * 点通知主体 = 跳到观测台并高亮对应卡片。
 */
export function AlertStack({
  alerts,
  onDismiss,
  onOpen,
}: {
  alerts: MonitorAlert[]
  onDismiss: (id: number) => void
  onOpen: (id: number | null) => void
}) {
  if (alerts.length === 0) return null
  const shown = alerts.slice(-MAX_VISIBLE).reverse() // 最新的一条在最上面
  const rest = alerts.length - shown.length

  return (
    <div className="alert-stack" role="region" aria-label="观测异常通知">
      {shown.map((a) => (
        <div
          key={a.id}
          className="alert-item"
          data-monitor-id={a.id}
          role="button"
          tabIndex={0}
          title="点击跳到观测台对应卡片"
          onClick={() => onOpen(a.id)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault()
              onOpen(a.id)
            }
          }}
        >
          <div className="alert-item-head">
            <span className="alert-item-icon"><AlertTriangle size={14} /></span>
            <span className="alert-item-name">{a.name}</span>
            <button
              className="alert-item-close"
              title="关闭通知"
              aria-label="关闭通知"
              onClick={(ev) => {
                ev.stopPropagation()
                onDismiss(a.id)
              }}
            >
              <X size={13} />
            </button>
          </div>
          <div className="alert-item-sub" title={a.msg}>
            {a.group}{a.msg ? ' · ' + a.msg : ''}
          </div>
        </div>
      ))}
      {rest > 0 ? (
        <button className="alert-more" onClick={() => onOpen(null)} title="打开观测台看全部">
          还有 {rest} 条异常 · 查看全部
        </button>
      ) : null}
    </div>
  )
}
