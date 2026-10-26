import type { MonitorDetail } from '../../lib/api'
import { BeatStrip } from '../BeatStrip'
import { relativeTime, fullTime } from '../../lib/format'
import { toneOf, type MonitorFull } from './display'
import { t } from '../../lib/i18n'

/** 抽屉顶部：当前状态、最近一次消息、心跳色条。 */
export function NowSection({ detail, m }: { detail: MonitorDetail; m: MonitorFull }) {
  const latest = detail.latest || null
  const tone = toneOf(latest)
  return (
    <div className="monitor-drawer-now">
      <div className="monitor-drawer-now-head">
        <span className="status-pill">
          <span className="status-dot" style={{ background: tone ? tone.color : 'var(--muted)' }} />
          {tone ? tone.label : t('无数据')}
        </span>
        {!m.active ? <span className="monitor-chip">{t('已暂停')}</span> : null}
        {latest?.ping !== null && latest?.ping !== undefined ? <span className="monitor-chip">{latest.ping} ms</span> : null}
        <span className="grow" />
        <span className="monitor-updated" title={latest?.time ? fullTime(latest.time) : undefined}>
          {latest?.time ? relativeTime(latest.time) : t('还没跑过')}
        </span>
      </div>
      {latest?.msg ? <div className="monitor-drawer-msg">{latest.msg}</div> : null}
      <BeatStrip
        cells={(detail.beats || []).map((b) => ({ status: b.status, tone: b.tone }))}
        type={m.type}
        details={(detail.beats || []).map((b) => ({ time: b.time, msg: b.msg, ping: b.ping }))}
        title={t('最近 {n} 次心跳', { n: detail.beats.length })}
      />
    </div>
  )
}
