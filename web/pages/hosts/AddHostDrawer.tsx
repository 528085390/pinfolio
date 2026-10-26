import { useState } from 'react'
import { FormDrawer } from '../../components/FormDrawer'
import { Field } from '../../components/ui'
import { api, type HostInput, type HostsPayload } from '../../lib/api'
import { t } from '../../lib/i18n'

// 添加主机分三段：基本信息（写 data/metrics.json）、采集端（装到那台机上的参数）、
// 观测项（顺带在 Kuma 里建，失败不影响主机本身）。
// 服务清单既决定卡片上的 chip，也决定「systemd 探测」建哪几个——一台机的服务是同一批。
export function AddHostDrawer({ open, onClose, onAdded }: {
  open: boolean
  onClose: () => void
  onAdded: (p: HostsPayload, id: string) => void
}) {
  const [id, setId] = useState('')
  const [label, setLabel] = useState('')
  const [note, setNote] = useState('')
  const [units, setUnits] = useState('')
  const [disks, setDisks] = useState('/')
  const [address, setAddress] = useState('')
  const [wantPort, setWantPort] = useState(false)
  const [port, setPort] = useState('443')
  const [wantHttp, setWantHttp] = useState(false)
  const [url, setUrl] = useState('')
  const [keyword, setKeyword] = useState('')
  const [wantSsh, setWantSsh] = useState(false)
  const [sshUser, setSshUser] = useState('')
  const [keyPath, setKeyPath] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  const reset = () => {
    setId(''); setLabel(''); setNote(''); setUnits(''); setDisks('/'); setAddress('')
    setWantPort(false); setPort('443'); setWantHttp(false); setUrl(''); setKeyword('')
    setWantSsh(false); setSshUser(''); setKeyPath(''); setErr('')
  }
  const close = () => { if (saving) return; reset(); onClose() }

  const serviceUnits = () => units.split(/[\s,]+/).map((u) => u.trim()).filter(Boolean)

  const save = async () => {
    if (!id.trim() || saving) return
    if (wantSsh && serviceUnits().length === 0) {
      setErr(t('systemd 探测要在「服务清单」里填 unit（探测的就是这些服务）'))
      return
    }
    if ((wantPort || wantHttp || wantSsh) && !address.trim()) {
      setErr(t('建观测项要填主机地址（IP 或域名）'))
      return
    }
    setSaving(true)
    setErr('')
    const body: HostInput = {
      id: id.trim(),
      label: label.trim(),
      note: note.trim(),
      units: units.trim(),
      disks: disks.trim(),
      address: address.trim(),
    }
    if (wantPort) body.port = Number(port)
    if (wantHttp && url.trim()) body.http = { url: url.trim(), keyword: keyword.trim() }
    if (wantSsh) body.services = serviceUnits().map((unit) => ({ unit, user: sshUser.trim(), keyPath: keyPath.trim() }))
    try {
      const next = await api.hosts.add(body)
      const newId = id.trim()
      onAdded(next, newId)
      reset()
      onClose()
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormDrawer
      open={open}
      onClose={close}
      title={t('添加主机')}
      error={err}
      onSave={save}
      saving={saving}
      saveDisabled={!id.trim()}
      size="md"
    >
      <div className="form-grid">
        <Field
          label={t('主机 id')}
          span={2}
          hint={t('采集端的 HOST_ID，上报文件名就是 <id>.json；只能用字母、数字、点、下划线、短横线')}
        >
          <input className="input" value={id} autoFocus placeholder={t('例如 os2')} onChange={(e) => setId(e.target.value)} />
        </Field>
        <Field label={t('显示名')} hint={t('留空就用 id；建议写成「机器 (厂商 · 区域)」')}>
          <input className="input" value={label} placeholder={id || t('例如 os2 (Oracle · 东京)')} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label={t('备注')} hint={t('显示在名字后面')}>
          <input className="input" value={note} placeholder={t('例如 东京 · 1C1G')} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>

      <div className="host-section">
        <div className="host-section-head">{t('采集端')}<span>{t('装到那台机上的参数，决定卡片显示什么')}</span></div>
        <div className="form-grid">
          <Field label={t('服务清单')} span={2} hint={t('空格分隔，卡片上的服务 chip 就是它们；例如 nginx app-api')}>
            <input className="input" value={units} placeholder={t('留空就只报 CPU / 内存 / 磁盘')} onChange={(e) => setUnits(e.target.value)} />
          </Field>
          <Field label={t('磁盘路径')} hint={t('空格分隔，默认 /')}>
            <input className="input" value={disks} placeholder="/" onChange={(e) => setDisks(e.target.value)} />
          </Field>
          <Field label={t('地址')} hint={t('IP 或域名，建观测项用；采集端不需要它')}>
            <input className="input" value={address} placeholder={t('例如 203.0.113.11')} onChange={(e) => setAddress(e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="host-section">
        <div className="host-section-head">{t('观测项')}<span>{t('顺带在观测台建，建不成不影响主机')}</span></div>

        <label className="host-check">
          <input type="checkbox" checked={wantPort} onChange={(e) => setWantPort(e.target.checked)} />
          {t('端口探测（只做 TCP 握手，Reality / hy2 这类不回普通 TLS 的也能探）')}
        </label>
        {wantPort ? (
          <div className="host-check-body">
            <input className="input input-sm" value={port} inputMode="numeric" onChange={(e) => setPort(e.target.value)} placeholder="443" />
            <span className="host-check-hint">{t('端口')}</span>
          </div>
        ) : null}

        <label className="host-check">
          <input type="checkbox" checked={wantHttp} onChange={(e) => setWantHttp(e.target.checked)} />
          {t('HTTP 站点（返回 2xx 才算正常，可要求页面里含某个词）')}
        </label>
        {wantHttp ? (
          <div className="host-check-body">
            <input className="input input-sm host-check-url" value={url} placeholder="https://example.com/" onChange={(e) => setUrl(e.target.value)} />
            <input className="input input-sm" value={keyword} placeholder={t('关键字（可空）')} onChange={(e) => setKeyword(e.target.value)} />
          </div>
        ) : null}

        <label className="host-check">
          <input type="checkbox" checked={wantSsh} onChange={(e) => setWantSsh(e.target.checked)} />
          {t('systemd 服务（给「服务清单」里每个 unit 建一项，走 SSH 跑 systemctl is-active）')}
        </label>
        {wantSsh ? (
          <div className="host-check-body is-col">
            <input className="input input-sm" value={sshUser} placeholder={t('SSH 用户名，例如 ubuntu')} onChange={(e) => setSshUser(e.target.value)} />
            <input className="input input-sm" value={keyPath} placeholder={t('私钥路径，例如 ~/.ssh/id_ed25519')} onChange={(e) => setKeyPath(e.target.value)} />
            <span className="host-check-hint">{t('私钥只在本机读，随观测项存进 Kuma（与现有 6 台一致）')}</span>
          </div>
        ) : null}
      </div>

      <div className="host-form-tip">
        {t('加完会弹出「接入这台机器」：一条命令装好采集端（下载安装器 + timer），装完立刻上报第一帧。')}
      </div>
    </FormDrawer>
  )
}
