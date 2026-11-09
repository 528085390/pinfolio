import { Pause, Play, Trash2 } from 'lucide-react'
import { cx, type Host, type HostSeriesPoint } from '../../lib/api'
import { t } from '../../lib/i18n'
import { BeatStrip } from '../../components/BeatStrip'
import { findAssetsForHost } from '../../lib/telemetry-link'
import { assetHref } from '../../components/monitor-drawer/display'
import { hostFlag, hostRegion, hostVendor } from './region'

// 一张卡 = 一台机。版式照着「服务器列表」那种紧凑卡片来：
// 抬头（灯 + 名字 + 厂商 + 机房旗）→ 一行硬件信息 → 三条带细进度条的占用（CPU / 内存 / 磁盘）→
// 探针行（延迟 / 丢包 / 24 拍色条）→ 24 小时曲线 → 底栏（运行时间 + 内存前三）。
// 数据缺字段时全部走兜底文案，不要因为一台机少个字段就整页白屏。

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

/** 一行占用：左边标签、中间补充数字、右边百分比，下面一条 4px 细进度条。 */
function Meter({ label, v, value, note }: { label: string; v: number | undefined; value: string; note?: string }) {
  return (
    <div className="host-meter" title={note ? label + ' · ' + note : label}>
      <span className="host-meter-label">{label}</span>
      <span className="host-meter-note">{note || ''}</span>
      <b className={'host-meter-val tone-' + tone(v)}>{value}</b>
      <span className="host-meter-track">
        <i className={'tone-' + tone(v)} style={{ width: Math.min(100, Math.max(1, v ?? 0)) + '%' }} />
      </span>
    </div>
  )
}

export function HostCard({ h, busy, onTogglePause, onDelete, onOnboard, assets, linkedAssets, onOpenAsset }: {
  h: Host
  /** 有写操作在跑时禁用暂停 / 删除，避免连点 */
  busy?: boolean
  onTogglePause?: (h: Host) => void
  onDelete?: (h: Host) => void
  /** 还没收到上报时给一条「接入指引」（安装命令），有数据就不显示 */
  onOnboard?: (h: Host) => void
  assets?: Array<{ id: number; name: string; custom?: any }>
  linkedAssets?: Array<{ id: number; name: string }>
  onOpenAsset?: (id: number) => void
}) {
  const memTotal = h.mem?.total_kb ?? 0
  const memUsed = memTotal - (h.mem?.avail_kb ?? 0)
  const effectiveLinkedAssets = linkedAssets ?? (assets ? findAssetsForHost(h.id, assets) : [])
  const vendor = hostVendor(h.note)
  const region = hostRegion(h.note)
  const flag = hostFlag(h.note)
  const probe = h.probe ?? null
  // 色条沿用观测台的渲染（四态色 + 悬停看这一拍的时间 / 响应 / 消息）
  const cells = (probe?.beats ?? []).map((b) => ({ status: b.status, tone: null }))
  const details = (probe?.beats ?? []).map((b) => ({ time: b.time || null, msg: b.msg || null, ping: b.ping }))
  const load1 = h.load?.[0]

  return (
    <div className={cx('host-card', h.paused ? 'is-paused' : !h.online && 'is-off')}>
      <div className="host-head">
        <span className={cx('host-dot', h.paused ? 'is-paused' : h.online ? 'is-on' : 'is-off')} />
        <span className="host-name">{h.label}</span>
        {vendor ? <span className="host-vendor">{vendor}</span> : null}
        {h.paused ? <span className="host-pause-tag">{t('已暂停')}</span> : null}
        {effectiveLinkedAssets.map((a) => (
          <a
            key={a.id}
            className="host-asset-badge"
            href={assetHref(a.id)}
            title={t('查看关联资产')}
            onClick={(e) => {
              if (onOpenAsset) {
                e.preventDefault()
                onOpenAsset(a.id)
              }
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11.5,
              padding: '2px 7px',
              borderRadius: 6,
              background: 'var(--surface-2)',
              color: 'var(--accent, #6366f1)',
              textDecoration: 'none',
              cursor: 'pointer',
              flex: 'none',
            }}
          >
            <span>🔗</span>
            <span>{t('关联资产')}: {a.name}</span>
          </a>
        ))}
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
          <div className="host-meta">
            {region ? <span className="host-region">{flag ? flag + ' ' : ''}{region}</span> : null}
            {h.os ? <span>{h.os}</span> : null}
            {load1 !== undefined ? <span>{t('负载')} {load1.toFixed(2)}</span> : null}
            {h.failed_units ? <span className="host-meta-bad">{t('{n} 个单元异常', { n: h.failed_units })}</span> : null}
          </div>

          <div className="host-meters">
            <Meter label={t('CPU')} v={h.cpu_pct} value={pct(h.cpu_pct)} note={h.cores ? t('{n} 核', { n: h.cores }) : ''} />
            <Meter
              label={t('内存')}
              v={h.mem?.used_pct}
              value={pct(h.mem?.used_pct)}
              note={memTotal ? gb(memUsed) + ' / ' + gb(memTotal) : ''}
            />
            {(h.disk || []).map((d) => (
              <Meter
                key={d.path}
                label={t('磁盘') + ' ' + d.path}
                v={d.pct}
                value={pct(d.pct)}
                note={bytes(d.used) + ' / ' + bytes(d.total)}
              />
            ))}
          </div>

          {probe ? (
            <div className="host-probe">
              <span className="host-probe-item">
                <em>{t('延迟')}</em>
                <b>{probe.latencyMs === null ? t('无数据') : Math.round(probe.latencyMs) + ' ms'}</b>
              </span>
              <span className="host-probe-item">
                <em>{t('丢包')}</em>
                <b>{probe.lossPct === null ? t('无数据') : probe.lossPct.toFixed(1) + '%'}</b>
              </span>
              <BeatStrip cells={cells} type={probe.type} title={probe.name} details={details} />
            </div>
          ) : null}

          <Spark series={h.series} />

          <div className="host-foot">
            <span className="host-foot-os">{t('运行')} {uptime(h.uptime_s)}</span>
            <span className="host-foot-top">
              {(h.top || []).map((tg) => tg.comm + ' ' + Math.round(tg.rss_kb / 1024) + 'M').join(' · ')}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
