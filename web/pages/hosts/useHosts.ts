import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type HostSummary, type HostsPayload } from '../../lib/api'

// 主机的加载逻辑：进页面拉一次，之后每 60 秒刷一次（服务端自己 5 分钟才真正去 my-server 取一次）。
export function useHosts({ onSummary }: { onSummary?: (s: HostSummary) => void } = {}) {
  const [data, setData] = useState<HostsPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [auto, setAuto] = useState(true)

  const load = useCallback(async (refresh = false) => {
    setLoading(true)
    try {
      const next = refresh ? await api.hosts.refresh() : await api.hosts.get()
      setData(next)
      setError(next.error || '')
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!auto) return
    const t = setInterval(() => { void load() }, 60_000)
    return () => clearInterval(t)
  }, [auto, load])

  /** 写接口（增 / 暂停 / 删）成功后服务端直接回新快照，换上就行，不用再 GET 一次 */
  const apply = useCallback((next: HostsPayload) => {
    setData(next)
    setError(next.error || '')
  }, [])

  const summary = useMemo<HostSummary>(() => {
    const hosts = data?.hosts ?? []
    const online = hosts.filter((h) => h.online).length
    const paused = hosts.filter((h) => h.paused).length
    // 暂停的不算在线也不算「陈旧」：标题里的「N 台陈旧」只该报真的失联
    return { total: hosts.length, online, paused, stale: hosts.length - online - paused }
  }, [data])

  useEffect(() => { onSummary?.(summary) }, [summary, onSummary])

  return { data, loading, error, auto, setAuto, load, apply, summary }
}
