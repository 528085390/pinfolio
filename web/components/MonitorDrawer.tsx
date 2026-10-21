import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { api, type MonitorActionStepResult, type MonitorDetail } from '../lib/api'
import { FormDrawer } from './FormDrawer'
import { NowSection } from './monitor-drawer/NowSection'
import { BasicSection } from './monitor-drawer/BasicSection'
import { AdvancedSection } from './monitor-drawer/AdvancedSection'
import { RunSection } from './monitor-drawer/RunSection'
import { DangerSection } from './monitor-drawer/DangerSection'
import { buildPatch, emptyForm, sameForm, toForm, validateForm, type MonitorForm } from './monitor-drawer/form'

/** 观测项详情抽屉：改名字 / 介绍 / 频率，暂停恢复，删除，立即观测。外壳走 FormDrawer，内部分五段。 */
export function MonitorDrawer({ id, onClose, onChanged }: {
  id: number | null
  onClose: () => void
  onChanged?: () => void
}) {
  const open = id !== null
  const [detail, setDetail] = useState<MonitorDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState<MonitorForm>(emptyForm)
  const [base, setBase] = useState<MonitorForm | null>(null)

  // 保存 / 暂停 / 删除各自的忙碌与错误，互不干扰
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [saveErr, setSaveErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteErr, setDeleteErr] = useState('')
  // 立即观测：跑的过程中按钮转圈，跑完把逐步回显列出来
  const [running, setRunning] = useState(false)
  const [runErr, setRunErr] = useState('')
  const [runSteps, setRunSteps] = useState<MonitorActionStepResult[] | null>(null)
  const [runOk, setRunOk] = useState<boolean | null>(null)

  const applyDetail = useCallback((d: MonitorDetail) => {
    setDetail(d)
    const f = toForm(d)
    setForm(f)
    setBase(f)
  }, [])

  const reload = useCallback(async (mid: number) => {
    const d = await api.monitors.detail(mid)
    applyDetail(d)
    return d
  }, [applyDetail])

  useEffect(() => {
    if (id === null) return
    let alive = true
    setLoading(true)
    setError('')
    setDetail(null)
    setBase(null)
    setSaveMsg('')
    setSaveErr('')
    setConfirming(false)
    setConfirmName('')
    setDeleteErr('')
    setRunSteps(null)
    setRunOk(null)
    setRunErr('')
    api.monitors.detail(id)
      .then((d) => { if (alive) applyDetail(d) })
      .catch((e) => { if (alive) setError(e?.message || String(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [id, applyDetail])

  const m = detail?.monitor
  const action = detail?.action

  const dirty = useMemo(() => (base ? !sameForm(form, base) : false), [form, base])
  const { nameOk, intervalOk, timeoutOk } = validateForm(form)
  const canSave = dirty && nameOk && intervalOk && timeoutOk && !saving

  const save = async () => {
    if (id === null || !base) return
    setSaving(true)
    setSaveErr('')
    setSaveMsg('')
    try {
      // 只发改过的字段：Kuma 的 editMonitor 是全量覆盖，传得越少越不容易踩到没带回的字段
      await api.monitors.update(id, buildPatch(form, base))
      await reload(id)
      setSaveMsg('已保存')
      onChanged?.()
    } catch (e: any) {
      setSaveErr(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async () => {
    if (id === null || !m) return
    setBusy(true)
    setSaveErr('')
    setSaveMsg('')
    try {
      if (m.active) await api.monitors.pause(id)
      else await api.monitors.resume(id)
      await reload(id)
      setSaveMsg(m.active ? '已暂停' : '已恢复')
      onChanged?.()
    } catch (e: any) {
      setSaveErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (id === null || !m) return
    setDeleting(true)
    setDeleteErr('')
    try {
      await api.monitors.remove(id, confirmName.trim())
      onChanged?.()
      onClose()
    } catch (e: any) {
      setDeleteErr(e?.message || String(e))
    } finally {
      setDeleting(false)
    }
  }

  const runNow = async () => {
    if (id === null) return
    setRunning(true)
    setRunErr('')
    setRunSteps(null)
    setRunOk(null)
    try {
      const r = await api.monitors.check(id)
      setRunSteps(r.steps || [])
      setRunOk(!!r.ok)
      await reload(id)
      onChanged?.()
    } catch (e: any) {
      setRunErr(e?.message || String(e))
    } finally {
      setRunning(false)
    }
  }

  const runDisabled = !action || !!action.disabledReason || running || !m || !m.active

  const confirmOk = !!m && confirmName.trim() === m.name.trim()

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      size="md"
      title={(
        <div className="monitor-drawer-title">
          <span className="monitor-drawer-kicker">观测项详情</span>
          <span className="monitor-drawer-name" title={m?.name}>{m ? m.name : (loading ? '读取中…' : '观测项')}</span>
        </div>
      )}
      loading={!detail && !error}
      error={error}
      onSave={save}
      saving={saving}
      saveDisabled={!canSave}
    >
      {detail && m ? (
        <>
          <NowSection detail={detail} m={m} />

          {saveErr ? <div className="alert" style={{ marginTop: 14 }}>{saveErr}</div> : null}
          {saveMsg && !saveErr ? <div className="monitor-drawer-ok">{saveMsg}</div> : null}

          <BasicSection form={form} setForm={setForm} m={m} />
          <AdvancedSection form={form} setForm={setForm} />
          <RunSection
            action={action}
            m={m}
            running={running}
            runErr={runErr}
            runSteps={runSteps}
            runOk={runOk}
            runDisabled={runDisabled}
            onRun={runNow}
          />

          {detail.link ? (
            <div style={{ marginTop: 14 }}>
              <a className="monitor-link" href={detail.link.url} target="_blank" rel="noreferrer noopener" title={detail.link.label}>
                打开项目管理页 <ExternalLink size={11} className="monitor-link-icon" />
              </a>
            </div>
          ) : null}

          <DangerSection
            m={m}
            busy={busy}
            onToggleActive={toggleActive}
            confirming={confirming}
            setConfirming={setConfirming}
            confirmName={confirmName}
            setConfirmName={setConfirmName}
            deleteErr={deleteErr}
            setDeleteErr={setDeleteErr}
            deleting={deleting}
            confirmOk={confirmOk}
            onRemove={remove}
          />
        </>
      ) : null}
    </FormDrawer>
  )
}
