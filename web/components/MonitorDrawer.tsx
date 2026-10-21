import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink, Pause, Play, Trash2, Zap } from 'lucide-react'
import { api, type MonitorActionStepResult, type MonitorDetail } from '../lib/api'
import { Button, Field } from '../components/ui'
import { FormDrawer } from './FormDrawer'
import { BeatStrip } from './BeatStrip'
import { relativeTime, fullTime } from '../lib/format'

// Kuma 心跳状态码：0 DOWN / 1 UP / 2 PENDING / 3 MAINTENANCE
const STATUS: Record<number, { label: string; color: string }> = {
  0: { label: '故障', color: 'var(--danger)' },
  1: { label: '正常', color: 'var(--ok)' },
  2: { label: '待定', color: 'var(--warn)' },
  3: { label: '维护', color: 'var(--muted)' },
}
const TONE: Record<string, { label: string; color: string }> = {
  绿: { label: '成功', color: 'var(--ok)' },
  黄: { label: '部分成功', color: 'var(--warn)' },
  红: { label: '失败', color: 'var(--danger)' },
  灰: { label: '未运行', color: 'var(--muted)' },
}

const TYPE_LABEL: Record<string, string> = {
  http: 'HTTP', ssh: 'SSH', port: 'TCP', ping: 'Ping', dns: 'DNS', keyword: '关键词', grpc: 'gRPC', push: '推送',
}

/** 表单里可改的那几个字段。名字 / 介绍 / 频率直接写回 Kuma，Kuma 是唯一事实源。 */
type Form = {
  name: string
  description: string
  interval: number
  timeout: number
  maxretries: number
  retryInterval: number
  showMsg: boolean
}

const toForm = (d: MonitorDetail): Form => ({
  name: d.monitor.name,
  description: d.monitor.description,
  interval: d.monitor.interval,
  timeout: d.monitor.timeout,
  maxretries: d.monitor.maxretries,
  retryInterval: d.monitor.retryInterval,
  showMsg: d.monitor.showMsg,
})

const sameForm = (a: Form, b: Form) =>
  a.name === b.name && a.description === b.description && a.interval === b.interval
  && a.timeout === b.timeout && a.maxretries === b.maxretries && a.retryInterval === b.retryInterval
  && a.showMsg === b.showMsg

/** 观测项详情抽屉：改名字 / 介绍 / 频率，暂停恢复，删除，立即观测。 */
export function MonitorDrawer({ id, onClose, onChanged }: {
  id: number | null
  onClose: () => void
  onChanged?: () => void
}) {
  const open = id !== null
  const [detail, setDetail] = useState<MonitorDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState<Form>({ name: '', description: '', interval: 60, timeout: 20, maxretries: 0, retryInterval: 60, showMsg: false })
  const [base, setBase] = useState<Form | null>(null)

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
  const latest = detail?.latest || null
  const tone = (() => {
    if (!latest) return null
    if (latest.tone) return TONE[latest.tone] || null
    return latest.status === null ? null : (STATUS[latest.status] || null)
  })()
  const action = detail?.action

  const dirty = useMemo(() => (base ? !sameForm(form, base) : false), [form, base])
  const nameOk = form.name.trim().length > 0 && form.name.trim().length <= 120
  const intervalOk = Number.isFinite(form.interval) && form.interval >= 20 && form.interval <= 86400
  const timeoutOk = Number.isFinite(form.timeout) && form.timeout >= 1 && form.timeout <= 120 && form.timeout < form.interval
  const canSave = dirty && nameOk && intervalOk && timeoutOk && !saving

  const save = async () => {
    if (id === null || !base) return
    setSaving(true)
    setSaveErr('')
    setSaveMsg('')
    try {
      // 只发改过的字段：Kuma 的 editMonitor 是全量覆盖，传得越少越不容易踩到没带回的字段
      const patch: any = {}
      if (form.name.trim() !== base.name) patch.name = form.name.trim()
      if (form.description.trim() !== base.description) patch.description = form.description.trim()
      if (form.interval !== base.interval) patch.interval = form.interval
      if (form.timeout !== base.timeout) patch.timeout = form.timeout
      if (form.maxretries !== base.maxretries) patch.maxretries = form.maxretries
      if (form.retryInterval !== base.retryInterval) patch.retryInterval = form.retryInterval
      if (form.showMsg !== base.showMsg) patch.showMsg = form.showMsg
      await api.monitors.update(id, patch)
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
          <div className="monitor-drawer-now">
            <div className="monitor-drawer-now-head">
              <span className="status-pill">
                <span className="status-dot" style={{ background: tone ? tone.color : 'var(--muted)' }} />
                {tone ? tone.label : '无数据'}
              </span>
              {!m.active ? <span className="monitor-chip">已暂停</span> : null}
              {latest?.ping !== null && latest?.ping !== undefined ? <span className="monitor-chip">{latest.ping} ms</span> : null}
              <span className="grow" />
              <span className="monitor-updated" title={latest?.time ? fullTime(latest.time) : undefined}>
                {latest?.time ? relativeTime(latest.time) : '还没跑过'}
              </span>
            </div>
            {latest?.msg ? <div className="monitor-drawer-msg">{latest.msg}</div> : null}
            <BeatStrip
              cells={(detail.beats || []).map((b) => ({ status: b.status, tone: b.tone }))}
              type={m.type}
              title={'最近 ' + detail.beats.length + ' 次心跳'}
            />
          </div>

          {saveErr ? <div className="alert" style={{ marginTop: 14 }}>{saveErr}</div> : null}
          {saveMsg && !saveErr ? <div className="monitor-drawer-ok">{saveMsg}</div> : null}

          <div className="section-title" style={{ marginTop: 22 }}>基本信息</div>
          <div className="form-grid">
            <Field label="名称" span hint="Kuma 里的观测项名字，改名会同步到 CLI 和 SNAPSHOT">
              <input
                className="input"
                name="name"
                value={form.name}
                maxLength={120}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="介绍" span hint="给这个观测项写一句人话，卡片上悬停可见">
              <textarea
                className="textarea"
                name="description"
                rows={2}
                maxLength={500}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </Field>
            <Field label="检查频率（秒）" hint={m.policy ? '受下面的策略影响，真实频率可能不同' : '20–86400 秒'}>
              <div className="monitor-drawer-inline">
                <input
                  className="input"
                  name="interval"
                  type="number"
                  min={20}
                  max={86400}
                  step={10}
                  value={form.interval}
                  onChange={(e) => setForm({ ...form, interval: Number(e.target.value) })}
                />
                <div className="monitor-drawer-chips">
                  {[30, 60, 300, 600, 1800].map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={'monitor-chip-btn' + (form.interval === s ? ' on' : '')}
                      onClick={() => setForm({ ...form, interval: s })}
                    >
                      {s < 60 ? s + ' 秒' : s / 60 + ' 分'}
                    </button>
                  ))}
                </div>
              </div>
            </Field>
            <Field label="类型 / 目标">
              <div className="monitor-drawer-readonly">
                <span className="monitor-chip">{TYPE_LABEL[m.type] || m.type}</span>
                <span className="monitor-drawer-target" title={m.target}>{m.target}</span>
              </div>
            </Field>
            {m.group ? (
              <Field label="分组" span>
                <div className="monitor-drawer-readonly"><span className="monitor-drawer-target">{m.group}</span></div>
              </Field>
            ) : null}
            {m.policy ? (
              <Field label={'观测策略 · ' + m.policy.name} span>
                <div className="monitor-drawer-policy">{m.policy.summary}</div>
              </Field>
            ) : null}
          </div>

          <details className="monitor-drawer-advanced">
            <summary>高级设置（超时 / 重试）</summary>
            <div className="form-grid" style={{ marginTop: 12 }}>
              <Field label="超时（秒）" hint="1–120，且必须小于检查频率">
                <input
                  className="input"
                  name="timeout"
                  type="number"
                  min={1}
                  max={120}
                  value={form.timeout}
                  onChange={(e) => setForm({ ...form, timeout: Number(e.target.value) })}
                />
              </Field>
              <Field label="重试次数" hint="0–10 次">
                <input
                  className="input"
                  name="maxretries"
                  type="number"
                  min={0}
                  max={10}
                  value={form.maxretries}
                  onChange={(e) => setForm({ ...form, maxretries: Number(e.target.value) })}
                />
              </Field>
              <Field label="重试间隔（秒）" hint="1–3600">
                <input
                  className="input"
                  name="retryInterval"
                  type="number"
                  min={1}
                  max={3600}
                  value={form.retryInterval}
                  onChange={(e) => setForm({ ...form, retryInterval: Number(e.target.value) })}
                />
              </Field>
              <Field label="显示最近一次消息">
                <label className="monitor-drawer-check">
                  <input
                    type="checkbox"
                    name="showMsg"
                    checked={form.showMsg}
                    onChange={(e) => setForm({ ...form, showMsg: e.target.checked })}
                  />
                  在卡片上常显
                </label>
              </Field>
            </div>
          </details>

          <div className="section-title" style={{ marginTop: 22 }}>立即观测</div>
          <div className="monitor-drawer-action">
            <Button variant="primary" size="sm" className="monitor-drawer-run" disabled={runDisabled} onClick={runNow}>
              <Zap size={14} /> {running ? '观测中…' : '立即观测'}
            </Button>
            <div className="monitor-drawer-steps">
              {action && action.steps.length ? action.steps.map((s, i) => (
                <div key={i} className="monitor-drawer-step">
                  <span className="monitor-drawer-step-no">{i + 1}</span>
                  <span className="monitor-drawer-step-label">{s.label}</span>
                  {s.hint ? <span className="field-hint">{s.hint}</span> : null}
                </div>
              )) : (
                <div className="field-hint">{action?.disabledReason || '这个观测项没有可立即执行的动作。'}</div>
              )}
            </div>
            {action?.disabledReason && action.steps.length ? <div className="field-hint">{action.disabledReason}</div> : null}
            {m && !m.active && action?.steps.length ? <div className="field-hint">已暂停，先恢复观测再点立即观测。</div> : null}
            {action ? <div className="field-hint">配方来源：{action.source === 'config' ? 'monitor-actions.json' : action.source === 'default' ? '默认（重启检查循环）' : '无'}</div> : null}

            {runErr ? <div className="alert" style={{ marginTop: 10 }}>{runErr}</div> : null}
            {runSteps ? (
              <div className="monitor-drawer-results">
                <div className={'monitor-drawer-result-head' + (runOk === false ? ' fail' : '')}>
                  {runOk === false ? '这次观测没跑完' : '这次观测跑完了'}
                </div>
                {runSteps.map((s, i) => (
                  <div key={i} className={'monitor-drawer-result' + (s.ok ? ' ok' : ' fail')}>
                    <span className="monitor-drawer-result-no">{i + 1}</span>
                    <span className="monitor-drawer-result-label">{s.label}</span>
                    <span className="monitor-drawer-result-ms">{s.ms >= 1000 ? (s.ms / 1000).toFixed(1) + 's' : s.ms + 'ms'}</span>
                    <div className="monitor-drawer-result-detail">{s.detail}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {detail.link ? (
            <div style={{ marginTop: 14 }}>
              <a className="monitor-link" href={detail.link.url} target="_blank" rel="noreferrer noopener" title={detail.link.label}>
                打开项目管理页 <ExternalLink size={11} className="monitor-link-icon" />
              </a>
            </div>
          ) : null}

          <div className="section-title" style={{ marginTop: 22 }}>危险操作</div>
          {!confirming ? (
            <div className="monitor-drawer-actions">
              <Button variant="ghost" size="sm" disabled={busy} onClick={toggleActive}>
                {m.active ? <><Pause size={14} /> 暂停观测</> : <><Play size={14} /> 恢复观测</>}
              </Button>
              <span className="grow" />
              <Button variant="danger" size="sm" onClick={() => { setConfirming(true); setConfirmName(''); setDeleteErr('') }}>
                <Trash2 size={14} /> 删除观测
              </Button>
            </div>
          ) : (
            <div className="monitor-drawer-confirm">
              <div className="monitor-drawer-confirm-title">删除「{m.name}」？</div>
              <div className="monitor-drawer-confirm-text">
                会连同它的历史心跳一起从 Kuma 删掉，不能撤销。删除前会自动备份一份 <code>kuma.db</code>。
              </div>
              <Field label={'把观测项名字原样输一遍：' + m.name}>
                <input
                  className="input"
                  name="confirmName"
                  autoFocus
                  value={confirmName}
                  placeholder="在这里输入名字"
                  onChange={(e) => setConfirmName(e.target.value)}
                />
              </Field>
              {deleteErr ? <div className="alert" style={{ marginTop: 10 }}>{deleteErr}</div> : null}
              <div className="monitor-drawer-actions" style={{ marginTop: 12 }}>
                <Button variant="ghost" size="sm" disabled={deleting} onClick={() => setConfirming(false)}>取消</Button>
                <span className="grow" />
                <Button variant="danger" size="sm" disabled={!confirmOk || deleting} onClick={remove}>
                  <Trash2 size={14} /> {deleting ? '删除中…' : '确认删除'}
                </Button>
              </div>
            </div>
          )}
        </>
      ) : null}
    </FormDrawer>
  )
}
