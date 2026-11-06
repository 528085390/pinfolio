import { useEffect, useMemo, useState } from 'react'
import { Activity, ExternalLink, Play, RefreshCw, Server, Sparkles, Wifi } from 'lucide-react'
import type { Host, Monitor } from '../../lib/api'
import { cx } from '../../lib/cx'
import { shortGroup } from '../../lib/telemetry-link'
import {
  parseAssetTelemetry,
  suggestTelemetry,
  type AssetTelemetry,
} from '../../lib/telemetry-link'
import type { AssetFormState } from './form'
import { t } from '../../lib/i18n'

function Field({
  label,
  hint,
  children,
  span,
}: {
  label: string
  hint?: string
  children: React.ReactNode
  span?: boolean | number
}) {
  return (
    <label className={cx('field', span ? 'span-2' : false)}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}

async function resolveApi() {
  if (typeof window !== 'undefined' && (window as any).api) {
    return (window as any).api
  }
  const mod = await import('../../lib/api.js')
  return mod.api
}

/**
 * 计算自动建议提示文案与匹配数据
 */
export function getSuggestHint(
  name: string,
  location: string,
  hosts: Array<{ id: string; label?: string }>,
  monitors: Array<{ id: number; name: string; group?: string }>,
  custom: any,
): { hostId: string | null; monitorIds: number[]; text: string } | null {
  const current = parseAssetTelemetry(custom)
  const suggestion = suggestTelemetry(name, location, hosts, monitors)

  const hasNewHost = Boolean(
    suggestion.suggestedHostId &&
    current.hostId !== suggestion.suggestedHostId &&
    !current.hostId,
  )
  const hasNewMonitors = Boolean(
    suggestion.suggestedMonitorIds.length > 0 &&
    (current.monitorIds.length === 0 ||
      !suggestion.suggestedMonitorIds.every((id) => current.monitorIds.includes(id))),
  )

  if (!hasNewHost && !hasNewMonitors) {
    return null
  }

  const parts: string[] = []
  if (suggestion.suggestedHostId) {
    parts.push(t('主机 [{hostId}]', { hostId: suggestion.suggestedHostId }))
  }
  if (suggestion.suggestedMonitorIds.length > 0) {
    parts.push(t('观测项 [{count}] 个', { count: suggestion.suggestedMonitorIds.length }))
  }

  const text = t('检测到匹配: {details} (点击一键填入)', { details: parts.join(', ') })

  return {
    hostId: suggestion.suggestedHostId,
    monitorIds: suggestion.suggestedMonitorIds,
    text,
  }
}

/**
 * 格式化主机 CPU、内存、负载与状态
 */
export function formatHostStats(h: Host | null | undefined): {
  cpu: string
  memory: string
  load: string
  statusTag: 'online' | 'offline' | 'paused' | 'stale'
} {
  if (!h) {
    return { cpu: '—', memory: '—', load: '—', statusTag: 'offline' }
  }

  const cpu =
    h.cpu_pct !== undefined && !Number.isNaN(h.cpu_pct)
      ? `${h.cpu_pct.toFixed(1)}%`
      : '—'
  const memPct = h.mem?.used_pct
  const memory =
    memPct !== undefined && !Number.isNaN(memPct) ? `${memPct.toFixed(1)}%` : '—'
  const load =
    h.load && h.load.length > 0
      ? h.load.map((v) => v.toFixed(2)).join(' ')
      : '—'

  let statusTag: 'online' | 'offline' | 'paused' | 'stale' = 'offline'
  if (h.paused) {
    statusTag = 'paused'
  } else if (!h.online) {
    statusTag = 'offline'
  } else if (h.staleSec !== null && h.staleSec !== undefined && h.staleSec > 300) {
    statusTag = 'stale'
  } else {
    statusTag = 'online'
  }

  return { cpu, memory, load, statusTag }
}

/**
 * 格式化观测项状态码、延迟与可用率
 */
export function formatMonitorStatus(m: Monitor | null | undefined): {
  badge: 'UP' | 'DOWN' | 'PENDING' | 'MAINTENANCE' | 'UNKNOWN'
  ping: string
  uptime: string
} {
  if (!m) {
    return { badge: 'UNKNOWN', ping: '—', uptime: '—' }
  }

  let badge: 'UP' | 'DOWN' | 'PENDING' | 'MAINTENANCE' | 'UNKNOWN' = 'UNKNOWN'
  if (m.status === 1) {
    badge = 'UP'
  } else if (m.status === 0) {
    badge = 'DOWN'
  } else if (m.status === 2) {
    badge = 'PENDING'
  } else if (m.status === 3) {
    badge = 'MAINTENANCE'
  }

  const ping = m.ping !== null && m.ping !== undefined ? `${m.ping} ms` : '—'
  let uptime = '—'
  if (m.uptime24 !== null && m.uptime24 !== undefined) {
    const val = m.uptime24 * 100
    uptime = val >= 99.95 ? '100%' : `${val.toFixed(1)}%`
  }

  return { badge, ping, uptime }
}

export type LinkedTelemetryProps = {
  form: AssetFormState
  setCustom: (key: string, value: any) => void
  setTelemetry?: (telemetry: Partial<AssetTelemetry>) => void
  availableHosts?: Host[]
  availableMonitors?: Monitor[]
  readOnly?: boolean
}

export function LinkedTelemetry({
  form,
  setCustom,
  setTelemetry,
  availableHosts,
  availableMonitors,
}: LinkedTelemetryProps) {
  const [hosts, setHosts] = useState<Host[]>(availableHosts || [])
  const [monitors, setMonitors] = useState<Monitor[]>(availableMonitors || [])
  const [checkingId, setCheckingId] = useState<number | null>(null)
  const [checkResults, setCheckResults] = useState<Record<number, string>>({})

  // 若外部未传入预载数据，则自行拉取
  useEffect(() => {
    if (availableHosts) {
      setHosts(availableHosts)
      return
    }
    let cancelled = false
    const fetchHosts = async () => {
      try {
        const api = await resolveApi()
        const fn = api.hosts?.list || api.hosts?.get
        if (typeof fn === 'function') {
          const res = await fn()
          if (!cancelled && res?.hosts) {
            setHosts(res.hosts)
          }
        }
      } catch (e) {
        console.warn('Failed to fetch hosts:', e)
      }
    }
    void fetchHosts()
    return () => {
      cancelled = true
    }
  }, [availableHosts])

  useEffect(() => {
    if (availableMonitors) {
      setMonitors(availableMonitors)
      return
    }
    let cancelled = false
    const fetchMonitors = async () => {
      try {
        const api = await resolveApi()
        const fn = api.monitors?.list || api.monitors?.get
        if (typeof fn === 'function') {
          const res = await fn()
          if (!cancelled && res?.groups) {
            const list = res.groups.flatMap((g: any) => g.monitors || [])
            setMonitors(list)
          }
        }
      } catch (e) {
        console.warn('Failed to fetch monitors:', e)
      }
    }
    void fetchMonitors()
    return () => {
      cancelled = true
    }
  }, [availableMonitors])

  const currentTelemetry = useMemo(
    () => parseAssetTelemetry(form.custom),
    [form.custom],
  )

  const suggestHint = useMemo(() => {
    return getSuggestHint(form.name, form.location, hosts, monitors, form.custom)
  }, [form.name, form.location, hosts, monitors, form.custom])

  function applySuggestion() {
    if (!suggestHint) return
    if (setTelemetry) {
      setTelemetry({
        hostId: suggestHint.hostId ?? currentTelemetry.hostId,
        monitorIds:
          suggestHint.monitorIds.length > 0
            ? Array.from(new Set([...currentTelemetry.monitorIds, ...suggestHint.monitorIds]))
            : currentTelemetry.monitorIds,
      })
    } else {
      if (suggestHint.hostId && !currentTelemetry.hostId) {
        setCustom('hostId', suggestHint.hostId)
      }
      if (suggestHint.monitorIds.length > 0) {
        const merged = Array.from(
          new Set([...currentTelemetry.monitorIds, ...suggestHint.monitorIds]),
        )
        setCustom('monitorIds', merged)
      }
    }
  }

  function handleHostChange(newHostId: string) {
    const trimmed = newHostId.trim()
    const finalVal = trimmed.length > 0 ? trimmed : null
    if (setTelemetry) {
      setTelemetry({ hostId: finalVal })
    } else {
      setCustom('hostId', finalVal)
    }
  }

  function toggleMonitor(id: number) {
    const exists = currentTelemetry.monitorIds.includes(id)
    const next = exists
      ? currentTelemetry.monitorIds.filter((item) => item !== id)
      : [...currentTelemetry.monitorIds, id]

    if (setTelemetry) {
      setTelemetry({ monitorIds: next })
    } else {
      setCustom('monitorIds', next)
    }
  }

  async function handleCheckMonitor(id: number) {
    setCheckingId(id)
    setCheckResults((prev) => ({ ...prev, [id]: '' }))
    try {
      const api = await resolveApi()
      const res = await api.monitors.check(id)
      if (res?.ok) {
        const stepSummary =
          res.steps?.map((s: any) => s.label).join(' → ') || t('观测完成')
        setCheckResults((prev) => ({ ...prev, [id]: stepSummary }))
      } else {
        setCheckResults((prev) => ({ ...prev, [id]: t('观测失败') }))
      }
    } catch (e: any) {
      setCheckResults((prev) => ({ ...prev, [id]: e.message || t('观测失败') }))
    } finally {
      setCheckingId(null)
    }
  }

  const linkedHost = currentTelemetry.hostId
    ? hosts.find((h) => h.id.toLowerCase() === currentTelemetry.hostId?.toLowerCase())
    : null
  const hostStats = formatHostStats(linkedHost)

  return (
    <div style={{ marginTop: 16 }}>
      <div
        className="section-title"
        style={{
          marginTop: 0,
          marginBottom: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Activity size={14} />
        <span>{t('运维观测关联')}</span>
      </div>

      {suggestHint ? (
        <div
          role="button"
          tabIndex={0}
          onClick={applySuggestion}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              applySuggestion()
            }
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            marginBottom: 12,
            borderRadius: 8,
            background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
            color: 'var(--accent)',
            fontSize: 12.5,
            cursor: 'pointer',
            fontWeight: 500,
            transition: 'filter 0.15s',
          }}
          title={t('点击一键填入')}
        >
          <Sparkles size={14} style={{ flexShrink: 0 }} />
          <span>{suggestHint.text}</span>
        </div>
      ) : null}

      <div className="form-grid">
        <Field label={t('关联主机')} hint={t('关联到主机指标中的节点')}>
          <select
            className="select"
            value={currentTelemetry.hostId ?? ''}
            onChange={(e) => handleHostChange(e.target.value)}
          >
            <option value="">{t('无（未关联主机）')}</option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label ? `${h.label} (${h.id})` : h.id}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label={t('关联观测项')}
          hint={t('勾选与该资产关联的探活监测项')}
          span={2}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              maxHeight: 180,
              overflowY: 'auto',
              border: '1px solid var(--line)',
              borderRadius: 9,
              padding: '8px 10px',
              background: 'var(--surface-2)',
            }}
          >
            {monitors.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {t('未配置或已移除')}
              </div>
            ) : (
              monitors.map((m) => {
                const checked = currentTelemetry.monitorIds.includes(m.id)
                return (
                  <label
                    key={m.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 13,
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleMonitor(m.id)}
                    />
                    <span style={{ fontWeight: 500 }}>{m.name}</span>
                    {m.group ? (
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                        ({shortGroup(m.group)})
                      </span>
                    ) : null}
                  </label>
                )
              })
            )}
          </div>
          {currentTelemetry.monitorIds.length > 0 ? (
            <div style={{ marginTop: 4 }}>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                style={{ fontSize: 11, padding: '0 6px', height: 22 }}
                onClick={() => {
                  if (setTelemetry) setTelemetry({ monitorIds: [] })
                  else setCustom('monitorIds', [])
                }}
              >
                {t('清空选择')}
              </button>
            </div>
          ) : null}
        </Field>
      </div>

      {/* 实时状态展示区 */}
      {(currentTelemetry.hostId || currentTelemetry.monitorIds.length > 0) && (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {currentTelemetry.hostId ? (
            <div
              className="card"
              style={{
                padding: '10px 14px',
                border: '1px solid var(--line)',
                borderRadius: 10,
                background: 'var(--surface)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <Server size={14} style={{ color: 'var(--ink-2)' }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {t('主机指标')}：{currentTelemetry.hostId}
                </span>
                {linkedHost ? (
                  <span
                    style={{
                      fontSize: 11,
                      padding: '1px 6px',
                      borderRadius: 4,
                      fontWeight: 600,
                      background:
                        hostStats.statusTag === 'online'
                          ? 'color-mix(in srgb, var(--ok) 15%, transparent)'
                          : hostStats.statusTag === 'paused'
                            ? 'var(--surface-2)'
                            : hostStats.statusTag === 'stale'
                              ? 'color-mix(in srgb, var(--warn) 15%, transparent)'
                              : 'color-mix(in srgb, var(--danger) 15%, transparent)',
                      color:
                        hostStats.statusTag === 'online'
                          ? 'var(--ok)'
                          : hostStats.statusTag === 'paused'
                            ? 'var(--muted)'
                            : hostStats.statusTag === 'stale'
                              ? 'var(--warn)'
                              : 'var(--danger)',
                    }}
                  >
                    {hostStats.statusTag === 'online'
                      ? t('在线')
                      : hostStats.statusTag === 'paused'
                        ? t('已暂停')
                        : hostStats.statusTag === 'stale'
                          ? t('陈旧')
                          : t('离线')}
                  </span>
                ) : null}
                <a
                  className="btn btn-sm btn-ghost"
                  href="#/hosts"
                  style={{ marginLeft: 'auto', gap: 4, fontSize: 11.5 }}
                >
                  {t('前往主机页')} <ExternalLink size={12} />
                </a>
              </div>

              {linkedHost ? (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 8,
                    fontSize: 12,
                    background: 'var(--surface-2)',
                    padding: '8px 10px',
                    borderRadius: 8,
                  }}
                >
                  <div>
                    <span style={{ color: 'var(--muted)', marginRight: 4 }}>CPU:</span>
                    <b style={{ fontWeight: 600 }}>{hostStats.cpu}</b>
                  </div>
                  <div>
                    <span style={{ color: 'var(--muted)', marginRight: 4 }}>
                      {t('内存')}:
                    </span>
                    <b style={{ fontWeight: 600 }}>{hostStats.memory}</b>
                  </div>
                  <div>
                    <span style={{ color: 'var(--muted)', marginRight: 4 }}>
                      {t('负载')}:
                    </span>
                    <b style={{ fontWeight: 600 }}>{hostStats.load}</b>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--muted)',
                    padding: '6px 8px',
                    background: 'var(--surface-2)',
                    borderRadius: 6,
                  }}
                >
                  {t('主机「{id}」未配置或已移除', { id: currentTelemetry.hostId })}
                </div>
              )}
            </div>
          ) : null}

          {currentTelemetry.monitorIds.length > 0 ? (
            <div
              className="card"
              style={{
                padding: '10px 14px',
                border: '1px solid var(--line)',
                borderRadius: 10,
                background: 'var(--surface)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <Activity size={14} style={{ color: 'var(--ink-2)' }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {t('观测状态')} ({currentTelemetry.monitorIds.length})
                </span>
                <a
                  className="btn btn-sm btn-ghost"
                  href="#/monitors"
                  style={{ marginLeft: 'auto', gap: 4, fontSize: 11.5 }}
                >
                  {t('前往观测台')} <ExternalLink size={12} />
                </a>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {currentTelemetry.monitorIds.map((id) => {
                  const mon = monitors.find((m) => m.id === id)
                  if (!mon) {
                    return (
                      <div
                        key={id}
                        style={{
                          fontSize: 12,
                          color: 'var(--muted)',
                          padding: '6px 8px',
                          background: 'var(--surface-2)',
                          borderRadius: 6,
                        }}
                      >
                        {t('观测项 #{id} 未配置或已移除', { id })}
                      </div>
                    )
                  }

                  const st = formatMonitorStatus(mon)
                  const isChecking = checkingId === mon.id
                  const resultMsg = checkResults[mon.id]

                  return (
                    <div
                      key={id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        background: 'var(--surface-2)',
                        borderRadius: 8,
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          minWidth: 0,
                          flex: 1,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            padding: '1px 5px',
                            borderRadius: 4,
                            fontWeight: 600,
                            background:
                              st.badge === 'UP'
                                ? 'color-mix(in srgb, var(--ok) 15%, transparent)'
                                : st.badge === 'DOWN'
                                  ? 'color-mix(in srgb, var(--danger) 15%, transparent)'
                                  : st.badge === 'PENDING'
                                    ? 'color-mix(in srgb, var(--warn) 15%, transparent)'
                                    : 'var(--surface-3)',
                            color:
                              st.badge === 'UP'
                                ? 'var(--ok)'
                                : st.badge === 'DOWN'
                                  ? 'var(--danger)'
                                  : st.badge === 'PENDING'
                                    ? 'var(--warn)'
                                    : 'var(--muted)',
                          }}
                        >
                          {st.badge}
                        </span>
                        <span
                          style={{
                            fontSize: 12.5,
                            fontWeight: 500,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={mon.name}
                        >
                          {mon.name}
                        </span>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          fontSize: 12,
                          color: 'var(--ink-2)',
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            color: 'var(--muted)',
                          }}
                          title={t('延迟')}
                        >
                          <Wifi size={12} /> {st.ping}
                        </span>
                        <span style={{ color: 'var(--muted)' }} title={t('24h 可用率')}>
                          {st.uptime}
                        </span>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          disabled={isChecking}
                          onClick={() => handleCheckMonitor(mon.id)}
                          style={{ height: 24, padding: '0 8px', fontSize: 11 }}
                          title={t('立即观测')}
                        >
                          {isChecking ? (
                            <RefreshCw size={11} className="spin" />
                          ) : (
                            <Play size={11} />
                          )}
                          <span>{isChecking ? t('观测中…') : t('立即观测')}</span>
                        </button>
                      </div>

                      {resultMsg ? (
                        <div
                          style={{
                            width: '100%',
                            fontSize: 11,
                            color: 'var(--muted)',
                            marginTop: 2,
                            paddingLeft: 2,
                          }}
                        >
                          {resultMsg}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
