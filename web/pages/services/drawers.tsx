import { useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { FormDrawer } from '../../components/FormDrawer'
import { Button, Field, Modal, Spinner } from '../../components/ui'
import { cx } from '../../lib/cx'
import {
  api,
  type DeployInput,
  type DeployKind,
  type DeployRec,
  type ServerInput,
  type ServerRec,
  type ServiceInput,
  type ServiceRec,
  type ServicesPayload,
} from '../../lib/api'
import { t } from '../../lib/i18n'
import { KIND_LABEL, KIND_ORDER, listJoin } from './model'

/** 观测项下拉的一项：id + 名字 */
export type MonitorChoice = { id: number; name: string }

/**
 * 观测项选项：先用 data/services.json 自己的 monitors 表（24 条名字都在里面），
 * 打开抽屉时顺手问一次 Kuma，把表里没有的补上；Kuma 没起也不影响编辑（就用表里的）。
 * 这一页仍然「不观测」——问名字只是为了下拉框好看，不产生任何探测。
 */
export function useMonitorChoices(table: Record<string, string> | undefined, open: boolean): MonitorChoice[] {
  const [remote, setRemote] = useState<MonitorChoice[] | null>(null)
  useEffect(() => {
    if (!open || remote) return
    let alive = true
    api.monitors
      .get()
      .then((p) => {
        if (!alive) return
        const list = (p.groups ?? []).flatMap((g) => (g.monitors ?? []).map((m) => ({ id: m.id, name: m.name })))
        setRemote(list)
      })
      .catch(() => {
        if (alive) setRemote([])
      })
    return () => {
      alive = false
    }
  }, [open, remote])

  return useMemo(() => {
    const map = new Map<number, string>()
    for (const [k, v] of Object.entries(table || {})) {
      const n = Number(k)
      if (Number.isInteger(n) && n > 0 && v) map.set(n, v)
    }
    for (const m of remote ?? []) if (!map.has(m.id)) map.set(m.id, m.name)
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([id, name]) => ({ id, name }))
  }, [table, remote])
}

/** 选中项的名字表：提交时一起带上，服务端写进文件的 monitors 表 */
export function namesOf(ids: number[], choices: MonitorChoice[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const id of ids) {
    const hit = choices.find((c) => c.id === id)
    if (hit) out[String(id)] = hit.name
  }
  return out
}

/** 观测项多选：一排可点的标签 + 一个「其它 id」输入框（表里没有的也能填） */
export function MonitorPicker({ value, onChange, choices }: {
  value: number[]
  onChange: (next: number[]) => void
  choices: MonitorChoice[]
}) {
  const [draft, setDraft] = useState('')
  const toggle = (id: number) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id].sort((a, b) => a - b))
  const addDraft = () => {
    const n = Number(draft.trim())
    if (!Number.isInteger(n) || n <= 0) return
    if (!value.includes(n)) onChange([...value, n].sort((a, b) => a - b))
    setDraft('')
  }
  return (
    <div className="svc-pick">
      <div className="svc-pick-list">
        {choices.length === 0 ? <span className="field-hint">{t('还没登记过观测项，可以直接填 id')}</span> : null}
        {choices.map((c) => (
          <button
            key={c.id}
            type="button"
            className={cx('svc-pick-chip', value.includes(c.id) && 'is-on')}
            title={'#' + c.id + ' ' + c.name}
            onClick={() => toggle(c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>
      <div className="svc-pick-add">
        <input
          className="input input-sm"
          value={draft}
          inputMode="numeric"
          placeholder={t('其它观测项 id')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addDraft()
            }
          }}
        />
        <Button size="sm" onClick={addDraft}>{t('加上')}</Button>
        {value.length ? <span className="svc-pick-sum">{t('已选 {list}', { list: listJoin(value) })}</span> : null}
      </div>
    </div>
  )
}

function useSaving(onSaved: (p: ServicesPayload) => void, onClose: () => void) {
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const run = async (fn: () => Promise<ServicesPayload>) => {
    if (saving) return
    setSaving(true)
    setErr('')
    try {
      const next = await fn()
      onSaved(next)
      onClose()
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }
  return { saving, err, setErr, run }
}

// ---------- 服务器 ----------

export function ServerDrawer({ open, editing, monitors, onClose, onSaved }: {
  open: boolean
  /** null = 新加一台 */
  editing: ServerRec | null
  /** 文件里的 monitors 表（下拉框的兜底名字） */
  monitors: Record<string, string> | undefined
  onClose: () => void
  onSaved: (p: ServicesPayload) => void
}) {
  const choices = useMonitorChoices(monitors, open)
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [vendor, setVendor] = useState('')
  const [ip, setIp] = useState('')
  const [user, setUser] = useState('')
  const [doc, setDoc] = useState('')
  const [note, setNote] = useState('')
  const [picked, setPicked] = useState<number[]>([])
  const { saving, err, setErr, run } = useSaving(onSaved, onClose)

  // 每次打开都按「正在编辑的那条」重置表单；新加就是空白
  useEffect(() => {
    if (!open) return
    setId(editing?.id ?? '')
    setName(editing?.name ?? '')
    setVendor(editing?.vendor ?? '')
    setIp(editing?.ip ?? '')
    setUser(editing?.user ?? '')
    setDoc(editing?.doc ?? '')
    setNote(editing?.note ?? '')
    setPicked(editing?.monitors ?? [])
    setErr('')
  }, [open, editing, setErr])

  const save = () => {
    const body: ServerInput = {
      id: id.trim(),
      name: name.trim(),
      vendor: vendor.trim(),
      ip: ip.trim(),
      user: user.trim(),
      note: note.trim(),
      doc: doc.trim(),
      monitors: picked,
    }
    const withNames = { ...body, monitorNames: namesOf(picked, choices) }
    void run(() => (editing ? api.services.patchServer(editing.id, withNames) : api.services.addServer(withNames)))
  }

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title={editing ? t('编辑服务器：{name}', { name: editing.name }) : t('添加服务器')}
      error={err}
      onSave={save}
      saving={saving}
      saveDisabled={!id.trim() || !name.trim()}
      size="md"
    >
      <div className="form-grid">
        <Field label="id" hint={t('小写字母 / 数字 / 点 / 下划线 / 短横线；改 id 会同步改部署里的引用')}>
          <input className="input" value={id} autoFocus={!editing} placeholder={t('例如 wb-server2')} onChange={(e) => setId(e.target.value)} />
        </Field>
        <Field label={t('名字')} hint={t('卡片标题，与观测台组名、主机页一致')}>
          <input className="input" value={name} placeholder={t('例如 wb-server2')} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('厂商 · 区域')} hint={t('副标题，例如 阿里云 · 北京')}>
          <input className="input" value={vendor} placeholder={t('阿里云 · 北京')} onChange={(e) => setVendor(e.target.value)} />
        </Field>
        <Field label="IP" hint={t('卡头上显示的那个地址')}>
          <input className="input" value={ip} placeholder="47.93.5.235" onChange={(e) => setIp(e.target.value)} />
        </Field>
        <Field label={t('登录用户')}>
          <input className="input" value={user} placeholder="admin" onChange={(e) => setUser(e.target.value)} />
        </Field>
        <Field label={t('档案路径')} hint={t('本机文档或仓库地址，显示在卡片底部')}>
          <input className="input" value={doc} placeholder="E:/services/wb-server2" onChange={(e) => setDoc(e.target.value)} />
        </Field>
        <Field label={t('备注')} span={2}>
          <input className="input" value={note} placeholder={t('例如 1C1G · 东京')} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <Field label={t('服务器级观测项')} hint={t('入口 / 端口这类不挂在具体部署上的；只做跳转，不在这里建观测')}>
        <MonitorPicker value={picked} onChange={setPicked} choices={choices} />
      </Field>
    </FormDrawer>
  )
}

// ---------- 服务 ----------

export function ServiceDrawer({ open, editing, onClose, onSaved }: {
  open: boolean
  editing: ServiceRec | null
  onClose: () => void
  onSaved: (p: ServicesPayload) => void
}) {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [kind, setKind] = useState<DeployKind>('service')
  const [summary, setSummary] = useState('')
  const [doc, setDoc] = useState('')
  const { saving, err, setErr, run } = useSaving(onSaved, onClose)

  useEffect(() => {
    if (!open) return
    setId(editing?.id ?? '')
    setName(editing?.name ?? '')
    setKind(editing?.kind ?? 'service')
    setSummary(editing?.summary ?? '')
    setDoc(editing?.doc ?? '')
    setErr('')
  }, [open, editing, setErr])

  const save = () => {
    const body: ServiceInput = { id: id.trim(), name: name.trim(), kind, summary: summary.trim(), doc: doc.trim() }
    void run(() => (editing ? api.services.patchService(editing.id, body) : api.services.addService(body)))
  }

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title={editing ? t('编辑服务：{name}', { name: editing.name }) : t('添加服务')}
      error={err}
      onSave={save}
      saving={saving}
      saveDisabled={!id.trim() || !name.trim()}
      size="md"
    >
      <div className="form-grid">
        <Field label="id" hint={t('部署里靠它指认这个服务')}>
          <input className="input" value={id} autoFocus={!editing} placeholder={t('例如 wbapi')} onChange={(e) => setId(e.target.value)} />
        </Field>
        <Field label={t('名字')} hint={t('卡片 / 列表里显示的名字')}>
          <input className="input" value={name} placeholder={t('例如 网关 API')} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('种类')}>
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as DeployKind)}>
            {KIND_ORDER.map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </select>
        </Field>
        <Field label={t('项目目录')} hint={t('仓库或部署目录，显示在卡片底部')}>
          <input className="input" value={doc} placeholder="/opt/wbapi" onChange={(e) => setDoc(e.target.value)} />
        </Field>
        <Field label={t('一句话说明')} span={2} hint={t('鼠标悬停与搜索都会用到')}>
          <input className="input" value={summary} placeholder={t('例如 WorkBuddy 网关（OpenAI 兼容）')} onChange={(e) => setSummary(e.target.value)} />
        </Field>
      </div>
    </FormDrawer>
  )
}

// ---------- 部署 ----------

export function DeployDrawer({ open, editing, preset, servers, services, monitors, onClose, onSaved }: {
  open: boolean
  editing: DeployRec | null
  /** 从某台机 / 某个服务点「+」进来时预选的一端 */
  preset: { server?: string; service?: string } | null
  servers: ServerRec[]
  services: ServiceRec[]
  monitors: Record<string, string> | undefined
  onClose: () => void
  onSaved: (p: ServicesPayload) => void
}) {
  const choices = useMonitorChoices(monitors, open)
  const [server, setServer] = useState('')
  const [service, setService] = useState('')
  const [path, setPath] = useState('')
  const [runtime, setRuntime] = useState('')
  const [port, setPort] = useState('')
  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')
  const [picked, setPicked] = useState<number[]>([])
  const { saving, err, setErr, run } = useSaving(onSaved, onClose)

  useEffect(() => {
    if (!open) return
    setServer(editing?.server ?? preset?.server ?? servers[0]?.id ?? '')
    setService(editing?.service ?? preset?.service ?? '')
    setPath(editing?.path ?? '')
    setRuntime(editing?.runtime ?? '')
    setPort(editing?.port ?? '')
    setUrl(editing?.url ?? '')
    setNote(editing?.note ?? '')
    setPicked(editing?.monitor ?? [])
    setErr('')
  }, [open, editing, preset, servers, setErr])

  const key = editing ? editing.server + ':' + editing.service : ''
  const save = () => {
    const body: DeployInput = {
      server,
      service,
      path: path.trim(),
      runtime: runtime.trim(),
      port: port.trim(),
      url: url.trim(),
      note: note.trim(),
      monitor: picked,
    }
    const withNames = { ...body, monitorNames: namesOf(picked, choices) }
    void run(() => (editing ? api.services.patchDeploy(key, withNames) : api.services.addDeploy(withNames)))
  }

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title={editing ? t('编辑部署：{name}', { name: servers.find((s) => s.id === editing.server)?.name ?? editing.server }) : t('添加部署')}
      error={err}
      onSave={save}
      saving={saving}
      saveDisabled={!server || !service || !path.trim()}
      size="md"
    >
      <div className="form-grid">
        <Field label={t('服务器')} hint={t('部署在哪台机上')}>
          <select className="select" value={server} onChange={(e) => setServer(e.target.value)}>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>
        <Field label={t('服务')} hint={t('部署的是什么')}>
          <select className="select" value={service} onChange={(e) => setService(e.target.value)}>
            <option value="">{t('选一个服务…')}</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>
        <Field label={t('路径')} span={2} hint={t('服务器上的绝对路径（本机就是本机路径）')}>
          <input className="input" value={path} autoFocus={!editing} placeholder="E:/workbuddy-workspace/projects/wbapi" onChange={(e) => setPath(e.target.value)} />
        </Field>
        <Field label={t('启动方式')} hint={t('systemd unit / 计划任务 / 裸命令')}>
          <input className="input" value={runtime} placeholder="systemd wb2api" onChange={(e) => setRuntime(e.target.value)} />
        </Field>
        <Field label={t('端口')} hint={t('监听地址，可空')}>
          <input className="input" value={port} placeholder="7863" onChange={(e) => setPort(e.target.value)} />
        </Field>
        <Field label={t('管理页')} span={2} hint={t('能打开的页面（面板 / 后台）；没观测时点名字就跳它')}>
          <input className="input" value={url} placeholder="http://127.0.0.1:7863" onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Field label={t('备注')} span={2}>
          <input className="input" value={note} placeholder={t('例如 不参与观测')} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <Field label={t('观测项')} hint={t('有观测就点名字去观测台；没有就靠管理页')}>
        <MonitorPicker value={picked} onChange={setPicked} choices={choices} />
      </Field>
    </FormDrawer>
  )
}

// ---------- 删除确认 ----------

/**
 * 删除一律弹确认框、手输 id 才能提交（跟主机页一个规矩）。
 * blockers 非空表示「还有东西挡着」（比如这台机上还有 3 条部署），列出来并禁用删除。
 */
export function DeleteDialog({ open, title, need, warning, blockers, onClose, onConfirm }: {
  open: boolean
  title: string
  /** 要手输的那串字：服务器 / 服务的 id，或部署的 server:service */
  need: string
  warning: string
  blockers?: string[]
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  const [typed, setTyped] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const blocked = Boolean(blockers && blockers.length)

  useEffect(() => {
    if (!open) return
    setTyped('')
    setErr('')
  }, [open])

  const ok = typed.trim().toLowerCase() === need.trim().toLowerCase() && !blocked
  const run = async () => {
    if (!ok || busy) return
    setBusy(true)
    setErr('')
    try {
      await onConfirm()
      onClose()
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={460}
      footer={(
        <>
          <span className="grow" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t('取消')}</Button>
          <Button variant="danger" disabled={!ok || busy} onClick={() => void run()}>
            {busy ? <Spinner /> : <Trash2 size={14} />} {t('删除')}
          </Button>
        </>
      )}
    >
      <p className="svc-del-text">{warning}</p>
      {blocked ? (
        <ul className="svc-del-list">
          {(blockers ?? []).map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : null}
      {blocked ? <p className="svc-del-text">{t('先把这些删掉，再回来删这一条。')}</p> : null}
      <Field label={t('手输 {need} 确认', { need })}>
        <input className="input" value={typed} disabled={blocked} onChange={(e) => setTyped(e.target.value)} autoFocus />
      </Field>
      {err ? <div className="alert">{err}</div> : null}
    </Modal>
  )
}
