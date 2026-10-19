import { useEffect, useState } from 'react'
import { Trash2, Save, Plus, Link2, StickyNote, ExternalLink } from 'lucide-react'
import { api, cx, type Asset, type FieldDef, type Note, type Tag } from '../lib/api'
import { KINDS, KIND_META, STATUS_META, fullTime, money, expiry } from '../lib/format'
import { Button, Drawer, Field, Spinner, TagChip } from './ui'
import { Markdown } from './Markdown'

const STATUSES = ['active', 'idle', 'retired', 'lost']
const CURRENCIES = ['CNY', 'USD', 'EUR', 'JPY', 'HKD']

type FormState = {
  name: string
  kind: string
  status: string
  location: string
  vendor: string
  serial: string
  price: string
  currency: string
  purchasedAt: string
  expiresAt: string
  url: string
  notes: string
  custom: Record<string, any>
}

function blank(): FormState {
  return {
    name: '', kind: 'device', status: 'active', location: '', vendor: '', serial: '',
    price: '', currency: 'CNY', purchasedAt: '', expiresAt: '', url: '', notes: '', custom: {},
  }
}

function toForm(a: Asset): FormState {
  return {
    name: a.name || '',
    kind: a.kind || 'device',
    status: a.status || 'active',
    location: a.location || '',
    vendor: a.vendor || '',
    serial: a.serial || '',
    price: a.price === null || a.price === undefined ? '' : String(a.price),
    currency: a.currency || 'CNY',
    purchasedAt: a.purchasedAt || '',
    expiresAt: a.expiresAt || '',
    url: a.url || '',
    notes: a.notes || '',
    custom: { ...(a.custom || {}) },
  }
}

export function AssetDrawer({ open, assetId, fields, tags, onClose, onSaved }: {
  open: boolean
  assetId: number | 'new' | null
  fields: FieldDef[]
  tags: Tag[]
  onClose: () => void
  onSaved: () => void
}) {
  const [currentId, setCurrentId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(blank())
  const [tagsText, setTagsText] = useState('')
  const [linked, setLinked] = useState<Note[]>([])
  const [noteDraft, setNoteDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [meta, setMeta] = useState<{ createdAt: string; updatedAt: string } | null>(null)

  useEffect(() => {
    if (!open) return
    setError('')
    setNoteDraft('')
    if (assetId === 'new') {
      setCurrentId(null)
      setForm(blank())
      setTagsText('')
      setLinked([])
      setMeta(null)
      return
    }
    if (typeof assetId === 'number') {
      void load(assetId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, assetId])

  async function load(id: number) {
    setLoading(true)
    try {
      const a = await api.assets.get(id) as Asset & { linkedNotes?: Note[] }
      setCurrentId(a.id)
      setForm(toForm(a))
      setTagsText((a.tags || []).map((t) => t.name).join(' '))
      setLinked(a.linkedNotes || [])
      setMeta({ createdAt: a.createdAt, updatedAt: a.updatedAt })
      setError('')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function setCustom(key: string, value: any) {
    setForm((f) => ({ ...f, custom: { ...f.custom, [key]: value } }))
  }

  function payload() {
    return {
      name: form.name.trim(),
      kind: form.kind,
      status: form.status,
      location: form.location.trim(),
      vendor: form.vendor.trim(),
      serial: form.serial.trim(),
      price: form.price === '' ? null : Number(form.price),
      currency: form.currency,
      purchasedAt: form.purchasedAt || null,
      expiresAt: form.expiresAt || null,
      url: form.url.trim(),
      notes: form.notes,
      custom: form.custom,
      tags: tagsText.split(/[\s,，]+/).map((s) => s.replace(/^#/, '').trim()).filter(Boolean),
    }
  }

  async function save() {
    if (!form.name.trim()) {
      setError('名称不能为空')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (currentId === null) {
        const created = await api.assets.create(payload())
        onSaved()
        await load(created.id)
      } else {
        await api.assets.update(currentId, payload())
        await load(currentId)
        onSaved()
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (currentId === null) return
    if (!confirm('删除「' + form.name + '」？关联的便签会保留，但会解除关联。')) return
    try {
      await api.assets.remove(currentId)
      onSaved()
      onClose()
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function addNote() {
    const content = noteDraft.trim()
    if (!content || currentId === null) return
    try {
      await api.notes.create({ content, assetId: currentId })
      setNoteDraft('')
      await load(currentId)
      onSaved()
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function unlinkNote(id: number) {
    await api.notes.update(id, { assetId: null })
    if (currentId !== null) await load(currentId)
    onSaved()
  }

  const ex = expiry(form.expiresAt || null)

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={currentId === null ? '登记新资产' : '资产详情'}
      footer={
        <>
          {currentId !== null ? (
            <Button variant="danger" size="sm" onClick={remove}><Trash2 size={14} /> 删除</Button>
          ) : null}
          <div className="grow" />
          <Button variant="ghost" size="sm" onClick={onClose}>关闭</Button>
          <Button variant="primary" size="sm" onClick={save} disabled={saving}>
            {saving ? <Spinner /> : <Save size={14} />} 保存
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="empty"><Spinner /></div>
      ) : (
        <div>
          {error ? <div className="alert">{error}</div> : null}

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

          {currentId !== null ? (
            <>
              <div className="section-title" style={{ marginTop: 22 }}>
                <StickyNote size={12} /> 关联便签 <span className="muted">({linked.length})</span>
              </div>

              {linked.length === 0 ? (
                <div className="muted" style={{ fontSize: 12.5, padding: '4px 2px 8px' }}>还没有关联便签。</div>
              ) : (
                <div className="note-list">
                  {linked.map((n) => (
                    <div className="note" key={n.id} style={{ padding: '10px 12px' }}>
                      <div className="note-head" style={{ marginBottom: 6 }}>
                        <span>{fullTime(n.createdAt)}</span>
                        <div className="grow" />
                        <Button variant="ghost" size="sm" icon title="解除关联" onClick={() => unlinkNote(n.id)}>
                          <Link2 size={13} />
                        </Button>
                      </div>
                      <Markdown text={n.content} />
                      {n.tags.length > 0 ? (
                        <div className="note-foot">
                          {n.tags.map((t) => <TagChip key={t.id} name={'#' + t.name} color={t.color} />)}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}

              <div className="composer" style={{ marginTop: 10, padding: 10 }}>
                <textarea
                  value={noteDraft}
                  placeholder="给这件资产记一条便签…"
                  onChange={(e) => setNoteDraft(e.target.value)}
                  style={{ minHeight: 44, fontSize: 13.5 }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addNote()
                  }}
                />
                <div className="composer-foot" style={{ paddingTop: 6 }}>
                  <span className="composer-hint">Ctrl/⌘ + Enter 添加</span>
                  <div className="grow" />
                  <Button size="sm" variant="primary" onClick={addNote} disabled={!noteDraft.trim()}>
                    <Plus size={13} /> 添加
                  </Button>
                </div>
              </div>

              {meta ? (
                <div className="muted" style={{ fontSize: 11.5, marginTop: 18 }}>
                  创建于 {fullTime(meta.createdAt)} · 更新于 {fullTime(meta.updatedAt)}
                  {form.price !== '' ? ' · 参考价 ' + money(Number(form.price), form.currency) : ''}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </Drawer>
  )
}
