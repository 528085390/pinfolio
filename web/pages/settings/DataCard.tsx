import { Database, Download, Sparkles } from 'lucide-react'
import { Button, Spinner } from '../../components/ui'
import { t } from '../../lib/i18n'
import type { SettingsState } from './useSettings'

export function DataCard({ s, empty }: { s: SettingsState; empty: boolean }) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="section-title" style={{ marginTop: 0 }}><Database size={12} /> {t('数据')}</div>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
        {t('数据保存在本机 data/pinboard.db（SQLite），不联网、无第三方账号。建议定期导出 JSON 备份。')}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <Button size="sm" onClick={s.exportData} disabled={s.busy === 'export'}>
          {s.busy === 'export' ? <Spinner /> : <Download size={14} />} {t('导出 JSON')}
        </Button>
        {empty ? (
          <Button size="sm" variant="ghost" onClick={s.seed} disabled={s.busy === 'seed'}>
            {s.busy === 'seed' ? <Spinner /> : <Sparkles size={14} />} {t('写入示例数据')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
