import { useCallback, useEffect, useRef, useState } from 'react'
import { Pin, PinOff, Pencil, Trash2, Search, Link2, Check, X, Inbox, Circle, CheckCircle2, Plus, Tag as TagIcon, Archive, RotateCcw } from 'lucide-react'
import { api, cx, type Note, type Tag } from '../lib/api'
import { relativeTime, fullTime } from '../lib/format'
import { Button, Empty, TagChip, Spinner, Modal } from '../components/ui'
import { Markdown } from '../components/Markdown'
import { KindIcon } from '../components/KindIcon'

export function NotesPage({ tags, refreshMeta, onOpenAsset, archivedCount }: {
  tags: Tag[]
  refreshMeta: () => void
  onOpenAsset: (id: number) => void
  archivedCount: number
}) {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [q, setQ] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [pinnedOnly, setPinnedOnly] = useState(false)
  const [doneFilter, setDoneFilter] = useState<'' | '0' | '1'>('')
  const [archivedMode, setArchivedMode] = useState(false)
  const [tagMenu, setTagMenu] = useState(false)
  // 标签弹层往上展开时会被 .content（overflow-y:auto）的上边界裁掉、且滚不回来（2026-10-21 用户报「被遮住一半」）。
  // 打开前按按钮上下剩余空间挑方向，并把弹层高度压进剩余空间里。
  const [tagPopPlacement, setTagPopPlacement] = useState<{ dir: 'up' | 'down'; maxHeight: number }>({ dir: 'up', maxHeight: 260 })
  const [newTagOpen, setNewTagOpen] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('#b45309')

  const [draft, setDraft] = useState('')
  const [draftPinned, setDraftPinned] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const tagBtnRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 220)
    return () => clearTimeout(t)
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
      await load()
      refreshMeta()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
      taRef.current?.focus()
    }
  }

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
  }

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
      setError(e.message)
    }
  }

  async function remove(n: Note) {
    if (!confirm('永久删除这条便签？不可恢复。')) return
    await api.notes.remove(n.id)
    await load()
    refreshMeta()
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
  const usedTags = tags.filter((t) => (t.notes || 0) > 0)

  // 双击卡片切换完成状态（避开按钮、链接、标签、编辑框这些自带交互的元素）
  function onCardDoubleClick(e: React.MouseEvent<HTMLElement>, n: Note) {
    if (editingId === n.id) return
    const target = e.target as HTMLElement
    if (target.closest('button, a, input, textarea, select, .tag')) return
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) sel.removeAllRanges()
    toggleDone(n)
  }

  function renderNote(n: Note) {
    const editing = editingId === n.id
    return (
      <article
        key={n.id}
        className={cx('note', n.pinned && 'pinned', n.done && 'done')}
        onDoubleClick={archivedMode ? undefined : (e) => onCardDoubleClick(e, n)}
        title={archivedMode ? '已归档（只读）' : n.done ? '双击取消完成' : '双击标记完成'}
      >
        <div className="note-head">
          {archivedMode ? null : (
            <button
              className={cx('note-check', n.done && 'on')}
              title={n.done ? '标记为未完成' : '标记为已完成'}
              onClick={() => toggleDone(n)}
              type="button"
            >
              {n.done ? <CheckCircle2 size={16} /> : <Circle size={16} />}
            </button>
          )}
          {n.pinned ? <Pin size={12} style={{ color: 'var(--accent)' }} /> : null}
          <span title={fullTime(n.createdAt)}>{relativeTime(n.createdAt)}</span>
          {n.updatedAt !== n.createdAt ? <span className="muted">· 已编辑</span> : null}
          {n.done ? <span className="done-pill">已完成</span> : null}
          <div className="note-actions">
            {archivedMode ? (
              <>
                <Button variant="ghost" size="sm" icon title="恢复" onClick={() => restore(n)}>
                  <RotateCcw size={14} />
                </Button>
                <Button variant="danger" size="sm" icon title="永久删除" onClick={() => remove(n)}>
                  <Trash2 size={14} />
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" icon title={n.pinned ? '取消置顶' : '置顶'} onClick={() => togglePin(n)}>
                  {n.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                </Button>
                <Button variant="ghost" size="sm" icon title="编辑" onClick={() => { setEditingId(n.id); setEditText(n.content) }}>
                  <Pencil size={14} />
                </Button>
                <Button variant="ghost" size="sm" icon title="归档" onClick={() => archive(n)}>
                  <Archive size={14} />
                </Button>
              </>
            )}
          </div>
        </div>

        {editing && !archivedMode ? (
          <div>
            <textarea
              className="textarea"
              value={editText}
              autoFocus
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEdit()
                if (e.key === 'Escape') setEditingId(null)
              }}
              style={{ minHeight: 90 }}
            />
            <div className="row" style={{ marginTop: 8 }}>
              <Button size="sm" variant="primary" onClick={saveEdit}><Check size={13} /> 保存</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}><X size={13} /> 取消</Button>
              <span className="muted" style={{ fontSize: 11 }}>Ctrl/⌘ + Enter 保存</span>
            </div>
          </div>
        ) : (
          <div className="note-body">
            <Markdown text={n.content} />
          </div>
        )}

        {(n.asset || n.tags.length > 0) && (
          <div className="note-foot">
            {n.asset ? (
              <button className="note-asset" onClick={() => onOpenAsset(n.asset!.id)} title="打开关联资产">
                <KindIcon kind={n.asset.kind} size={12} />
                {n.asset.name}
                <Link2 size={11} />
              </button>
            ) : null}
            {n.tags.map((t) => (
              <TagChip key={t.id} name={'#' + t.name} color={t.color} onClick={() => setTag(tag === t.name ? null : t.name)} active={tag === t.name} />
            ))}
          </div>
        )}
      </article>
    )
  }

  return (
    <div className="page">
      {archivedMode ? null : (
      <div className="composer">
        <textarea
          ref={taRef}
          value={draft}
          placeholder="记点什么…  用 #标签 自动归类，Ctrl/⌘ + Enter 保存"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
          }}
        />
        <div className="composer-foot">
          <button
            className={cx('chip', draftPinned && 'active')}
            onClick={() => setDraftPinned((v) => !v)}
            type="button"
            title="置顶这条便签"
          >
            <Pin size={12} /> 置顶
          </button>
          <div style={{ position: 'relative' }}>
            <button
              ref={tagBtnRef}
              className={cx('chip', tagMenu && 'active')}
              onClick={openTagMenu}
              type="button"
              title="从已有标签里挑一个插进便签"
            >
              <TagIcon size={12} /> 标签
            </button>
            {tagMenu ? (
              <div
                className={cx('tag-pop', tagPopPlacement.dir === 'down' && 'tag-pop-down')}
                style={{ maxHeight: tagPopPlacement.maxHeight }}
              >
                <div className="tag-pop-head">点一下插进便签</div>
                <div className="tag-pop-list">
                  {tags.length === 0 ? <span className="muted" style={{ fontSize: 12 }}>还没有标签</span> : null}
                  {tags.map((t) => (
                    <button key={t.id} className="chip" onClick={() => { insertTag(t.name); setTagMenu(false) }}>
                      #{t.name}
                    </button>
                  ))}
                </div>
                <button
                  className="tag-pop-new"
                  onClick={() => { setTagMenu(false); setNewTagOpen(true) }}
                  type="button"
                >
                  <Plus size={12} /> 新建标签…
                </button>
              </div>
            ) : null}
          </div>
          <span className="composer-hint">
            也可以直接手打 <code>#标签</code>
          </span>
          <div className="grow" />
          <Button variant="primary" size="sm" onClick={submit} disabled={!draft.trim() || saving}>
            {saving ? <Spinner /> : <Check size={14} />} 记下
          </Button>
        </div>
      </div>
      )}

      <div className="filters" style={{ marginTop: 18 }}>
        {archivedMode ? null : (
          <>
            <button className={cx('chip', !pinnedOnly && !tag && !doneFilter && 'active')} onClick={() => { setPinnedOnly(false); setTag(null); setDoneFilter('') }}>全部</button>
            <button className={cx('chip', doneFilter === '0' && 'active')} onClick={() => setDoneFilter(doneFilter === '0' ? '' : '0')}>未完成</button>
            <button className={cx('chip', doneFilter === '1' && 'active')} onClick={() => setDoneFilter(doneFilter === '1' ? '' : '1')}>
              <CheckCircle2 size={12} /> 已完成
            </button>
            <button className={cx('chip', pinnedOnly && 'active')} onClick={() => setPinnedOnly((v) => !v)}>
              <Pin size={12} /> 置顶
            </button>
          </>
        )}
        <button
          className={cx('chip', archivedMode && 'active')}
          onClick={toggleArchivedMode}
          title="归档的便签默认不显示；在这里查看、恢复或永久删除"
        >
          <Archive size={12} /> 已归档{archivedCount > 0 ? <span className="chip-count">{archivedCount}</span> : null}
        </button>
        {archivedMode ? null : (
          <>
            <div style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 2px' }} />
            {usedTags.map((t) => (
              <button
                key={t.id}
                className={cx('chip', tag === t.name && 'active')}
                onClick={() => setTag(tag === t.name ? null : t.name)}
              >
                #{t.name} <span className="chip-count">{t.notes}</span>
              </button>
            ))}
            <button className="chip chip-add" onClick={() => setNewTagOpen(true)} title="新建一个标签">
              <Plus size={12} /> 新标签
            </button>
          </>
        )}
        <div className="grow" />
        <div style={{ position: 'relative', width: 190 }}>
          <Search size={13} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--muted)' }} />
          <input
            className="input input-sm"
            style={{ paddingLeft: 27 }}
            placeholder="搜索便签"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
      </div>

      {error ? <div className="alert" style={{ marginTop: 14 }}>{error}</div> : null}

      {loading && notes.length === 0 ? (
        <div className="empty"><Spinner /></div>
      ) : notes.length === 0 ? (
        <Empty
          icon={archivedMode ? <Archive size={22} /> : <Inbox size={22} />}
          title={archivedMode
            ? (q ? '没有匹配的归档便签' : '还没有归档的便签')
            : q || tag || doneFilter ? '没有匹配的便签' : '还没有便签'}
          text={archivedMode
            ? (q ? '换个关键词试试。' : '点便签右上角的「归档」把用不着的收起来；归档后默认不显示，只在这里看得到。')
            : q || tag || doneFilter ? '换个关键词，或清掉筛选条件。' : '在上面写第一条。用 #标签 归类，点 📌 置顶，点左边的圆圈标记完成。'}
        />
      ) : archivedMode ? (
        <>
          <div className="section-title"><Archive size={12} /> 已归档 · 只读</div>
          <div className="note-list">{notes.map(renderNote)}</div>
        </>
      ) : (
        <>
          {pinned.length > 0 && !pinnedOnly ? (
            <>
              <div className="section-title"><Pin size={12} /> 置顶</div>
              <div className="note-list">{pinned.map(renderNote)}</div>
              <div className="section-title">全部</div>
            </>
          ) : null}
          <div className="note-list" style={{ marginTop: pinned.length > 0 && !pinnedOnly ? 0 : 18 }}>
            {(pinnedOnly ? pinned : pinned.length > 0 && !pinnedOnly ? rest : notes).map(renderNote)}
          </div>
        </>
      )}

      <Modal
        open={newTagOpen}
        onClose={() => setNewTagOpen(false)}
        title="新建标签"
        width={380}
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewTagOpen(false)}>取消</Button>
            <Button variant="primary" onClick={createTag} disabled={!newTagName.trim()}>创建</Button>
          </>
        }
      >
        <div className="field">
          <label>名称</label>
          <input
            className="input"
            value={newTagName}
            autoFocus
            placeholder="例如：待办"
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') createTag() }}
          />
          <span className="hint">创建后会直接插到便签里；也可以只在设置页管理。</span>
        </div>
        <div className="field">
          <label>颜色</label>
          <input
            type="color"
            value={newTagColor}
            onChange={(e) => setNewTagColor(e.target.value)}
            style={{ width: 52, height: 34, padding: 2, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8 }}
          />
        </div>
      </Modal>
    </div>
  )
}
