import { useState } from 'react'
import { api, type FieldDef, type Tag } from '../../lib/api'
import { exportFilename, fieldDeletePrompt, normalizeTagName, parseFieldOptions, tagDeletePrompt, validateNewField } from './fields'

// 设置页的状态与动作。四张卡片（外观/字段/标签/数据）都从这里取，卡片本身只画界面。
export function useSettings({ refreshMeta }: { refreshMeta: () => void }) {
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')

  const [fKey, setFKey] = useState('')
  const [fLabel, setFLabel] = useState('')
  const [fType, setFType] = useState('text')
  const [fOptions, setFOptions] = useState('')

  const [tagName, setTagName] = useState('')
  const [tagColor, setTagColor] = useState('#b45309')

  async function addField() {
    const bad = validateNewField(fKey, fLabel)
    if (bad) { setMsg(bad); return }
    try {
      await api.fields.create({
        key: fKey.trim(),
        label: fLabel.trim(),
        type: fType,
        options: fType === 'select' ? parseFieldOptions(fOptions) : [],
      })
      setFKey(''); setFLabel(''); setFType('text'); setFOptions('')
      setMsg('字段已添加')
      refreshMeta()
    } catch (e: any) { setMsg(e.message) }
  }

  async function removeField(f: FieldDef) {
    if (!confirm(fieldDeletePrompt(f.label))) return
    await api.fields.remove(f.id)
    refreshMeta()
  }

  async function addTag() {
    const name = normalizeTagName(tagName)
    if (!name) return
    try {
      await api.tags.create({ name, color: tagColor })
      setTagName('')
      refreshMeta()
    } catch (e: any) { setMsg(e.message) }
  }

  async function removeTag(t: Tag) {
    if (!confirm(tagDeletePrompt(t.name))) return
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
      a.download = exportFilename()
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

  return {
    busy, msg, setMsg,
    fKey, setFKey, fLabel, setFLabel, fType, setFType, fOptions, setFOptions,
    tagName, setTagName, tagColor, setTagColor,
    addField, removeField, addTag, removeTag, exportData, seed,
  }
}

export type SettingsState = ReturnType<typeof useSettings>
