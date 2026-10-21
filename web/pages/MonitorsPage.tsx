import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, RefreshCw, LayoutGrid, List, Activity, Globe, Terminal, Plug, ExternalLink } from 'lucide-react'
import { api, cx, type Monitor, type MonitorSummary, type MonitorsPayload } from '../lib/api'
import { relativeTime, fullTime } from '../lib/format'
import { Button, Empty, Spinner } from '../components/ui'
import { BeatStrip } from '../components/BeatStrip'
import { MonitorDrawer } from '../components/MonitorDrawer'
import { isDown, shortGroup, shortName } from '../lib/monitors'

// Kuma 心跳状态码：0 DOWN / 1 UP / 2 PENDING / 3 MAINTENANCE
const STATUS: Record<number, { label: string; color: string }> = {
  0: { label: '故障', color: 'var(--danger)' },
  1: { label: '正常', color: 'var(--ok)' },
  2: { label: '待定', color: 'var(--warn)' },
  3: { label: '维护', color: 'var(--muted)' },
}

// 每日打卡按天心跳：Kuma 只有 up/down，四态靠心跳消息前缀承载，前端据此取色
const TONE: Record<string, { label: string; color: string }> = {
  绿: { label: '成功', color: 'var(--ok)' },
  黄: { label: '部分成功', color: 'var(--warn)' },
  红: { label: '失败', color: 'var(--danger)' },
  灰: { label: '未运行', color: 'var(--muted)' },
}

function tone(m: Monitor): { label: string; color: string } | null {
  const hit = m.msg ? /^\[(绿|黄|红|灰)\]/.exec(m.msg) : null
  if (hit) return TONE[hit[1]] || null
  return m.status === null ? null : STATUS[m.status] || null
}

const TYPE_LABEL: Record<string, string> = {
  http: 'HTTP', ssh: 'SSH', port: 'TCP', ping: 'Ping', dns: 'DNS', keyword: '关键词', grpc: 'gRPC',
}

function TypeIcon({ type, size = 15 }: { type: string; size?: number }) {
  if (type === 'ssh') return <Terminal size={size} />
  if (type === 'port' || type === 'ping') return <Plug size={size} />
  return <Globe size={size} />
}

function pct(v: number | null) {
  if (v === null) return '—'
  return (v * 100).toFixed(v >= 0.9995 ? 0 : 1) + '%'
}

export function MonitorsPage({
  onSummary,
  focusId = null,
  onFocusDone,
}: {
  onSummary?: (s: MonitorSummary) => void
  /** 要从异常通知跳过来的观测项 id */
  focusId?: number | null
  /** 定位+高亮做完后回调，让上层把 focusId 清掉 */
  onFocusDone?: () => void
}) {
  const [data, setData] = useState<MonitorsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [group, setGroup] = useState<number | ''>('')
  const [status, setStatus] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [q, setQ] = useState('')
  const [view, setView] = useState<'grid' | 'table'>('grid')
  const [auto, setAuto] = useState(true)
  const [tick, setTick] = useState(0)
  // 打开的观测项详情（null = 抽屉关着）
  const [openId, setOpenId] = useState<number | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 200)
    return () => clearTimeout(t)
  }, [searchInput])

  // force=true 才绕过后端缓存（手动点刷新）；30 秒轮询走缓存，避免每次都去戳 Kuma 的慢接口
  const load = useCallback(async (force = false) => {
    setLoading(true)
    try {
      const d = await api.monitors.get(force)
      setData(d)
      setError(d.error || '')
      if (d.summary) onSummary?.(d.summary)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [onSummary])

  useEffect(() => { load() }, [load, tick])

  // 从右上角异常通知点进来：清掉可能挡住它的筛选条件 → 滚到那张卡片 → 闪一下
  useEffect(() => {
    if (focusId === null || !data) return
    const el = document.getElementById('monitor-' + focusId)
    if (!el) {
      if (group !== '' || status !== '' || searchInput !== '') {
        setGroup('')
        setStatus('')
        setSearchInput('')
        return
      }
      onFocusDone?.()
      return
    }
    el.scrollIntoView({ block: 'center' })
    el.classList.add('flash')
    const t = setTimeout(() => {
      el.classList.remove('flash')
      onFocusDone?.()
    }, 1600)
    return () => {
      clearTimeout(t)
      el.classList.remove('flash')
    }
  }, [focusId, data, group, status, searchInput, q, view, onFocusDone])

  useEffect(() => {
    // 抽屉开着时停掉 30s 轮询：详情里有表单，后台刷新会把用户正在改的值冲掉
    if (!auto || openId !== null) return
    const t = setInterval(() => setTick((n) => n + 1), 30000)
    return () => clearInterval(t)
  }, [auto, openId])

  const groups = data?.groups || []
  const all = useMemo(() => groups.flatMap((g) => g.monitors), [groups])

  const visible = useMemo(() => {
    const term = q.toLowerCase()
    return groups
      .filter((g) => group === '' || g.id === group)
      .map((g) => ({
        ...g,
        monitors: g.monitors.filter((m) => {
          if (status === 'up' && m.status !== 1) return false
          if (status === 'down' && m.status !== 0) return false
          if (status === 'pending' && m.status !== 2) return false
          if (term && !(m.name + ' ' + m.group + ' ' + m.msg).toLowerCase().includes(term)) return false
          return true
        }),
      }))
      .filter((g) => g.monitors.length > 0)
  }, [groups, group, status, q])

  const shown = visible.flatMap((g) => g.monitors)
  const s = data?.summary

  return (
    <div className="page page-wide page-monitors">
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

      <div className="filters" style={{ marginTop: 18 }}>
        <button className={cx('chip', group === '' && 'active')} onClick={() => setGroup('')}>
          全部<span className="chip-count">{all.length}</span>
        </button>
        {groups.map((g) => (
          <button
            key={g.id}
            className={cx('chip', group === g.id && 'active')}
            onClick={() => setGroup(group === g.id ? '' : g.id)}
            title={g.name}
          >
            {shortGroup(g.name)}
            <span className="chip-count">{g.monitors.length}</span>
          </button>
        ))}
        <div style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 2px' }} />
        <select className="select input-sm" style={{ width: 104 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">所有状态</option>
          <option value="up">正常</option>
          <option value="down">故障</option>
          <option value="pending">待定</option>
        </select>
        <div className="grow" />
        <div style={{ position: 'relative', width: 180 }}>
          <Search size={13} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--muted)' }} />
          <input
            className="input input-sm"
            style={{ paddingLeft: 27 }}
            placeholder="搜索观测项"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <button className={cx('chip', auto && 'active')} onClick={() => setAuto((v) => !v)} title="每 30 秒自动刷新">
          自动刷新
        </button>
        <div className="row" style={{ gap: 2 }}>
          <Button variant={view === 'grid' ? 'default' : 'ghost'} size="sm" icon onClick={() => setView('grid')} title="卡片视图">
            <LayoutGrid size={14} />
          </Button>
          <Button variant={view === 'table' ? 'default' : 'ghost'} size="sm" icon onClick={() => setView('table')} title="表格视图">
            <List size={14} />
          </Button>
        </div>
        <Button variant="ghost" size="sm" icon onClick={() => load(true)} title="立即刷新">
          <RefreshCw size={14} className={loading ? 'spin' : undefined} />
        </Button>
        {data ? <span className="monitor-updated">{relativeTime(data.updatedAt)}</span> : null}
      </div>

      {error && data ? <div className="alert" style={{ marginTop: 14 }}>{error}</div> : null}

      {loading && !data ? (
        <div className="empty"><Spinner /></div>
      ) : !data ? (
        <Empty
          icon={<Activity size={22} />}
          title="读不到观测项"
          text={error || 'Uptime Kuma 可能没在跑（默认 http://127.0.0.1:3001）。'}
          action={<Button size="sm" onClick={() => load(true)}>重试</Button>}
        />
      ) : shown.length === 0 ? (
        <Empty
          icon={<Activity size={22} />}
          title="没有匹配的观测项"
          text="换个筛选条件试试。"
          action={<Button size="sm" onClick={() => { setGroup(''); setStatus(''); setSearchInput('') }}>清空筛选</Button>}
        />
      ) : view === 'grid' ? (
        <div className="asset-grid monitor-grid" style={{ marginTop: 14 }}>
          {shown.map((m) => <MonitorCard key={m.id} m={m} onOpen={() => setOpenId(m.id)} />)}
        </div>
      ) : (
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
                  <tr key={m.id} id={'monitor-' + m.id} className={cx('monitor-row', !m.active && 'paused')} onClick={() => setOpenId(m.id)}>
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
                    <td className="muted">{TYPE_LABEL[m.type] || m.type}</td>
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
      )}

      <MonitorDrawer id={openId} onClose={() => setOpenId(null)} onChanged={() => load(true)} />
    </div>
  )
}

function MonitorCard({ m, onOpen }: { m: Monitor; onOpen: () => void }) {
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
      title="点开看详情"
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
            <span className="monitor-type">{TYPE_LABEL[m.type] || m.type}</span>
          </div>
        </div>
        <span className="status-pill">
          <span className="status-dot" style={{ background: st ? st.color : 'var(--muted)' }} />
          {st ? st.label : '无数据'}
        </span>
      </div>

      <BeatStrip
        cells={m.beats.map((b, i) => ({ status: b, tone: m.beatTones?.[i] ?? null }))}
        type={m.type}
        title={'最近 ' + m.beats.length + ' 次心跳'}
      />

      {m.showMsg && m.msg ? (
        <div className="monitor-note" title={m.msg}>
          <span className="monitor-note-label">本次观测情况</span>
          <span className="monitor-note-text">{m.msg}</span>
        </div>
      ) : null}

      <div className="asset-meta">
        <div className="asset-meta-row">
          <span className="asset-meta-key">响应</span>
          <span className="asset-meta-val">{m.ping === null ? '—' : m.ping + ' ms'}</span>
        </div>
        <div className="asset-meta-row">
          <span className="asset-meta-key">检查</span>
          <span className="asset-meta-val" title={m.time ? fullTime(m.time) : undefined}>{m.time ? relativeTime(m.time) : '—'}</span>
        </div>
      </div>

      <div className="asset-foot">
        {!m.active ? <span className="monitor-chip">已暂停</span> : null}
        <span className="monitor-chip">24h {pct(m.uptime24)}</span>
        {m.downCount > 0 ? <span className="monitor-chip bad">{m.downCount} 次异常</span> : null}
        {m.msg && !m.showMsg ? <span className="monitor-msg" title={m.msg}>{m.msg}</span> : null}
      </div>
    </div>
  )
}
