import { Pause, Play, Trash2 } from 'lucide-react'
import { cx, type Host, type HostSeriesPoint } from '../../lib/api'
import { t } from '../../lib/i18n'

// 一张卡 = 一台机。数据缺字段时全部走兜底文案，不要因为一台机少个字段就整页白屏。

function pct(v: number | undefined): string {
  return v === undefined || Number.isNaN(v) ? '—' : v.toFixed(1) + '%'
}

function gb(kb: number | undefined): string {
  if (!kb || kb <= 0) return '—'
  return (kb / 1048576).toFixed(1) + ' GB'
}

function bytes(n: number | undefined): string {
  if (!n || n <= 0) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return (i === 0 ? v.toFixed(0) : v.toFixed(1)) + ' ' + u[i]
}

function uptime(sec: number | undefined): string {
  if (!sec || sec <= 0) return '—'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  if (d > 0) return t('{d} 天 {h} 小时', { d, h })
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? t('{h} 小时 {m} 分', { h, m }) : t('{m} 分钟', { m })
}

export function ago(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return t('无数据')
  if (sec < 90) return t('刚刚')
  if (sec < 3600) return t('{n} 分钟前', { n: Math.round(sec / 60) })
  if (sec < 86400) return t('{n} 小时前', { n: Math.round(sec / 3600) })
  return t('{n} 天前', { n: Math.round(sec / 86400) })
}

function tone(v: number | undefined): 'ok' | 'warn' | 'bad' {
  if (v === undefined) return 'ok'
  return v >= 85 ? 'bad' : v >= 70 ? 'warn' : 'ok'
}

/** 24 小时 CPU / 内存折线，两条线共用 0–100% 的纵轴。 */
function Spark({ series }: { series: HostSeriesPoint[] }) {
  if (!series || series.length < 2) return <div className="host-spark is-empty">{t('还没有曲线')}</div>
  const w = 100
  const h = 26
  const n = series.length
  const line = (pick: (p: HostSeriesPoint) => number) =>
    series
      .map((p, i) => ((i / (n - 1)) * w).toFixed(2) + ',' + (h - (Math.min(100, Math.max(0, pick(p))) / 100) * h).toFixed(2))
      .join(' ')
  return (
    <svg className="host-spark" viewBox={'0 0 ' + w + ' ' + h} preserveAspectRatio="none" aria-hidden="true">
      <polyline className="sp-mem" points={line((p) => p[2])} fill="none" vectorEffect="non-scaling-stroke" />
      <polyline className="sp-cpu" points={line((p) => p[1])} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function Bar({ label, pct: v, text }: { label: string; pct: number; text: string }) {
  return (
    <div className="host-bar" title={label + ' · ' + text}>
      <div className="host-bar-head">
        <span className="host-bar-path">{label}</span>
        <span className="host-bar-text">{text}</span>
      </div>
      <div className="host-bar-track">
        <i className={'host-bar-fill tone-' + tone(v)} style={{ width: Math.min(100, Math.max(1, v)) + '%' }} />
      </div>
    </div>
  )
}

export function HostCard({ h, busy, onTogglePause, onDelete, onOnboard }: {
  h: Host
  /** 有写操作在跑时禁用暂停 / 删除，避免连点 */
  busy?: boolean
  onTogglePause?: (h: Host) => void
  onDelete?: (h: Host) => void
  /** 还没收到上报时给一条「接入指引」（安装命令），有数据就不显示 */
  onOnboard?: (h: Host) => void
}) {
  const memTotal = h.mem?.total_kb ?? 0
  const memUsed = memTotal - (h.mem?.avail_kb ?? 0)

  return (
    <div className={cx('host-card', h.paused ? 'is-paused' : !h.online && 'is-off')}>
      <div className="host-head">
        <span className={cx('host-dot', h.paused ? 'is-paused' : h.online ? 'is-on' : 'is-off')} />
        <span className="host-name">{h.label}</span>
        <span className="host-note">{h.note}</span>
        {h.paused ? <span className="host-pause-tag">{t('已暂停')}</span> : null}
        <span className="host-ago">{h.paused ? t('暂停采集') : ago(h.staleSec)}</span>
        <div className="host-ops">
          <button
            className="host-op"
            title={h.paused ? t('恢复采集') : t('暂停采集（保留卡片与历史，只是不再拉取）')}
            disabled={busy}
            onClick={() => onTogglePause?.(h)}
          >
            {h.paused ? <Play size={13} /> : <Pause size={13} />}
          </button>
          <button
            className="host-op is-danger"
            title={t('删除这台主机（{id}）', { id: h.id })}
            disabled={busy}
            onClick={() => onDelete?.(h)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {h.ts === undefined ? (
        <div className="host-nodata">
          {h.paused ? t('已暂停采集，恢复后会补到最新一帧') : t('还没收到这台机的上报')}
          {!h.paused && onOnboard ? (
            <button className="host-nodata-btn" onClick={() => onOnboard(h)}>{t('接入指引')}</button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="host-figs">
            <div className="host-fig">
              <span>CPU</span>
              <b className={'tone-' + tone(h.cpu_pct)}>{pct(h.cpu_pct)}</b>
              <i>{t('{n} 核', { n: h.cores ?? '—' })}</i>
            </div>
            <div className="host-fig">
              <span>{t('内存')}</span>
              <b className={'tone-' + tone(h.mem?.used_pct)}>{pct(h.mem?.used_pct)}</b>
              <i>{gb(memUsed)} / {gb(memTotal)}</i>
            </div>
            <div className="host-fig">
              <span>{t('负载 1m')}</span>
              <b>{h.load?.[0]?.toFixed(2) ?? '—'}</b>
              <i>5m {h.load?.[1]?.toFixed(2) ?? '—'}</i>
            </div>
            <div className="host-fig">
              <span>{t('已运行')}</span>
              <b className="host-fig-sm">{uptime(h.uptime_s)}</b>
              <i>{h.host || h.id}</i>
            </div>
          </div>

          <Spark series={h.series} />

          <div className="host-bars">
            {(h.disk || []).map((d) => (
              <Bar key={d.path} label={d.path} pct={d.pct} text={bytes(d.used) + ' / ' + bytes(d.total)} />
            ))}
          </div>

          <div className="host-foot">
            <span className="host-foot-os">{h.os || ''}</span>
            <span className="host-foot-top">
              {(h.top || []).map((tg) => tg.comm + ' ' + Math.round(tg.rss_kb / 1024) + 'M').join(' · ')}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
