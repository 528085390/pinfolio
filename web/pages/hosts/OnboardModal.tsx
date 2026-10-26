import { useEffect, useState } from 'react'
import { Check, Copy, RefreshCw } from 'lucide-react'
import { Button, Modal, Spinner } from '../../components/ui'
import { api, type HostOnboard, type HostsPayload } from '../../lib/api'
import { localeTag, t } from '../../lib/i18n'
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
      setErr(t('复制失败，手动选中上面的命令复制'))
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
      title={t('接入这台机器')}
      width={620}
      footer={<><span className="grow" /><Button variant="ghost" onClick={onClose}>{t('关闭')}</Button></>}
    >
      {err ? <div className="alert">{err}</div> : null}
      {!data ? (
        <div className="empty"><Spinner /></div>
      ) : (
        <>
          <p className="host-onboard-lead">
            {t('在')} <b>{data.label || data.hostId}</b> {t('上以 root 跑这一条：下载安装器 → 写 /etc/node-metrics.conf → 装 timer → 立刻上报第一帧。')}
          </p>
          <pre className="host-cmd">{data.command}</pre>
          <div className="host-onboard-row">
            <Button size="sm" onClick={copy}>
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? t('已复制') : t('复制命令')}
            </Button>
            <Button size="sm" onClick={check} disabled={busy}>
              <RefreshCw size={14} /> {t('立即检查')}
            </Button>
          </div>
          <div className={'host-onboard-state' + (data.ready ? ' is-ok' : '')}>
            {data.ready && data.firstSampleAt
              ? t('已收到首帧：{time}（{ago}）', {
                time: new Date(data.firstSampleAt).toLocaleString(localeTag()),
                ago: ago(data.staleSec),
              })
              : t('还在等第一帧——装完 timer 会立刻跑一次，之后每 5 分钟一次')}
          </div>
          <div className="host-form-tip">
            {t('命令里带着采集 token（只在这个弹窗出现，不进列表接口、不进 SNAPSHOT）。')}
            {t('服务清单 {units}；磁盘 {disks}。', {
              units: data.units.length ? data.units.join(' ') : t('（空）'),
              disks: data.disks.join(' ') || '/',
            })}
            {t('这台机没装 SSH 时，也可以在本地直接跑')} <code>bash tools/node-metrics/install.sh {t('<地址>')} {data.hostId}</code>{t('。')}
          </div>
        </>
      )}
    </Modal>
  )
}
