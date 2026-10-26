import { useState } from 'react'
import { Plus, RefreshCw, Server } from 'lucide-react'
import { Button, Empty, Spinner } from '../components/ui'
import { api, type Host, type HostSummary, type HostsPayload } from '../lib/api'
import { useHosts } from './hosts/useHosts'
import { HostCard, ago } from './hosts/HostCard'
import { AddHostDrawer } from './hosts/AddHostDrawer'
import { DeleteHostModal } from './hosts/DeleteHostModal'
import { OnboardModal } from './hosts/OnboardModal'

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
      setOpErr('主机加好了，但观测项没建成：' + (next.provision.error || '未知错误'))
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
          <span className="host-sum-label">在线</span>
          {paused ? (
            <>
              <span className="host-sum-sep">·</span>
              <span className="host-sum-dim">{paused} 台已暂停</span>
            </>
          ) : null}
          <span className="host-sum-sep">·</span>
          <span className="host-sum-dim">每 5 分钟采集一次</span>
          {H.data?.polledAt ? (
            <>
              <span className="host-sum-sep">·</span>
              <span className="host-sum-dim">上次拉取 {ago(polledSec)}</span>
            </>
          ) : null}
          {H.data?.samples ? (
            <>
              <span className="host-sum-sep">·</span>
              <span className="host-sum-dim">{H.data.samples} 个样本</span>
            </>
          ) : null}
        </div>
        <div className="host-actions">
          <button
            className={'host-auto' + (H.auto ? ' is-on' : '')}
            onClick={() => H.setAuto((v) => !v)}
            title="每 60 秒自动刷新本页"
          >
            <span className="host-auto-dot" />
            自动刷新
          </button>
          <Button size="sm" onClick={() => H.load(true)} disabled={H.loading}>
            <RefreshCw size={14} /> 立即拉取
          </Button>
          <Button size="sm" variant="primary" onClick={() => setAddOpen(true)}>
            <Plus size={14} /> 添加主机
          </Button>
        </div>
      </div>

      {opErr ? <div className="alert" style={{ marginTop: 12 }}>{opErr}</div> : null}

      {pollFailed.length ? (
        <div className="alert" style={{ marginTop: 12 }}>
          有 {pollFailed.length} 台没拉到：{pollFailed.map((f) => f.id + '（' + f.error + '）').join('、')}
        </div>
      ) : null}

      {H.loading && !H.data ? (
        <div className="empty"><Spinner /></div>
      ) : H.error && !H.data ? (
        <Empty
          icon={<Server size={22} />}
          title="读不到主机指标"
          text={H.error}
          action={<Button size="sm" onClick={() => H.load(true)}>重试</Button>}
        />
      ) : hosts.length === 0 ? (
        <Empty
          icon={<Server size={22} />}
          title="还没有主机"
          text="点右上角「添加主机」加一台，采集脚本见 tools/node-metrics/。"
          action={<Button size="sm" variant="primary" onClick={() => setAddOpen(true)}><Plus size={14} /> 添加主机</Button>}
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
            setOpErr('主机删了，但观测项没删掉：' + next.monitorsFailed.join('、') + '（去观测台手动删）')
          }
        }}
      />
      <OnboardModal hostId={onboardId} onClose={() => setOnboardId(null)} onRefreshed={H.apply} />
    </div>
  )
}
