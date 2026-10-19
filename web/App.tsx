import { useCallback, useEffect, useState } from 'react'
import { StickyNote, Package, Settings, Command, Moon, Sun, Pin, Activity } from 'lucide-react'
import { api, cx, type FieldDef, type MonitorSummary, type Stats, type Tag } from './lib/api'
import { NotesPage } from './pages/NotesPage'
import { AssetsPage } from './pages/AssetsPage'
import { MonitorsPage } from './pages/MonitorsPage'
import { SettingsPage } from './pages/SettingsPage'
import { CommandPalette } from './components/CommandPalette'
import { Button, Spinner } from './components/ui'

type Page = 'notes' | 'assets' | 'monitors' | 'settings'

export function App() {
  const [page, setPage] = useState<Page>('notes')
  const [tags, setTags] = useState<Tag[]>([])
  const [fields, setFields] = useState<FieldDef[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [mon, setMon] = useState<MonitorSummary | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [openAssetId, setOpenAssetId] = useState<number | 'new' | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [theme, setTheme] = useState<string>(() => localStorage.getItem('pinboard-theme') || 'system')

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
    localStorage.setItem('pinboard-theme', theme)
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

  const title = page === 'notes' ? '便签' : page === 'assets' ? '资产台账' : page === 'monitors' ? '观测台' : '设置'
  const sub = page === 'notes'
    ? (stats ? stats.notes + ' 条便签' + (stats.archived ? ' · ' + stats.archived + ' 条归档' : '') : '')
    : page === 'assets'
      ? (stats ? stats.assets + ' 件资产 · ' + stats.active + ' 件在用' : '')
      : page === 'monitors'
        ? (mon
          ? mon.up + '/' + mon.total + ' 正常'
            + (mon.down ? ' · ' + mon.down + ' 异常' : '')
            + (mon.uptime24 !== null ? ' · 24h ' + (mon.uptime24 * 100).toFixed(1) + '%' : '')
          : 'Kuma 探测后端 · 每 30 秒刷新')
        : '字段、标签、备份'

  const dark = document.documentElement.dataset.theme === 'dark'

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Pin size={16} /></div>
          <div className="brand-text">
            <div className="brand-name">便签夹</div>
            <div className="brand-sub">notes &amp; assets</div>
          </div>
        </div>

        <nav className="nav">
          <button className={cx('nav-item', page === 'notes' && 'active')} onClick={() => setPage('notes')} title="便签">
            <StickyNote size={17} />
            <span className="nav-label">便签</span>
            <span className="nav-badge">{stats?.notes ?? ''}</span>
          </button>
          <button className={cx('nav-item', page === 'assets' && 'active')} onClick={() => setPage('assets')} title="资产台账">
            <Package size={17} />
            <span className="nav-label">资产</span>
            <span className="nav-badge">{stats?.assets ?? ''}</span>
          </button>
          <button className={cx('nav-item', page === 'monitors' && 'active')} onClick={() => setPage('monitors')} title="观测台">
            <Activity size={17} />
            <span className="nav-label">观测</span>
            <span className="nav-badge">{mon ? mon.up + '/' + mon.total : ''}</span>
          </button>
          <button className={cx('nav-item', page === 'settings' && 'active')} onClick={() => setPage('settings')} title="设置">
            <Settings size={17} />
            <span className="nav-label">设置</span>
          </button>
        </nav>

        <div className="grow" />

        <div className="sidebar-foot">
          <div className="side-stat" title="SQLite: data/pinboard.db">数据只存在本机</div>
          <div className="side-actions">
            <Button variant="ghost" size="sm" icon title="切换深浅色" onClick={() => setTheme(dark ? 'light' : 'dark')}>
              {dark ? <Sun size={15} /> : <Moon size={15} />}
            </Button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div style={{ minWidth: 0 }}>
            <div className="topbar-title">{title}</div>
            <div className="topbar-sub">{sub}</div>
          </div>
          <div className="topbar-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setPaletteOpen(true)} title="快速搜索 / 命令">
              <Command size={14} />
              <span className="kbd">Ctrl K</span>
            </button>
          </div>
        </header>

        <div className="content">
          {error ? <div className="alert" style={{ margin: '0 0 14px' }}>接口出错：{error}</div> : null}
          {!ready ? (
            <div className="empty"><Spinner /></div>
          ) : page === 'notes' ? (
            <NotesPage tags={tags} refreshMeta={refreshMeta} onOpenAsset={openAsset} archivedCount={stats?.archived ?? 0} />
          ) : page === 'assets' ? (
            <AssetsPage
              tags={tags}
              fields={fields}
              stats={stats}
              refreshMeta={refreshMeta}
              openAssetId={openAssetId}
              setOpenAssetId={setOpenAssetId}
            />
          ) : page === 'monitors' ? (
            <MonitorsPage onSummary={setMon} />
          ) : (
            <SettingsPage tags={tags} fields={fields} stats={stats} refreshMeta={refreshMeta} theme={theme} setTheme={setTheme} />
          )}
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={(p) => setPage(p)}
        onOpenAsset={(id) => { setPage('assets'); setOpenAssetId(id) }}
      />
    </div>
  )
}

export default App
