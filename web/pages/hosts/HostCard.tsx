import type { ReactNode } from 'react'
import {
  Activity,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Clock3,
  Cpu,
  Download,
  HardDrive,
  Link2,
  MemoryStick,
  Network,
  Pause,
  Play,
  Radio,
  Server,
  Settings2,
  Trash2,
  Upload,
} from 'lucide-react'
import { cx, type Host, type HostProbeBeat } from '../../lib/api'
import { t } from '../../lib/i18n'
import { findAssetsForHost } from '../../lib/telemetry-link'
import { assetHref } from '../../components/monitor-drawer/display'
import { hostFlag, hostRegion, hostVendor } from './region'

// 主机卡：参考 Nezha 的 376×390 玻璃卡。数据全部来自 Host，缺字段显示「—」，
// 不补假值；暂停、删除藏在 hover 操作区，不抢卡面。
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

/** 网络流量是字节，和磁盘的 KB 入参分开算；0 也显示 0 B，不写成 —。 */
function flow(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n) || n < 0) return '—'
  if (n === 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let v = n
  let i = 0
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return (i === 0 ? v.toFixed(0) : v.toFixed(1)) + ' ' + u[i]
}

function speed(n: number | undefined): string {
  return n === undefined || !Number.isFinite(n) ? '—' : flow(n) + '/s'
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

function clampPct(v: number | undefined): number {
  if (v === undefined || Number.isNaN(v)) return 0
  return Math.min(100, Math.max(0, v))
}

function tone(v: number | undefined): 'ok' | 'warn' | 'bad' {
  if (v === undefined) return 'ok'
  return v >= 85 ? 'bad' : v >= 70 ? 'warn' : 'ok'
}

function FlagIcon({ flag }: { flag: string }) {
  const code = flag.trim()
  if (code === 'JP' || code.includes('🇯🇵')) {
    return (
      <svg viewBox="0 0 24 16" aria-hidden="true">
        <rect width="24" height="16" rx="2" fill="#fff" />
        <circle cx="12" cy="8" r="4.2" fill="#bc002d" />
      </svg>
    )
  }
  if (code === 'US' || code.includes('🇺🇸')) {
    const stripes = Array.from({ length: 13 }, (_, i) => i)
    return (
      <svg viewBox="0 0 24 16" aria-hidden="true">
        <rect width="24" height="16" rx="2" fill="#fff" />
        {stripes.map((i) => (
          <rect key={i} x="0" y={(i * 16) / 13} width="24" height={16 / 13} fill={i % 2 === 0 ? '#b22234' : '#fff'} />
        ))}
        <rect width="10" height={(16 * 7) / 13} fill="#3c3b6e" />
      </svg>
    )
  }
  return <span className="hm-flag-code">{code || '—'}</span>
}

function Metric({ icon, label, value, note, sub, pct: percent, kind, text }: {
  icon: ReactNode
  label: string
  value: string
  note?: string
  sub?: string
  pct?: number
  kind?: 'cpu' | 'mem' | 'disk' | 'latency' | 'loss'
  text?: boolean
}) {
  const hasBar = typeof percent === 'number' && !Number.isNaN(percent)
  const toneName = tone(percent)
  return (
    <div className="hm-cell" title={note || undefined}>
      <div className="hm-line">
        <span className="hm-label">{icon}<span>{label}</span></span>
        <b className={cx('hm-value', text && 'is-text')}>{value}{sub ? <small>{sub}</small> : null}</b>
      </div>
      {hasBar ? (
        <span className="hm-bar">
          <i className={cx('is-' + (kind || 'cpu'), 'tone-' + toneName)} style={{ width: Math.max(2, clampPct(percent)) + '%' }} />
        </span>
      ) : null}
    </div>
  )
}

function beatMarks(beats: HostProbeBeat[]): Array<{ height: number; tone: string; kind: 'dot' | 'bar' }> {
  const visible = beats.slice(-32)
  const pings = visible.map((b) => b.ping).filter((v): v is number => typeof v === 'number')
  const min = pings.length ? Math.min(...pings) : 0
  const max = pings.length ? Math.max(...pings) : 0
  const span = Math.max(1, max - min)
  const barStart = Math.floor(visible.length * 0.44)
  return visible.map((b, i) => {
    const kind: 'dot' | 'bar' = i < barStart ? 'dot' : 'bar'
    const normalized = typeof b.ping === 'number' ? (b.ping - min) / span : 0.4
    const height = kind === 'bar' ? 10 + Math.round(normalized * 4) : 3
    const tone = b.status !== 1 ? 'is-bad' : typeof b.ping !== 'number' ? 'is-muted' : b.ping > 300 ? 'is-warn' : ''
    return { height, tone, kind }
  })
}

export function HostCard({ h, busy, onTogglePause, onDelete, onOnboard, onEdit, assets, linkedAssets, onOpenAsset }: {
  h: Host
  busy?: boolean
  onTogglePause?: (h: Host) => void
  onDelete?: (h: Host) => void
  onOnboard?: (h: Host) => void
  onEdit?: (h: Host) => void
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
  const hasProbe = !!probe && ((probe.beats?.length ?? 0) > 0 || probe.latencyMs !== null)
  const primaryDisk = h.disk?.[0]
  const net = h.network
  const monthly = net ? (net.monthly_rx_bytes ?? 0) + (net.monthly_tx_bytes ?? 0) : undefined
  const tcp = net?.tcp
  const neverSeen = h.ts === undefined
  const stateClass = h.paused ? 'is-paused' : neverSeen ? 'is-idle' : h.online ? 'is-on' : 'is-off'
  const stateLabel = h.paused ? t('已暂停') : neverSeen ? t('未接入') : h.online ? t('在线') : t('离线')
  const beats = beatMarks(probe?.beats ?? [])
  const system = h.os || h.kernel || '—'
  const topText = (h.top ?? []).map((tg) => tg.comm + ' ' + Math.round(tg.rss_kb / 1024) + 'M').join(' · ')
  const address = (h.address || '').trim()
  const isV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)
  const isV6 = address.includes(':') && !address.includes('/')
  const unitStates = Object.entries(h.units ?? {})
  const activeUnits = unitStates.filter(([, state]) => state === 'active').length
  const downUnits = unitStates.length - activeUnits
  const loadText = h.load?.length ? t('负载 {n}', { n: h.load[0].toFixed(2) }) : ''
  const diskText = (h.disk ?? []).map((d) => d.path + ' ' + pct(d.pct) + ' ' + bytes(d.used) + '/' + bytes(d.total)).join(' · ')
  const serviceText = unitStates.length ? t('服务 {ok}/{n}', { ok: activeUnits, n: unitStates.length }) : ''
  const failedText = h.failed_units ? t('{n} 个系统单元异常', { n: h.failed_units }) : ''
  const cardTitle = [address, system !== '—' ? system : '', loadText, serviceText, failedText, diskText, topText].filter(Boolean).join(' · ') || undefined

  return (
    <article className={cx('hm-card', h.paused && 'is-paused', !h.paused && !h.online && 'is-off')} title={cardTitle}>
      <header className="hm-head">
        <span className="hm-flag">{flag ? <FlagIcon flag={flag} /> : <Server size={14} />}</span>
        <div className="hm-ident">
          <div className="hm-name" title={h.label || h.id}>{h.label || h.id}</div>
          <div className="hm-sub">
            {vendor ? <span className="hm-level is-vendor">{vendor}</span> : null}
            {region ? <span className="hm-region">{region}</span> : null}
            {downUnits > 0 ? <span className="hm-level is-warn" title={unitStates.map(([u, s]) => u + ': ' + s).join('\n')}>{t('服务 {ok}/{n}', { ok: activeUnits, n: unitStates.length })}</span> : null}
          </div>
        </div>
        <div className="hm-right">
          <span className="hm-os" title={system}><Server size={11} /></span>
          {isV4 ? <span className="hm-net" title={address}>IPv4</span> : null}
          {isV6 ? <span className="hm-net" title={address}>IPv6</span> : null}
          <span className={cx('hm-status', stateClass)} title={stateLabel} />
          <div className="hm-ops">
            <button
              className="hm-op"
              title={h.paused ? t('恢复采集') : t('暂停采集（保留卡片与历史，只是不再拉取）')}
              disabled={busy}
              onClick={() => onTogglePause?.(h)}
            >
              {h.paused ? <Play size={11} /> : <Pause size={11} />}
            </button>
            <button
              className="hm-op"
              title={t('编辑主机信息')}
              disabled={busy}
              onClick={() => onEdit?.(h)}
            >
              <Settings2 size={11} />
            </button>
            <button
              className="hm-op is-danger"
              title={t('删除这台主机（{id}）', { id: h.id })}
              disabled={busy}
              onClick={() => onDelete?.(h)}
            >
              <Trash2 size={11} />
            </button>
          </div>
        </div>
      </header>

      <div className="hm-rows">
        <div className="hm-row">
          <Metric icon={<Cpu size={11} />} label={t('CPU')} value={pct(h.cpu_pct)} note={h.cores ? t('{n} 核', { n: h.cores }) : ''} pct={h.cpu_pct} kind="cpu" />
          <Metric icon={<MemoryStick size={11} />} label={t('内存')} value={pct(h.mem?.used_pct)} note={memTotal ? gb(memUsed) + ' / ' + gb(memTotal) : ''} pct={h.mem?.used_pct} kind="mem" />
        </div>
        <div className="hm-row">
          <Metric icon={<HardDrive size={11} />} label={t('磁盘')} value={primaryDisk ? pct(primaryDisk.pct) : '—'} note={primaryDisk ? primaryDisk.path + ' · ' + bytes(primaryDisk.used) + ' / ' + bytes(primaryDisk.total) : ''} pct={primaryDisk?.pct} kind="disk" />
          <Metric
            icon={<CalendarDays size={11} />}
            label={t('月度')}
            value={monthly === undefined ? '—' : flow(monthly)}
            note={net ? t('本月 ↓{rx} · ↑{tx}', { rx: flow(net.monthly_rx_bytes), tx: flow(net.monthly_tx_bytes) }) : t('采集端待升级')}
          />
        </div>
        <div className="hm-row">
          <Metric icon={<ArrowDown size={11} />} label={t('下行')} value={speed(net?.rx_rate)} note={t('当前速率')} />
          <Metric icon={<ArrowUp size={11} />} label={t('上行')} value={speed(net?.tx_rate)} note={t('当前速率')} />
        </div>
        <div className="hm-row">
          <Metric icon={<Download size={11} />} label={t('下载流量')} value={flow(net?.rx_bytes)} note={t('开机以来累计')} />
          <Metric icon={<Upload size={11} />} label={t('上传流量')} value={flow(net?.tx_bytes)} note={t('开机以来累计')} />
        </div>
        <div className="hm-row hm-row-tcp">
          <div className="hm-cell is-plain hm-cell-tcp">
            <div className="hm-line hm-line-tcp">
              <span className="hm-label"><Network size={10} /><span>{t('TCP线路')}<i className="hm-sep">·</i><b className="hm-tcp-value">{tcp === undefined ? '—' : String(tcp)}</b></span></span>
            </div>
          </div>
          <div className="hm-cell is-plain hm-cell-window">
            <span className="hm-window-pill">1 h</span>
          </div>
        </div>
        <div className="hm-row hm-row-latency">
          <Metric icon={<Activity size={11} />} label={t('延迟')} value={hasProbe && probe?.latencyMs !== null ? Math.round(probe.latencyMs) + ' ms' : '—'} note={hasProbe ? t('近 24 小时') : t('未接入探针')} pct={hasProbe && probe?.latencyMs !== null ? Math.min(100, probe.latencyMs / 2) : undefined} kind="latency" />
          <Metric icon={<Radio size={11} />} label={t('丢包')} value={hasProbe && probe?.lossPct !== null ? probe.lossPct.toFixed(1) + '%' : '—'} pct={hasProbe && probe?.lossPct !== null ? probe.lossPct : undefined} kind="loss" />
        </div>
      </div>

      {beats.length ? (
        <div className="hm-beats" aria-hidden="true">
          {beats.map((b, i) => (
            <i key={i} className={[b.tone, b.kind === 'bar' ? 'is-bar' : 'is-dot'].filter(Boolean).join(' ')} style={{ height: b.height }} />
          ))}
        </div>
      ) : (
        <div className="hm-beats-empty">{t('暂无探针数据')}</div>
      )}

      <footer className="hm-foot">
        <div className="hm-foot-line">
          <span><em><CalendarDays size={10} />{t('到期')}</em><b title={h.expires || t('未登记')}>{h.expires || '—'}</b></span>
          <span><em><Clock3 size={10} />{t('运行时间')}</em><b>{uptime(h.uptime_s)}</b></span>
        </div>
        <div className="hm-foot-bottom">
          <span className="hm-updated">{h.paused ? t('暂停采集') : neverSeen ? t('未接入') : t('更新于 {time}', { time: ago(h.staleSec) })}</span>
          <div className="hm-assets">
            {neverSeen && onOnboard ? (
              <button className="hm-asset hm-onboard" onClick={() => onOnboard(h)}>{t('接入')}</button>
            ) : null}
            {effectiveLinkedAssets.map((a) => (
              <a
                key={a.id}
                className="hm-asset"
                href={assetHref(a.id)}
                title={t('查看关联资产')}
                onClick={(e) => {
                  if (onOpenAsset) {
                    e.preventDefault()
                    onOpenAsset(a.id)
                  }
                }}
              >
                <Link2 size={9} />
                <span>{a.name}</span>
              </a>
            ))}
          </div>
        </div>
      </footer>
    </article>
  )
}
