import { ExternalLink } from 'lucide-react'
import type { Monitor } from '../../lib/api'
import { cx } from '../../lib/cx'
import { relativeTime } from '../../lib/format'
import { shortGroup, shortName } from '../../lib/monitors'
import { pct, tone, typeLabel } from './status'

/** 表格视图：行 id 同样是 `monitor-<id>`，异常通知跳过来也能定位 */
export function MonitorTable({ shown, onOpen }: { shown: Monitor[]; onOpen: (id: number) => void }) {
  return (
    <div className="table-wrap" style={{ marginTop: 14 }}>
      <table className="data">
        <thead>
          <tr>
            <th>观测项</th><th>机器</th><th>类型</th><th>状态</th><th>响应</th><th>24h</th><th>最近检查</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((m) => {
            const st = tone(m)
            return (
              <tr key={m.id} id={'monitor-' + m.id} className={cx('monitor-row', !m.active && 'paused')} onClick={() => onOpen(m.id)}>
                <td style={{ fontWeight: 550 }}>
                  {m.link ? (
                    <a className="monitor-link" href={m.link.url} target="_blank" rel="noreferrer noopener" title={m.link.label} onClick={(ev) => ev.stopPropagation()}>
                      {shortName(m)}
                      <ExternalLink size={11} className="monitor-link-icon" />
                    </a>
                  ) : (
                    <span title={m.name}>{shortName(m)}</span>
                  )}
                </td>
                <td className="muted" title={m.group}>{shortGroup(m.group)}</td>
                <td className="muted">{typeLabel(m.type)}</td>
                <td>
                  {m.active ? (
                    <span className="status-pill">
                      <span className="status-dot" style={{ background: st ? st.color : 'var(--muted)' }} />
                      {st ? st.label : '无数据'}
                    </span>
                  ) : <span className="monitor-chip">已暂停</span>}
                </td>
                <td className="mono">{m.ping === null ? '—' : m.ping + ' ms'}</td>
                <td className="mono" style={{ color: m.uptime24 !== null && m.uptime24 < 0.99 ? 'var(--warn)' : undefined }}>{pct(m.uptime24)}</td>
                <td className="muted">{m.time ? relativeTime(m.time) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
