import type { Dispatch, SetStateAction } from 'react'
import { Field } from '../ui'
import type { MonitorForm } from './form'

/** 折叠起来的高级设置：超时 / 重试次数 / 重试间隔 / 卡片是否常显消息。 */
export function AdvancedSection({ form, setForm }: {
  form: MonitorForm
  setForm: Dispatch<SetStateAction<MonitorForm>>
}) {
  return (
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
  )
}
