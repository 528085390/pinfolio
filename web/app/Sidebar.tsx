import { Activity, LogOut, Mail as MailIcon, Moon, Package, Pin, Server, Settings, StickyNote, Sun } from 'lucide-react'
import { cx, type HostSummary, type MonitorSummary, type Stats } from '../lib/api'
import { API_BASE } from '../lib/api/http'
import { Button } from '../components/ui'
import type { Page } from '../lib/router'
import type { MailSummary } from './titles'

export function Sidebar({ page, setPage, stats, mailSum, mon, host, dark, onToggleTheme }: {
  page: Page
  setPage: (p: Page) => void
  stats: Stats | null
  mailSum: MailSummary | null
  mon: MonitorSummary | null
  host: HostSummary | null
  dark: boolean
  onToggleTheme: () => void
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><Pin size={16} /></div>
        <div className="brand-text">
          <div className="brand-name">pinfolio</div>
          <div className="brand-sub">notes · assets · monitors</div>
        </div>
      </div>

      <nav className="nav">
        <button className={cx('nav-item', page === 'notes' && 'active')} onClick={() => setPage('notes')} title="便签">
          <StickyNote size={17} />
          <span className="nav-label">便签</span>
          <span className="nav-badge">{stats?.notes ?? ''}</span>
        </button>
        <button className={cx('nav-item', page === 'mail' && 'active')} onClick={() => setPage('mail')} title="邮件">
          <MailIcon size={17} />
          <span className="nav-label">邮件</span>
          <span className="nav-badge">{mailSum?.unseen || ''}</span>
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
        <button className={cx('nav-item', page === 'hosts' && 'active')} onClick={() => setPage('hosts')} title="主机指标">
          <Server size={17} />
          <span className="nav-label">主机</span>
          <span className="nav-badge">{host ? host.online + '/' + host.total : ''}</span>
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
          <Button variant="ghost" size="sm" icon title="切换深浅色" onClick={onToggleTheme}>
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon
            title="退出登录"
            onClick={async () => {
              await fetch(API_BASE + '/auth/logout', { method: 'POST' })
              location.reload()
            }}
          >
            <LogOut size={15} />
          </Button>
        </div>
      </div>
    </aside>
  )
}
