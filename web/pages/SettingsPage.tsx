import { useState } from 'react'
import { Download, Plus, Trash2, Check, Database, Sun, Moon, Monitor, Sparkles } from 'lucide-react'
import { api, type FieldDef, type Stats, type Tag } from '../lib/api'
import { Button, Field, Spinner, TagChip } from '../components/ui'

const TYPES: { v: string; label: string }[] = [
  { v: 'text', label: '文本' },
  { v: 'number', label: '数字' },
  { v: 'date', label: '日期' },
  { v: 'url', label: '链接' },
  { v: 'select', label: '单选' },
  { v: 'bool', label: '开关' },
]

export function SettingsPage({ tags, fields, stats, refreshMeta, theme, setTheme }: {
  tags: Tag[]
  fields: FieldDef[]
  stats: Stats | null
  refreshMeta: () => void
  theme: string
  setTheme: (t: string) => void
}) {
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')

  const [fKey, setFKey] = useState('')
  const [fLabel, setFLabel] = useState('')
  const [fType, setFType] = useState('text')
  const [fOptions, setFOptions] = useState('')

  const [tagName, setTagName] = useState('')
  const [tagColor, setTagColor] = useState('#b45309')

  const empty = !stats || (stats.notes === 0 && stats.assets === 0)

  async function addField() {
    if (!fKey.trim() || !fLabel.trim()) { setMsg('字段 key 和显示名都要填'); return }
    try {
      await api.fields.create({
        key: fKey.trim(),
        label: fLabel.trim(),
        type: fType,
        options: fType === 'select' ? fOptions.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [],
      })
      setFKey(''); setFLabel(''); setFType('text'); setFOptions('')
      setMsg('字段已添加')
      refreshMeta()
    } catch (e: any) { setMsg(e.message) }
  }

  async function removeField(f: FieldDef) {
    if (!confirm('删除字段「' + f.label + '」？已填的值会留在数据里但不再显示。')) return
    await api.fields.remove(f.id)
    refreshMeta()
  }

  async function addTag() {
    const name = tagName.trim().replace(/^#/, '')
    if (!name) return
    try {
      await api.tags.create({ name, color: tagColor })
      setTagName('')
      refreshMeta()
    } catch (e: any) { setMsg(e.message) }
  }

  async function removeTag(t: Tag) {
    if (!confirm('删除标签「#' + t.name + '」？便签和资产本身不会被删除。')) return
    await api.tags.remove(t.id)
    refreshMeta()
  }

  async function exportData() {
    setBusy('export')
    try {
      const data = await api.exportAll()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'pinboard-' + new Date().toISOString().slice(0, 10) + '.json'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setMsg('已导出 JSON 备份')
    } catch (e: any) { setMsg(e.message) }
    finally { setBusy('') }
  }

  async function seed() {
    setBusy('seed')
    try {
      const r = await api.seed()
      if (r.error) setMsg(r.error)
      else { setMsg('示例数据已写入'); refreshMeta() }
    } catch (e: any) { setMsg(e.message) }
    finally { setBusy('') }
  }

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      {msg ? <div className="alert" style={{ marginBottom: 14 }}>{msg}</div> : null}

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>外观</div>
        <div className="row" style={{ gap: 6 }}>
          {[
            { v: 'light', label: '浅色', icon: <Sun size={14} /> },
            { v: 'dark', label: '深色', icon: <Moon size={14} /> },
            { v: 'system', label: '跟随系统', icon: <Monitor size={14} /> },
          ].map((o) => (
            <button key={o.v} className={'chip' + (theme === o.v ? ' active' : '')} onClick={() => setTheme(o.v)}>
              {o.icon} {o.label}
            </button>
          ))}
        </div>
      </div>

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
                    <td className="muted">{TYPES.find((t) => t.v === f.type)?.label || f.type}</td>
                    <td className="muted">{f.options.length ? f.options.join(' / ') : '—'}</td>
                    <td>
                      <Button variant="ghost" size="sm" icon title="删除字段" onClick={() => removeField(f)}>
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
            <input className="input" value={fLabel} placeholder="密钥存放位置" onChange={(e) => setFLabel(e.target.value)} />
          </Field>
          <Field label="key（英文，不可重复）">
            <input className="input" value={fKey} placeholder="secret_at" onChange={(e) => setFKey(e.target.value)} />
          </Field>
          <Field label="类型">
            <select className="select" value={fType} onChange={(e) => setFType(e.target.value)}>
              {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select>
          </Field>
          {fType === 'select' ? (
            <Field label="选项（逗号分隔）">
              <input className="input" value={fOptions} placeholder="月付, 季付, 年付" onChange={(e) => setFOptions(e.target.value)} />
            </Field>
          ) : <div />}
        </div>
        <div style={{ marginTop: 10 }}>
          <Button variant="primary" size="sm" onClick={addField}><Plus size={14} /> 添加字段</Button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-title" style={{ marginTop: 0 }}>标签</div>
        <div className="filters" style={{ marginBottom: 12 }}>
          {tags.length === 0 ? <span className="muted" style={{ fontSize: 13 }}>还没有标签。在便签里写 #标签 会自动创建。</span> : null}
          {tags.map((t) => (
            <span key={t.id} className="row" style={{ gap: 2 }}>
              <TagChip name={'#' + t.name} color={t.color} />
              <span className="muted" style={{ fontSize: 11 }}>{t.notes || 0}/{t.assets || 0}</span>
              <Button variant="ghost" size="sm" icon title="删除标签" onClick={() => removeTag(t)}>
                <Trash2 size={12} />
              </Button>
            </span>
          ))}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <input className="input" style={{ maxWidth: 220 }} value={tagName} placeholder="新标签名"
            onChange={(e) => setTagName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addTag() }} />
          <input type="color" value={tagColor} onChange={(e) => setTagColor(e.target.value)}
            style={{ width: 34, height: 34, padding: 2, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)' }} />
          <Button size="sm" onClick={addTag}><Plus size={14} /> 添加</Button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-title" style={{ marginTop: 0 }}><Database size={12} /> 数据</div>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
          数据保存在本机 data/pinboard.db（SQLite），不联网、无账号。建议定期导出 JSON 备份。
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" onClick={exportData} disabled={busy === 'export'}>
            {busy === 'export' ? <Spinner /> : <Download size={14} />} 导出 JSON
          </Button>
          {empty ? (
            <Button size="sm" variant="ghost" onClick={seed} disabled={busy === 'seed'}>
              {busy === 'seed' ? <Spinner /> : <Sparkles size={14} />} 写入示例数据
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
