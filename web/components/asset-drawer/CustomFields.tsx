import type { FieldDef } from '../../lib/api'
import { Field } from '../ui'
import type { AssetFormState } from './form'

/** 自定义字段（field_defs 里配的）：select / bool / number / date / text 五种。 */
export function CustomFields({ fields, form, setCustom }: {
  fields: FieldDef[]
  form: AssetFormState
  setCustom: (key: string, value: any) => void
}) {
  return (
    <>
      {fields.map((f) => {
        const v = form.custom[f.key]
        return (
          <Field key={f.id} label={f.label}>
            {f.type === 'select' ? (
              <select className="select" value={v ?? ''} onChange={(e) => setCustom(f.key, e.target.value)}>
                <option value="">—</option>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === 'bool' ? (
              <label className="row" style={{ gap: 6, height: 34, fontSize: 13 }}>
                <input type="checkbox" checked={!!v} onChange={(e) => setCustom(f.key, e.target.checked)} />
                是
              </label>
            ) : (
              <input
                className="input"
                type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                value={v ?? ''}
                onChange={(e) => setCustom(f.key, e.target.value)}
              />
            )}
          </Field>
        )
      })}
    </>
  )
}
