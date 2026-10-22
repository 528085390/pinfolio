import { useEffect, useState } from 'react'
import { Check, Copy, RefreshCw } from 'lucide-react'
import { Button, Modal, Spinner } from '../../components/ui'
import { api, type HostOnboard, type HostsPayload } from '../../lib/api'
import { ago } from './HostCard'

// 「接入这台机器」：一条装好采集端的命令 + 等第一帧。
// 命令里带采集 token，所以只能单独拉 /hosts/:id/onboard，不能塞进列表接口。
export function OnboardModal({ hostId, onClose, onRefreshed }: {
  hostId: string | null
  onClose: () => void
  /** 「立即检查」拉到新数据时把整页快照换掉，卡片不用等 60 秒轮询 */
  onRefreshed?: (p: HostsPayload) => void
}) {
  const [data, setData] = useState<HostOnboard | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = async (id: string) => {
    try {
      setData(await api.hosts.onboard(id))
    } catch (e: any) {
      setErr(String(e?.message || e))
    }
  }

  useEffect(() => {
    setData(null)
    setErr('')
    setCopied(false)
    if (hostId) void load(hostId)
  }, [hostId])

  const copy = async () => {
    if (!data) return
    try {
      await navigator.clipboard.writeText(data.command)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setErr('复制失败，手动选中上面的命令复制')
    }
  }

  const check = async () => {
    if (!hostId || busy) return
    setBusy(true)
    setErr('')
    try {
      onRefreshed?.(await api.hosts.refresh())
      await load(hostId)
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={!!hostId}
      onClose={onClose}
      title="接入这台机器"
      width={620}
      footer={<><span className="grow" /><Button variant="ghost" onClick={onClose}>关闭</Button></>}
    >
      {err ? <div className="alert">{err}</div> : null}
      {!data ? (
        <div className="empty"><Spinner /></div>
      ) : (
        <>
          <p className="host-onboard-lead">
            在 <b>{data.label || data.hostId}</b> 上以 root 跑这一条：下载安装器 → 写 /etc/node-metrics.conf → 装 timer → 立刻上报第一帧。
          </p>
          <pre className="host-cmd">{data.command}</pre>
          <div className="host-onboard-row">
            <Button size="sm" onClick={copy}>
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? '已复制' : '复制命令'}
            </Button>
            <Button size="sm" onClick={check} disabled={busy}>
              <RefreshCw size={14} /> 立即检查
            </Button>
          </div>
          <div className={'host-onboard-state' + (data.ready ? ' is-ok' : '')}>
            {data.ready && data.firstSampleAt
              ? '已收到首帧：' + new Date(data.firstSampleAt).toLocaleString('zh-CN') + '（' + ago(data.staleSec) + '）'
              : '还在等第一帧——装完 timer 会立刻跑一次，之后每 5 分钟一次'}
          </div>
          <div className="host-form-tip">
            命令里带着采集 token（只在这个弹窗出现，不进列表接口、不进 SNAPSHOT）。
            服务清单 {data.units.length ? data.units.join(' ') : '（空）'}；磁盘 {data.disks.join(' ') || '/'}。
            这台机没装 SSH 时，也可以在本地直接跑 <code>bash tools/node-metrics/install.sh &lt;地址&gt; {data.hostId}</code>。
          </div>
        </>
      )}
    </Modal>
  )
}
