import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, Field, Modal } from '../../components/ui'
import { api, type Host, type HostsPayload } from '../../lib/api'

/** 删除主机：手输 id 才让删（和观测台删除一个规矩），可选连历史样本一起清掉。 */
export function DeleteHostModal({ host, onClose, onDeleted }: {
  host: Host | null
  onClose: () => void
  onDeleted: (p: HostsPayload) => void
}) {
  const [name, setName] = useState('')
  const [purge, setPurge] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // 换一台机就把输入清空，免得手输的 id 残留到下一次删除
  useEffect(() => { setName(''); setPurge(true); setErr('') }, [host?.id])

  if (!host) return null
  const ok = name.trim().toLowerCase() === host.id.toLowerCase()

  const remove = async () => {
    if (!ok || busy) return
    setBusy(true)
    setErr('')
    try {
      const next = await api.hosts.remove(host.id, { purge })
      onDeleted(next)
      onClose()
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="删除主机"
      width={430}
      footer={(
        <>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>取消</Button>
          <span className="grow" />
          <Button variant="danger" size="sm" disabled={!ok || busy} onClick={remove}>
            <Trash2 size={14} /> {busy ? '删除中…' : '确认删除'}
          </Button>
        </>
      )}
    >
      <div className="host-del-text">
        从主机页移除「{host.label}」（{host.id}）。这只改本地的 <code>data/metrics.json</code>，
        服务器上的采集端不受影响 —— 要彻底停采集得去那台机 disable 掉 timer。
      </div>
      <Field label={'把主机 id 原样输一遍：' + host.id}>
        <input className="input" autoFocus value={name} placeholder="在这里输入 id" onChange={(e) => setName(e.target.value)} />
      </Field>
      <label className="host-del-check">
        <input type="checkbox" checked={purge} onChange={(e) => setPurge(e.target.checked)} />
        同时删掉历史样本（30 天曲线），以及加主机时顺带建的观测项
      </label>
      {err ? <div className="alert" style={{ marginTop: 10 }}>{err}</div> : null}
    </Modal>
  )
}
