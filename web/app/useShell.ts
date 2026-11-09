import { useCallback, useEffect, useState } from 'react'
import { api, type FieldDef, type HostSummary, type MonitorSummary, type Stats, type Tag } from '../lib/api'
import { usePage } from '../lib/router'
import { useMonitorAlerts } from '../lib/monitors'
import {
  REFRACT_KEY,
  STYLE_KEY,
  THEME_KEY,
  WALLPAPER_KEY,
  applyPref,
  applyWallpaperVar,
  readStoredRefract,
  readStoredStyle,
  readStoredTheme,
  readStoredWallpaper,
  resolveTheme,
  type RefractPref,
  type StylePref,
  type ThemePref,
} from '../lib/theme-prefs'
import type { MailSummary } from './titles'

// 四个持久化键的权威定义在 lib/theme-prefs（首帧要用同一套），这里原样转出，别处照旧从 useShell 引
export { REFRACT_KEY, STYLE_KEY, THEME_KEY, WALLPAPER_KEY }

// 存偏好：隐私模式下 localStorage 会抛，但切换本身要照常生效
function storePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 存不下就只在本次会话内生效
  }
}

// 应用外壳的状态：页面、元数据、主题、风格、命令面板、异常通知、跨页跳转。
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
  const [theme, setTheme] = useState<ThemePref>(() => readStoredTheme())
  // 风格与折射是正交于明暗的两个维度：paper/glass、on/off
  const [style, setStyle] = useState<StylePref>(() => readStoredStyle())
  const [refract, setRefract] = useState<RefractPref>(() => readStoredRefract())
  // 壁纸地址（空串 = 关）：只有玻璃风格下 CSS 才命中，暖纸下留着值也不影响视觉
  const [wallpaper, setWallpaper] = useState<string>(() => readStoredWallpaper())

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
    storePref(THEME_KEY, theme)
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => applyPref('theme', resolveTheme(theme, mql.matches))
    apply()
    mql.addEventListener('change', apply)
    return () => mql.removeEventListener('change', apply)
  }, [theme])

  // 风格与折射各自一条 effect：只写自己那一维的 dataset，互不牵连
  useEffect(() => {
    storePref(STYLE_KEY, style)
    applyPref('style', style)
  }, [style])

  useEffect(() => {
    storePref(REFRACT_KEY, refract)
    applyPref('glassRefract', refract)
  }, [refract])

  // 壁纸：开关写 dataset（给 CSS 判断），地址写 <html> 的 --wallpaper-url（给 background-image）
  useEffect(() => {
    storePref(WALLPAPER_KEY, wallpaper)
    applyPref('wallpaper', wallpaper ? 'on' : 'off')
    applyWallpaperVar(document, wallpaper)
  }, [wallpaper])

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
    style, setStyle,
    refract, setRefract,
    wallpaper, setWallpaper,
    openAsset, openMonitor,
  }
}

export type ShellState = ReturnType<typeof useShell>
