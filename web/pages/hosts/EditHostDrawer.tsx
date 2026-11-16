import { useEffect, useState } from 'react'
import { FormDrawer } from '../../components/FormDrawer'
import { Field } from '../../components/ui'
import { api, type Host, type HostsPayload } from '../../lib/api'
import { t } from '../../lib/i18n'

/** 编辑主机元信息：显示名 / 备注 / 到期日 / 地址。采集参数（units / disks）不在这里改，
 *  它们决定安装命令，改了必须重装采集端，留在「接入」流程里。 */
export function EditHostDrawer({ host, onClose, onSaved }: {
  host: Host | null
  onClose: () => void
  onSaved: (p: HostsPayload) => void
}) {
  const [label, setLabel] = useState('')
  const [note, setNote] = useState('')
  const [expires, setExpires] = useState('')
  const [address, setAddress] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!host) return
    setLabel(host.label || '')
    setNote(host.note || '')
    setExpires(host.expires || '')
    setAddress(host.address || '')
    setErr('')
  }, [host])

  const close = () => { if (!saving) onClose() }
  const save = async () => {
    if (!host || saving) return
    setSaving(true)
    setErr('')
    try {
      const next = await api.hosts.patch(host.id, {
        label: label.trim(),
        note: note.trim(),
        expires: expires.trim(),
        address: address.trim(),
      })
      onSaved(next)
      onClose()
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormDrawer
      open={Boolean(host)}
      onClose={close}
      title={host ? t('编辑 {name}', { name: host.label || host.id }) : t('编辑主机')}
      error={err}
      onSave={save}
      saving={saving}
      size="sm"
    >
      <div className="form-grid">
        <Field label={t('显示名')} span={2} hint={t('留空就用主机 id')}>
          <input className="input" value={label} placeholder={host?.id || ''} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label={t('备注')} span={2} hint={t('用来识别厂商和区域，例如「Oracle · 东京 · 1C1G」')}>
          <input className="input" value={note} placeholder={t('Oracle · 东京')} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field label={t('到期日')} hint={t('可选，显示在卡片底部')}>
          <input className="input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
        <Field label={t('地址')} hint={t('IP 或域名，显示在卡片抬头')}>
          <input className="input" value={address} placeholder="203.0.113.11" onChange={(e) => setAddress(e.target.value)} />
        </Field>
      </div>
    </FormDrawer>
  )
}
