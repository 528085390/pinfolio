import { Globe, Plug, Terminal, ExternalLink } from 'lucide-react'
import type { Monitor } from '../../lib/api'
import { cx } from '../../lib/cx'
import { relativeTime, fullTime } from '../../lib/format'
import { BeatStrip } from '../../components/BeatStrip'
import { isDown, shortGroup, shortName } from '../../lib/monitors'
import { pct, tone, typeLabel } from './status'
import { t } from '../../lib/i18n'

function TypeIcon({ type, size = 15 }: { type: string; size?: number }) {
  if (type === 'ssh') return <Terminal size={size} />
  if (type === 'port' || type === 'ping') return <Plug size={size} />
  return <Globe size={size} />
}

/** 卡片视图的一张观测项。id 必须是 `monitor-<id>`——异常通知跳转靠它 scrollIntoView + 加 .flash */
export function MonitorCard({ m, onOpen }: { m: Monitor; onOpen: () => void }) {
  const st = tone(m)
  const note = (m.description || '').trim()
  const nameTitle = note || (m.link ? m.link.label : m.name)
  const nameCls = cx('asset-name', m.link && 'monitor-link', note && 'has-note')
  return (
    <div
      id={'monitor-' + m.id}
      className={cx('asset-card monitor-card', isDown(m) && 'down', !m.active && 'paused')}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onOpen() } }}
      title={t('点开看详情')}
    >
      <div className="asset-card-head">
        <div className="asset-icon"><TypeIcon type={m.type} /></div>
        <div className="grow">
          {m.link ? (
            <a
              className={nameCls}
              href={m.link.url}
              target="_blank"
              rel="noreferrer noopener"
              title={nameTitle}
              onClick={(ev) => ev.stopPropagation()}
            >
              {shortName(m)}
              <ExternalLink size={11} className="monitor-link-icon" />
            </a>
          ) : (
            <div className={nameCls} title={nameTitle}>{shortName(m)}</div>
          )}
          <div className="asset-sub" title={m.group}>
            <span className="monitor-machine">{shortGroup(m.group)}</span>
            <span className="monitor-type">{typeLabel(m.type)}</span>
          </div>
        </div>
        <span className="status-pill">
          <span className="status-dot" style={{ background: st ? st.color : 'var(--muted)' }} />
          {st ? st.label : t('无数据')}
        </span>
      </div>

      <BeatStrip
        cells={m.beats.map((b, i) => ({ status: b, tone: m.beatTones?.[i] ?? null }))}
        type={m.type}
        details={m.beatTimes && m.beatTimes.length > 0
          ? m.beats.map((_, i) => ({ time: m.beatTimes?.[i] ?? null, msg: m.beatMsgs?.[i] ?? '', ping: m.beatPings?.[i] ?? null }))
          : undefined}
        title={t('最近 {n} 次心跳', { n: m.beats.length })}
      />

      {m.showMsg && m.msg ? (
        <div className="monitor-note" title={m.msg}>
          <span className="monitor-note-label">{t('本次观测情况')}</span>
          <span className="monitor-note-text">{m.msg}</span>
        </div>
      ) : null}

      <div className="asset-meta">
        <div className="asset-meta-row">
          <span className="asset-meta-key">{t('响应')}</span>
          <span className="asset-meta-val">{m.ping === null ? '—' : m.ping + ' ms'}</span>
        </div>
        <div className="asset-meta-row">
          <span className="asset-meta-key">{t('检查')}</span>
          <span className="asset-meta-val" title={m.time ? fullTime(m.time) : undefined}>{m.time ? relativeTime(m.time) : '—'}</span>
        </div>
      </div>

      <div className="asset-foot">
        {!m.active ? <span className="monitor-chip">{t('已暂停')}</span> : null}
        <span className="monitor-chip">24h {pct(m.uptime24)}</span>
        {m.downCount > 0 ? <span className="monitor-chip bad">{t('{n} 次异常', { n: m.downCount })}</span> : null}
        {m.msg && !m.showMsg ? <span className="monitor-msg" title={m.msg}>{m.msg}</span> : null}
      </div>
    </div>
  )
}
