import { Activity } from 'lucide-react'
import type { MonitorSummary } from '../lib/api'
import { Button, Empty, Spinner } from '../components/ui'
import { MonitorDrawer } from '../components/MonitorDrawer'
import { useMonitors } from './monitors/useMonitors'
import { MonitorStats } from './monitors/MonitorStats'
import { MonitorFilters } from './monitors/MonitorFilters'
import { MonitorCard } from './monitors/MonitorCard'
import { MonitorTable } from './monitors/MonitorTable'
import { QuickLinks } from './monitors/QuickLinks'
import { KumaGuide } from './monitors/KumaGuide'
import { t } from '../lib/i18n'

export function MonitorsPage({
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
  const M = useMonitors({ onSummary, focusId, onFocusDone })

  // 没配 Kuma（没给 KUMA_URL 也没有口令）：观测页只给引导卡，不摆统计条和筛选条——
  // 那些都是「有数据」才成立的东西，空着会让人以为坏了。其余七页不受影响。
  if (M.meta && !M.meta.configured) {
    return (
      <div className="page page-wide page-monitors">
        <KumaGuide url={M.meta.url} />
      </div>
    )
  }

  return (
    <div className="page page-wide page-monitors">
      <MonitorStats summary={M.summary} />

      <MonitorFilters
        groups={M.groups}
        group={M.group}
        onGroup={M.setGroup}
        allCount={M.all.length}
        status={M.status}
        onStatus={M.setStatus}
        searchInput={M.searchInput}
        onSearchInput={M.setSearchInput}
        auto={M.auto}
        onToggleAuto={() => M.setAuto((v) => !v)}
        view={M.view}
        onView={M.setView}
        loading={M.loading}
        onRefresh={() => M.load(true)}
        updatedAt={M.data?.updatedAt}
      />

      {M.error && M.data ? <div className="alert" style={{ marginTop: 14 }}>{M.error}</div> : null}

      <QuickLinks links={M.data?.quick ?? []} />

      {M.loading && !M.data ? (
        <div className="empty"><Spinner /></div>
      ) : !M.data ? (
        <Empty
          icon={<Activity size={22} />}
          title={t('读不到观测项')}
          text={M.error || t('Uptime Kuma 可能没在跑（默认 http://127.0.0.1:3001）。')}
          action={<Button size="sm" onClick={() => M.load(true)}>{t('重试')}</Button>}
        />
      ) : M.shown.length === 0 ? (
        <Empty
          icon={<Activity size={22} />}
          title={t('没有匹配的观测项')}
          text={t('换个筛选条件试试。')}
          action={<Button size="sm" onClick={M.clearFilters}>{t('清空筛选')}</Button>}
        />
      ) : M.view === 'grid' ? (
        <div className="asset-grid monitor-grid" style={{ marginTop: 14 }}>
          {M.shown.map((m) => <MonitorCard key={m.id} m={m} onOpen={() => M.setOpenId(m.id)} />)}
        </div>
      ) : (
        <MonitorTable shown={M.shown} onOpen={M.setOpenId} />
      )}

      <MonitorDrawer
        id={M.openId}
        flavor={M.meta?.flavor ?? 'fork'}
        onClose={() => M.setOpenId(null)}
        onChanged={() => M.load(true)}
      />
    </div>
  )
}
