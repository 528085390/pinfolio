import { Plus, Trash2 } from 'lucide-react'
import { Button, Field } from '../../components/ui'
import type { FieldDef } from '../../lib/api'
import { FIELD_TYPES, fieldTypeLabel } from './fields'
import type { SettingsState } from './useSettings'

export function FieldsCard({ s, fields }: { s: SettingsState; fields: FieldDef[] }) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="section-title" style={{ marginTop: 0 }}>自定义资产字段</div>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
        给资产加自己的字段，例如「密钥存放位置」「续费周期」「机房」。字段对所有资产通用。
      </div>

      {fields.length === 0 ? (
        <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>还没有自定义字段。</div>
      ) : (
        <div className="table-wrap" style={{ marginBottom: 14 }}>
          <table className="data">
            <thead><tr><th>显示名</th><th>key</th><th>类型</th><th>选项</th><th style={{ width: 44 }} /></tr></thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.id}>
                  <td style={{ fontWeight: 550 }}>{f.label}</td>
                  <td className="mono muted">{f.key}</td>
                  <td className="muted">{fieldTypeLabel(f.type)}</td>
                  <td className="muted">{f.options.length ? f.options.join(' / ') : '—'}</td>
                  <td>
                    <Button variant="ghost" size="sm" icon title="删除字段" onClick={() => s.removeField(f)}>
                      <Trash2 size={13} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="form-grid">
        <Field label="显示名">
          <input className="input" value={s.fLabel} placeholder="密钥存放位置" onChange={(e) => s.setFLabel(e.target.value)} />
        </Field>
        <Field label="key（英文，不可重复）">
          <input className="input" value={s.fKey} placeholder="secret_at" onChange={(e) => s.setFKey(e.target.value)} />
        </Field>
        <Field label="类型">
          <select className="select" value={s.fType} onChange={(e) => s.setFType(e.target.value)}>
            {FIELD_TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
          </select>
        </Field>
        {s.fType === 'select' ? (
          <Field label="选项（逗号分隔）">
            <input className="input" value={s.fOptions} placeholder="月付, 季付, 年付" onChange={(e) => s.setFOptions(e.target.value)} />
          </Field>
        ) : <div />}
      </div>
      <div style={{ marginTop: 10 }}>
        <Button variant="primary" size="sm" onClick={s.addField}><Plus size={14} /> 添加字段</Button>
      </div>
    </div>
  )
}
