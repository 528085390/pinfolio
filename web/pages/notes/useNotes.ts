import { useCallback, useEffect, useState } from 'react'
import { api, type Note } from '../../lib/api'
import { t } from '../../lib/i18n'

export type DoneFilter = '' | '0' | '1'

/** 便签列表 + 筛选 + 单条操作。草稿输入框的状态在 useComposer 里，不在这里。 */
export function useNotes(refreshMeta: () => void) {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [q, setQ] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [pinnedOnly, setPinnedOnly] = useState(false)
  const [doneFilter, setDoneFilter] = useState<DoneFilter>('')
  const [archivedMode, setArchivedMode] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setQ(searchInput.trim()), 220)
    return () => clearTimeout(timer)
  }, [searchInput])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.notes.list({
        q,
        tag: tag || undefined,
        pinned: pinnedOnly ? '1' : undefined,
        done: doneFilter || undefined,
        archived: archivedMode ? '1' : undefined,
      })
      setNotes(data)
      setError('')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [q, tag, pinnedOnly, doneFilter, archivedMode])

  useEffect(() => { load() }, [load])

  async function togglePin(n: Note) {
    await api.notes.update(n.id, { pinned: !n.pinned })
    await load()
  }

  async function archive(n: Note) {
    await api.notes.update(n.id, { archived: true })
    await load()
    refreshMeta()
  }

  async function restore(n: Note) {
    await api.notes.update(n.id, { archived: false })
    await load()
    refreshMeta()
  }

  // 归档视图是独立模式：清掉其它筛选，避免进来看到空列表还以为是归档丢了
  function toggleArchivedMode() {
    setArchivedMode((v) => !v)
    setTag(null)
    setPinnedOnly(false)
    setDoneFilter('')
    setEditingId(null)
  }

  async function toggleDone(n: Note) {
    const next = !n.done
    // 先本地翻转，卡片不会因为重新排序而跳到别处（双击时尤其重要）
    setNotes((prev) => prev.map((x) => (x.id === n.id ? { ...x, done: next } : x)))
    try {
      await api.notes.update(n.id, { done: next })
      // 只有正在按完成状态筛选时，才需要重新拉取让卡片离开/进入列表
      if (doneFilter !== '') await load()
    } catch (e: any) {
      setNotes((prev) => prev.map((x) => (x.id === n.id ? { ...x, done: !next } : x)))
      setError(e.message)
    }
  }

  async function remove(n: Note) {
    if (!confirm(t('永久删除这条便签？不可恢复。'))) return
    await api.notes.remove(n.id)
    await load()
    refreshMeta()
  }

  function startEdit(n: Note) {
    setEditingId(n.id)
    setEditText(n.content)
  }

  function cancelEdit() {
    setEditingId(null)
  }

  async function saveEdit() {
    if (editingId === null) return
    const content = editText.trim()
    if (!content) return
    await api.notes.update(editingId, { content })
    setEditingId(null)
    await load()
    refreshMeta()
  }

  const pinned = notes.filter((n) => n.pinned)
  const rest = notes.filter((n) => !n.pinned)

  return {
    notes, loading, error, setError,
    searchInput, setSearchInput, q,
    tag, setTag, pinnedOnly, setPinnedOnly, doneFilter, setDoneFilter,
    archivedMode, toggleArchivedMode,
    editingId, editText, setEditText,
    reload: load,
    togglePin, archive, restore, toggleDone, remove,
    startEdit, cancelEdit, saveEdit,
    pinned, rest,
  }
}
