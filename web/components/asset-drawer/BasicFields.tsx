import { ExternalLink } from 'lucide-react'
import { cx, type FieldDef, type Tag } from '../../lib/api'
import { KINDS, KIND_META, STATUS_META, expiry } from '../../lib/format'
import { Field } from '../ui'
import { Markdown } from '../Markdown'
import { CustomFields } from './CustomFields'
import { CURRENCIES, STATUSES, type AssetFormState } from './form'

/** 资产主表单：基本信息 + 自定义字段 + 备注预览。 */
export function BasicFields({ form, set, setCustom, fields, tags, tagsText, setTagsText }: {
  form: AssetFormState
  set: <K extends keyof AssetFormState>(key: K, value: AssetFormState[K]) => void
  setCustom: (key: string, value: any) => void
  fields: FieldDef[]
  tags: Tag[]
  tagsText: string
  setTagsText: (v: string) => void
}) {
  const ex = expiry(form.expiresAt || null)
  return (
    <>
      <div className="form-grid">
        <Field label="名称" span={2}>
          <input className="input" value={form.name} autoFocus placeholder="例如 my-server / ThinkPad X1"
            onChange={(e) => set('name', e.target.value)} />
        </Field>

        <Field label="类型">
          <select className="select" value={form.kind} onChange={(e) => set('kind', e.target.value)}>
            {KINDS.map((k) => <option key={k} value={k}>{KIND_META[k].label}</option>)}
          </select>
        </Field>

        <Field label="状态">
          <select className="select" value={form.status} onChange={(e) => set('status', e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
        </Field>

        <Field label="位置 / 归属">
          <input className="input" value={form.location} placeholder="阿里云 cn-beijing / 书房"
            onChange={(e) => set('location', e.target.value)} />
        </Field>

        <Field label="供应商">
          <input className="input" value={form.vendor} placeholder="阿里云 / 京东"
            onChange={(e) => set('vendor', e.target.value)} />
        </Field>

        <Field label="序列号 / 编号">
          <input className="input" value={form.serial} placeholder="SN / 订单号 / 账号 ID"
            onChange={(e) => set('serial', e.target.value)} />
        </Field>

        <Field label="价格">
          <div className="row" style={{ gap: 6 }}>
            <input className="input" type="number" step="0.01" value={form.price} placeholder="0.00"
              onChange={(e) => set('price', e.target.value)} />
            <select className="select" style={{ width: 84 }} value={form.currency} onChange={(e) => set('currency', e.target.value)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </Field>

        <Field label="购买日期">
          <input className="input" type="date" value={form.purchasedAt} onChange={(e) => set('purchasedAt', e.target.value)} />
        </Field>

        <Field label="到期 / 续费日" hint={ex ? ex.text : undefined}>
          <input className="input" type="date" value={form.expiresAt} onChange={(e) => set('expiresAt', e.target.value)} />
        </Field>

        <Field label="链接" span={2}>
          <div className="row" style={{ gap: 6 }}>
            <input className="input" value={form.url} placeholder="https://…"
              onChange={(e) => set('url', e.target.value)} />
            <a className={cx('btn', 'btn-sm', form.url ? '' : 'is-disabled')} href={form.url || undefined}
              target="_blank" rel="noreferrer" aria-disabled={!form.url}
              onClick={(e) => { if (!form.url) e.preventDefault() }}
              style={{ flex: 'none' }}>
              打开 <ExternalLink size={12} />
            </a>
          </div>
        </Field>

        <Field label="标签" span={2} hint="空格或逗号分隔，会自动创建新标签">
          <input className="input" value={tagsText} placeholder="服务器 阿里云"
            onChange={(e) => setTagsText(e.target.value)}
            list="asset-tag-suggest" />
          <datalist id="asset-tag-suggest">
            {tags.map((t) => <option key={t.id} value={t.name} />)}
          </datalist>
        </Field>

        <CustomFields fields={fields} form={form} setCustom={setCustom} />

        <Field label="备注" span={2} hint="支持 Markdown">
          <textarea className="textarea" rows={4} value={form.notes} placeholder="配置、用途、注意事项…"
            onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>

      {form.notes.trim() ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="section-title" style={{ marginTop: 0 }}>备注预览</div>
          <Markdown text={form.notes} />
        </div>
      ) : null}
    </>
  )
}
