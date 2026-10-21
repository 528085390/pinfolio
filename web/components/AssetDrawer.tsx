import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { api, type Asset, type FieldDef, type Note, type Tag } from '../lib/api'
import { Button } from './ui'
import { FormDrawer } from './FormDrawer'
import { BasicFields } from './asset-drawer/BasicFields'
import { LinkedNotes } from './asset-drawer/LinkedNotes'
import { blank, buildPayload, toForm, type AssetFormState } from './asset-drawer/form'

/** 资产详情 / 登记抽屉：外壳走 FormDrawer，内部是主表单 + 关联便签两段。 */
export function AssetDrawer({ open, assetId, fields, tags, onClose, onSaved }: {
  open: boolean
  assetId: number | 'new' | null
  fields: FieldDef[]
  tags: Tag[]
  onClose: () => void
  onSaved: () => void
}) {
  const [currentId, setCurrentId] = useState<number | null>(null)
  const [form, setForm] = useState<AssetFormState>(blank())
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

  function set<K extends keyof AssetFormState>(key: K, value: AssetFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function setCustom(key: string, value: any) {
    setForm((f) => ({ ...f, custom: { ...f.custom, [key]: value } }))
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
        const created = await api.assets.create(buildPayload(form, tagsText))
        onSaved()
        await load(created.id)
      } else {
        await api.assets.update(currentId, buildPayload(form, tagsText))
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

  return (
    <FormDrawer
      open={open}
      onClose={onClose}
      title={currentId === null ? '登记新资产' : '资产详情'}
      loading={loading}
      error={error}
      onSave={save}
      saving={saving}
      leading={currentId !== null ? (
        <Button variant="danger" size="sm" onClick={remove}><Trash2 size={14} /> 删除</Button>
      ) : null}
    >
      <BasicFields
        form={form}
        set={set}
        setCustom={setCustom}
        fields={fields}
        tags={tags}
        tagsText={tagsText}
        setTagsText={setTagsText}
      />

      {currentId !== null ? (
        <LinkedNotes
          form={form}
          linked={linked}
          noteDraft={noteDraft}
          setNoteDraft={setNoteDraft}
          onAddNote={addNote}
          onUnlinkNote={unlinkNote}
          meta={meta}
        />
      ) : null}
    </FormDrawer>
  )
}
