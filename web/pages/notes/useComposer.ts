import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'

type Options = {
  /** 保存成功后重新拉列表 */
  reload: () => Promise<void> | void
  refreshMeta: () => void
  onError: (msg: string) => void
}

/**
 * 顶部 composer：草稿、置顶开关、标签弹层（含「往上还是往下展开」）、新建标签。
 * 标签弹层的方向/高度必须在这里算——.content 是滚动容器，往上顶出去就被裁掉且滚不回来。
 */
export function useComposer({ reload, refreshMeta, onError }: Options) {
  const [draft, setDraft] = useState('')
  const [draftPinned, setDraftPinned] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tagMenu, setTagMenu] = useState(false)
  const [tagPopPlacement, setTagPopPlacement] = useState<{ dir: 'up' | 'down'; maxHeight: number }>({ dir: 'up', maxHeight: 260 })
  // 弹层打开的时刻，用来忽略「打开瞬间的滚动」（见下面 onScroll）
  const openedAt = useRef(0)
  const [newTagOpen, setNewTagOpen] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('#b45309')
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const tagBtnRef = useRef<HTMLButtonElement | null>(null)
  const tagWrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.max(54, el.scrollHeight) + 'px'
  }, [draft])

  async function submit() {
    const content = draft.trim()
    if (!content || saving) return
    setSaving(true)
    try {
      await api.notes.create({ content, pinned: draftPinned })
      setDraft('')
      setDraftPinned(false)
      await reload()
      refreshMeta()
    } catch (e: any) {
      onError(e.message)
    } finally {
      setSaving(false)
      taRef.current?.focus()
    }
  }

  function openTagMenu() {
    if (tagMenu) { setTagMenu(false); return }
    const btn = tagBtnRef.current
    if (btn) {
      const b = btn.getBoundingClientRect()
      // 找出所有会裁剪祖先（.content 是滚动容器，.app 是 overflow:hidden），取它们的交集当可视边界
      let clipTop = 0
      let clipBottom = window.innerHeight
      for (let el = btn.parentElement; el; el = el.parentElement) {
        const s = getComputedStyle(el)
        if (/(auto|scroll|hidden)/.test(s.overflowY)) {
          const r = el.getBoundingClientRect()
          clipTop = Math.max(clipTop, r.top)
          clipBottom = Math.min(clipBottom, r.bottom)
        }
      }
      const gap = 8
      const above = b.top - clipTop - gap
      const below = clipBottom - b.bottom - gap
      const dir: 'up' | 'down' = above >= 260 || above >= below ? 'up' : 'down'
      const space = dir === 'up' ? above : below
      setTagPopPlacement({ dir, maxHeight: Math.max(96, Math.min(320, Math.round(space))) })
    }
    setTagMenu(true)
    openedAt.current = Date.now()
  }

  // 弹层开着时：点弹层外任意地方 / Esc / 页面滚动 都收起（2026-10-21 用户要求「点标签栏以外就缩回去」）
  useEffect(() => {
    if (!tagMenu) return
    const inside = (t: EventTarget | null) => !!t && !!tagWrapRef.current?.contains(t as Node)
    function onPointerDown(e: PointerEvent) {
      // 点「标签」按钮本身交给 openTagMenu 切换；点弹层内部（含它自己的列表滚动条）不关
      if (inside(e.target)) return
      setTagMenu(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setTagMenu(false)
    }
    // scroll 不冒泡但会捕获：.content 滚动要收起，弹层自己列表的滚动不能收起。
    // 刚打开的头 250ms 忽略滚动：点按钮时浏览器/Playwright 会把按钮滚进视口，
    // 那个 scroll 事件可能晚于本 effect 到达，不放过它就会「刚打开就自己关掉」。
    function onScroll(e: Event) {
      if (inside(e.target)) return
      if (Date.now() - openedAt.current < 250) return
      setTagMenu(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [tagMenu])

  function insertTag(name: string) {
    setDraft((d) => {
      const base = d.replace(/\s+$/, '')
      return (base ? base + ' ' : '') + '#' + name + ' '
    })
    taRef.current?.focus()
  }

  async function createTag() {
    const name = newTagName.trim().replace(/^#/, '')
    if (!name) return
    try {
      await api.tags.create({ name, color: newTagColor })
      setNewTagName('')
      setNewTagOpen(false)
      refreshMeta()
      insertTag(name)
    } catch (e: any) {
      onError(e.message)
    }
  }

  function pickTag(name: string) {
    insertTag(name)
    setTagMenu(false)
  }

  function closeTagMenu() {
    setTagMenu(false)
  }

  return {
    draft, setDraft, draftPinned, setDraftPinned, saving,
    submit,
    tagMenu, tagPopPlacement, openTagMenu, closeTagMenu, pickTag, insertTag,
    taRef, tagBtnRef, tagWrapRef,
    newTagOpen, setNewTagOpen, newTagName, setNewTagName, newTagColor, setNewTagColor,
    createTag,
  }
}
