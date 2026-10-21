import type { Dispatch, SetStateAction } from 'react'
import { Field } from '../ui'
import { TYPE_LABEL, type MonitorFull } from './display'
import type { MonitorForm } from './form'

/** 基本信息：名字、介绍、检查频率（含常用档位），以及只读的类型 / 目标 / 分组 / 策略。 */
export function BasicSection({ form, setForm, m }: {
  form: MonitorForm
  setForm: Dispatch<SetStateAction<MonitorForm>>
  m: MonitorFull
}) {
  return (
    <>
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
    </>
  )
}
