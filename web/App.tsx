import { Suspense, lazy } from 'react'
import { NotesPage } from './pages/NotesPage'
import { AssetsPage } from './pages/AssetsPage'
import { MonitorsPage } from './pages/MonitorsPage'
import { HostsPage } from './pages/HostsPage'
import { SettingsPage } from './pages/SettingsPage'
import { CommandPalette } from './components/CommandPalette'
import { AlertStack } from './components/AlertStack'
import { GlassDefs } from './components/GlassDefs'
import { DemoBanner } from './components/DemoBanner'
import { Sidebar } from './app/Sidebar'
import { Topbar } from './app/Topbar'
import { useShell } from './app/useShell'
import { Spinner } from './components/ui'
import { t, useLocale } from './lib/i18n'

const MailPage = lazy(() => import('./pages/MailPage').then((m) => ({ default: m.MailPage })))
const ServicesPage = lazy(() => import('./pages/ServicesPage').then((m) => ({ default: m.ServicesPage })))
const BackupPage = lazy(() => import('./pages/BackupPage').then((m) => ({ default: m.BackupPage })))

// 组合层：外壳状态在 useShell，侧栏与顶栏是纯展示，页面按 URL 选。
export function App() {
  const s = useShell()
  // 语言切换的唯一订阅点：这里重渲染 → 整棵树跟着换文案（子组件不用各自订阅）
  useLocale()
  // 主题生效后由 useShell 的 effect 写到 <html data-theme>，这里只读一次决定图标
  const dark = document.documentElement.dataset.theme === 'dark'

  return (
    <div className="app">
      {/* 折射滤镜定义：0×0 的 SVG，absolute 定位，不参与布局；只渲染一次，不随状态重渲染 */}
      <GlassDefs />

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
        {/* 演示站横幅：普通实例 useDemo() 是 null，不渲染也不占高度 */}
        <DemoBanner />
        <Topbar
          page={s.page}
          stats={s.stats}
          mailSum={s.mailSum}
          mon={s.mon}
          host={s.host}
          onOpenPalette={() => s.setPaletteOpen(true)}
        />

        <div className="content">
          {s.error ? <div className="alert" style={{ margin: '0 0 14px' }}>{t('接口出错：{msg}', { msg: s.error })}</div> : null}
          {!s.ready ? (
            <div className="empty"><Spinner /></div>
          ) : (
            <Suspense fallback={<div className="empty"><Spinner /></div>}>
              {s.page === 'notes' ? (
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
            <MonitorsPage onSummary={s.setMon} focusId={s.focusMonitorId} onFocusDone={() => s.setFocusMonitorId(null)} onOpenAsset={s.openAsset} />
          ) : s.page === 'hosts' ? (
            <HostsPage onSummary={s.setHost} onOpenAsset={s.openAsset} />
          ) : s.page === 'services' ? (
            <ServicesPage onOpenMonitor={s.openMonitor} />
          ) : s.page === 'settings' ? (
            <SettingsPage
              tags={s.tags}
              fields={s.fields}
              stats={s.stats}
              refreshMeta={s.refreshMeta}
              theme={s.theme}
              setTheme={s.setTheme}
              style={s.style}
              setStyle={s.setStyle}
              refract={s.refract}
              setRefract={s.setRefract}
              wallpaper={s.wallpaper}
              setWallpaper={s.setWallpaper}
            />
          ) : (
            <BackupPage />
          )}
            </Suspense>
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
