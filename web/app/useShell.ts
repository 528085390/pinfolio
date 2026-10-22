import { useCallback, useEffect, useState } from 'react'
import { api, type FieldDef, type HostSummary, type MonitorSummary, type Stats, type Tag } from '../lib/api'
import { usePage } from '../lib/router'
import { useMonitorAlerts } from '../lib/monitors'
import type { MailSummary } from './titles'

export const THEME_KEY = 'pinboard-theme'

// 应用外壳的状态：页面、元数据、主题、命令面板、异常通知、跨页跳转。
// 页面组件只拿自己需要的，别把整包往下传。
export function useShell() {
  // 页面由 URL 驱动：/notes /assets /monitors /settings，刷新和深链都停在同一页
  const [page, setPage] = usePage()
  const [tags, setTags] = useState<Tag[]>([])
  const [fields, setFields] = useState<FieldDef[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [mon, setMon] = useState<MonitorSummary | null>(null)
  const [host, setHost] = useState<HostSummary | null>(null)
  const [mailSum, setMailSum] = useState<MailSummary | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [openAssetId, setOpenAssetId] = useState<number | 'new' | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // 从异常通知点进来时要定位的观测项（null = 不用定位）
  const [focusMonitorId, setFocusMonitorId] = useState<number | null>(null)
  const { alerts: monitorAlerts, dismiss: dismissAlert } = useMonitorAlerts()
  const [theme, setTheme] = useState<string>(() => localStorage.getItem(THEME_KEY) || 'system')

  const refreshMeta = useCallback(async () => {
    try {
      const [b, s] = await Promise.all([api.bootstrap(), api.stats()])
      setTags(b.tags)
      setFields(b.fields)
      setStats(s)
      setError('')
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    refreshMeta().finally(() => setReady(true))
  }, [refreshMeta])

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme)
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mql.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    mql.addEventListener('change', apply)
    return () => mql.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function openAsset(id: number | 'new') {
    setPage('assets')
    setOpenAssetId(id)
  }

  // 点异常通知：关掉这条通知，切到观测台并定位到那一项（id 为 null 时只切页）
  function openMonitor(id: number | null) {
    if (id !== null) dismissAlert(id)
    setPage('monitors')
    setFocusMonitorId(id)
  }

  return {
    page, setPage,
    tags, fields, stats, mon, setMon, host, setHost, mailSum, setMailSum,
    ready, error, refreshMeta,
    openAssetId, setOpenAssetId,
    paletteOpen, setPaletteOpen,
    focusMonitorId, setFocusMonitorId,
    monitorAlerts, dismissAlert,
    theme, setTheme,
    openAsset, openMonitor,
  }
}

export type ShellState = ReturnType<typeof useShell>
