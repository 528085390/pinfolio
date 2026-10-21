import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type MonitorSummary, type MonitorsPayload } from '../../lib/api'

/**
 * 观测页的数据与视图状态：拉取（带 force）、30 秒轮询、分组/状态/关键词筛选、
 * 从异常通知跳过来时的定位高亮。
 *
 * 两个「别改回去」的点：
 * 1. `load(true)` 只给手动刷新用——30 秒轮询必须走缓存，否则每次都要去戳 Kuma 那个 5–30 秒的慢接口（坑 9）。
 * 2. 抽屉开着时必须停轮询：详情里是表单，后台刷新会把用户正在改的值冲掉。
 */
export function useMonitors({
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
  const summary = data?.summary

  const clearFilters = useCallback(() => {
    setGroup('')
    setStatus('')
    setSearchInput('')
  }, [])

  return {
    data, loading, error, summary,
    group, setGroup, status, setStatus,
    searchInput, setSearchInput, q,
    view, setView, auto, setAuto,
    openId, setOpenId,
    groups, all, visible, shown,
    load, clearFilters,
  }
}

export type MonitorsState = ReturnType<typeof useMonitors>
