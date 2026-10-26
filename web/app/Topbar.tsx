import { Command } from 'lucide-react'
import type { HostSummary, MonitorSummary, Stats } from '../lib/api'
import type { Page } from '../lib/router'
import { t } from '../lib/i18n'
import { pageSubtitle, pageTitle, type MailSummary } from './titles'

export function Topbar({ page, stats, mailSum, mon, host, onOpenPalette }: {
  page: Page
  stats: Stats | null
  mailSum: MailSummary | null
  mon: MonitorSummary | null
  host: HostSummary | null
  onOpenPalette: () => void
}) {
  return (
    <header className="topbar">
      <div style={{ minWidth: 0 }}>
        <div className="topbar-title">{pageTitle(page)}</div>
        <div className="topbar-sub">{pageSubtitle(page, { stats, mailSum, mon, host })}</div>
      </div>
      <div className="topbar-actions">
        <button className="btn btn-ghost btn-sm" onClick={onOpenPalette} title={t('快速搜索 / 命令')}>
          <Command size={14} />
          <span className="kbd">Ctrl K</span>
        </button>
      </div>
    </header>
  )
}
