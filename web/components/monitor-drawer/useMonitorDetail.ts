// 观测项详情抽屉的状态与接口调用（2026-10-21 从 MonitorDrawer.tsx 抽出来）。
// 抽屉本身只负责把这里的东西摆进 FormDrawer + 五段；「能不能保存 / 能不能立即观测 / 删除确认是否匹配」
// 这三条判断在 form.ts 里（纯函数，有单测）。
import { useCallback, useEffect, useState } from 'react'
import { api, type MonitorActionStepResult, type MonitorDetail } from '../../lib/api'
import {
  buildPatch, canSaveForm, confirmMatches, emptyForm, runDisabledOf, toForm, type MonitorForm,
} from './form'
import { t } from '../../lib/i18n'

export function useMonitorDetail({ id, onClose, onChanged }: {
  id: number | null
  onClose: () => void
  onChanged?: () => void
}) {
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

  const canSave = canSaveForm(form, base, saving)
  const runDisabled = runDisabledOf(action, m, running)
  const confirmOk = confirmMatches(m, confirmName)

  const save = async () => {
    if (id === null || !base) return
    setSaving(true)
    setSaveErr('')
    setSaveMsg('')
    try {
      // 只发改过的字段：Kuma 的 editMonitor 是全量覆盖，传得越少越不容易踩到没带回的字段
      await api.monitors.update(id, buildPatch(form, base))
      await reload(id)
      setSaveMsg(t('已保存'))
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
      setSaveMsg(m.active ? t('已暂停') : t('已恢复'))
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

  return {
    detail, loading, error, form, setForm, saving, saveMsg, saveErr, busy,
    confirming, setConfirming, confirmName, setConfirmName, deleting, deleteErr, setDeleteErr,
    running, runErr, runSteps, runOk,
    m, action, canSave, runDisabled, confirmOk,
    save, toggleActive, remove, runNow,
  }
}

export type MonitorDetailState = ReturnType<typeof useMonitorDetail>
