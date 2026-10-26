import { NotesPage } from './pages/NotesPage'
import { MailPage } from './pages/MailPage'
import { AssetsPage } from './pages/AssetsPage'
import { MonitorsPage } from './pages/MonitorsPage'
import { HostsPage } from './pages/HostsPage'
import { ServicesPage } from './pages/ServicesPage'
import { BackupPage } from './pages/BackupPage'
import { SettingsPage } from './pages/SettingsPage'
import { CommandPalette } from './components/CommandPalette'
import { AlertStack } from './components/AlertStack'
import { Sidebar } from './app/Sidebar'
import { Topbar } from './app/Topbar'
import { useShell } from './app/useShell'
import { Spinner } from './components/ui'

// 组合层：外壳状态在 useShell，侧栏与顶栏是纯展示，页面按 URL 选。
export function App() {
  const s = useShell()
  // 主题生效后由 useShell 的 effect 写到 <html data-theme>，这里只读一次决定图标
  const dark = document.documentElement.dataset.theme === 'dark'

  return (
    <div className="app">
      <Sidebar
        page={s.page}
        setPage={s.setPage}
        stats={s.stats}
        mailSum={s.mailSum}
        mon={s.mon}
        host={s.host}
        dark={dark}
        onToggleTheme={() => s.setTheme(dark ? 'light' : 'dark')}
      />

      <div className="main">
        <Topbar
          page={s.page}
          stats={s.stats}
          mailSum={s.mailSum}
          mon={s.mon}
          host={s.host}
          onOpenPalette={() => s.setPaletteOpen(true)}
        />

        <div className="content">
          {s.error ? <div className="alert" style={{ margin: '0 0 14px' }}>接口出错：{s.error}</div> : null}
          {!s.ready ? (
            <div className="empty"><Spinner /></div>
          ) : s.page === 'notes' ? (
            <NotesPage tags={s.tags} refreshMeta={s.refreshMeta} onOpenAsset={s.openAsset} archivedCount={s.stats?.archived ?? 0} />
          ) : s.page === 'mail' ? (
            <MailPage onSummary={s.setMailSum} />
          ) : s.page === 'assets' ? (
            <AssetsPage
              tags={s.tags}
              fields={s.fields}
              stats={s.stats}
              refreshMeta={s.refreshMeta}
              openAssetId={s.openAssetId}
              setOpenAssetId={s.setOpenAssetId}
            />
          ) : s.page === 'monitors' ? (
            <MonitorsPage onSummary={s.setMon} focusId={s.focusMonitorId} onFocusDone={() => s.setFocusMonitorId(null)} />
          ) : s.page === 'hosts' ? (
            <HostsPage onSummary={s.setHost} />
          ) : s.page === 'services' ? (
            <ServicesPage onOpenMonitor={s.openMonitor} />
          ) : s.page === 'settings' ? (
            <SettingsPage tags={s.tags} fields={s.fields} stats={s.stats} refreshMeta={s.refreshMeta} theme={s.theme} setTheme={s.setTheme} />
          ) : (
            <BackupPage />
          )}
        </div>
      </div>

      <AlertStack alerts={s.monitorAlerts} onDismiss={s.dismissAlert} onOpen={s.openMonitor} />

      <CommandPalette
        open={s.paletteOpen}
        onClose={() => s.setPaletteOpen(false)}
        onNavigate={(p) => s.setPage(p)}
        onOpenAsset={(id) => { s.setPage('assets'); s.setOpenAssetId(id) }}
      />
    </div>
  )
}

export default App
