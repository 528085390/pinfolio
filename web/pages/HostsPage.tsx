import { useState } from 'react'
import { Plus, RefreshCw, Server } from 'lucide-react'
import { Button, Empty, Spinner } from '../components/ui'
import { api, type Host, type HostSummary, type HostsPayload } from '../lib/api'
import { useHosts } from './hosts/useHosts'
import { HostCard, ago } from './hosts/HostCard'
import { AddHostDrawer } from './hosts/AddHostDrawer'
import { DeleteHostModal } from './hosts/DeleteHostModal'
import { OnboardModal } from './hosts/OnboardModal'
import { t } from '../lib/i18n'

export function HostsPage({ onSummary }: {
  onSummary?: (s: HostSummary) => void
}) {
  const H = useHosts({ onSummary })
  const hosts = H.data?.hosts ?? []
  const online = H.summary.online
  const paused = H.summary.paused
  const pollFailed = H.data?.pollFailed ?? []
  const polledSec = H.data?.polledAt ? Math.max(0, (Date.now() - new Date(H.data.polledAt).getTime()) / 1000) : null

  const [addOpen, setAddOpen] = useState(false)
  const [delHost, setDelHost] = useState<Host | null>(null)
  const [busyId, setBusyId] = useState('')
  const [opErr, setOpErr] = useState('')
  const [onboardId, setOnboardId] = useState<string | null>(null)

  // 加完主机立刻弹接入指引；观测项没建成只提示，主机本身已经加好了
  const onAdded = (next: HostsPayload, id: string) => {
    H.apply(next)
    if (next.provision && !next.provision.ok) {
      setOpErr(t('主机加好了，但观测项没建成：{msg}', { msg: next.provision.error || t('未知错误') }))
    }
    setOnboardId(id)
  }

  const togglePause = async (h: Host) => {
    if (busyId) return
    setBusyId(h.id)
    setOpErr('')
    try {
      H.apply(await api.hosts.patch(h.id, { paused: !h.paused }))
    } catch (e: any) {
      setOpErr(String(e?.message || e))
    } finally {
      setBusyId('')
    }
  }

  return (
    <div className="page page-wide page-hosts">
      <div className="host-toolbar">
        <div className="host-sum">
          <span className="host-sum-num">{online}/{hosts.length}</span>
          <span className="host-sum-label">{t('在线')}</span>
          {paused ? (
            <>
              <span className="host-sum-sep">·</span>
              <span className="host-sum-dim">{t('{n} 台已暂停', { n: paused })}</span>
            </>
          ) : null}
          <span className="host-sum-sep">·</span>
          <span className="host-sum-dim">{t('每 5 分钟采集一次')}</span>
          {H.data?.polledAt ? (
            <>
              <span className="host-sum-sep">·</span>
              <span className="host-sum-dim">{t('上次拉取 {ago}', { ago: ago(polledSec) })}</span>
            </>
          ) : null}
          {H.data?.samples ? (
            <>
              <span className="host-sum-sep">·</span>
              <span className="host-sum-dim">{t('{n} 个样本', { n: H.data.samples })}</span>
            </>
          ) : null}
        </div>
        <div className="host-actions">
          <button
            className={'host-auto' + (H.auto ? ' is-on' : '')}
            onClick={() => H.setAuto((v) => !v)}
            title={t('每 60 秒自动刷新本页')}
          >
            <span className="host-auto-dot" />
            {t('自动刷新')}
          </button>
          <Button size="sm" onClick={() => H.load(true)} disabled={H.loading}>
            <RefreshCw size={14} /> {t('立即拉取')}
          </Button>
          <Button size="sm" variant="primary" onClick={() => setAddOpen(true)}>
            <Plus size={14} /> {t('添加主机')}
          </Button>
        </div>
      </div>

      {opErr ? <div className="alert" style={{ marginTop: 12 }}>{opErr}</div> : null}

      {pollFailed.length ? (
        <div className="alert" style={{ marginTop: 12 }}>
          {t('有 {n} 台没拉到：{list}', {
            n: pollFailed.length,
            list: pollFailed.map((f) => t('{id}（{error}）', { id: f.id, error: f.error })).join(t('、')),
          })}
        </div>
      ) : null}

      {H.loading && !H.data ? (
        <div className="empty"><Spinner /></div>
      ) : H.error && !H.data ? (
        <Empty
          icon={<Server size={22} />}
          title={t('读不到主机指标')}
          text={H.error}
          action={<Button size="sm" onClick={() => H.load(true)}>{t('重试')}</Button>}
        />
      ) : hosts.length === 0 ? (
        <Empty
          icon={<Server size={22} />}
          title={t('还没有主机')}
          text={t('点右上角「添加主机」加一台，采集脚本见 tools/node-metrics/。')}
          action={<Button size="sm" variant="primary" onClick={() => setAddOpen(true)}><Plus size={14} /> {t('添加主机')}</Button>}
        />
      ) : (
        <div className="host-grid">
          {hosts.map((h) => (
            <HostCard
              key={h.id}
              h={h}
              busy={busyId === h.id}
              onTogglePause={togglePause}
              onDelete={setDelHost}
              onOnboard={(h) => setOnboardId(h.id)}
            />
          ))}
        </div>
      )}

      <AddHostDrawer open={addOpen} onClose={() => setAddOpen(false)} onAdded={onAdded} />
      <DeleteHostModal
        host={delHost}
        onClose={() => setDelHost(null)}
        onDeleted={(next) => {
          H.apply(next)
          if (next.monitorsFailed?.length) {
            setOpErr(t('主机删了，但观测项没删掉：{list}（去观测台手动删）', { list: next.monitorsFailed.join(t('、')) }))
          }
        }}
      />
      <OnboardModal hostId={onboardId} onClose={() => setOnboardId(null)} onRefreshed={H.apply} />
    </div>
  )
}
