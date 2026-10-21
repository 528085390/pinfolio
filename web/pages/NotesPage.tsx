import type { MouseEvent } from 'react'
import { Archive, Inbox, Pin } from 'lucide-react'
import { type Note, type Tag } from '../lib/api'
import { Button, Empty, Spinner, Modal } from '../components/ui'
import { useNotes } from './notes/useNotes'
import { useComposer } from './notes/useComposer'
import { NoteCard } from './notes/NoteCard'
import { Composer } from './notes/Composer'
import { FilterBar } from './notes/FilterBar'

export function NotesPage({ tags, refreshMeta, onOpenAsset, archivedCount }: {
  tags: Tag[]
  refreshMeta: () => void
  onOpenAsset: (id: number) => void
  archivedCount: number
}) {
  const N = useNotes(refreshMeta)
  const C = useComposer({ reload: N.reload, refreshMeta, onError: N.setError })

  const usedTags = tags.filter((t) => (t.notes || 0) > 0)

  // 双击卡片切换完成状态（避开按钮、链接、标签、编辑框这些自带交互的元素）
  function onCardDoubleClick(e: MouseEvent<HTMLElement>, n: Note) {
    if (N.editingId === n.id) return
    const target = e.target as HTMLElement
    if (target.closest('button, a, input, textarea, select, .tag')) return
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) sel.removeAllRanges()
    N.toggleDone(n)
  }

  function renderNote(n: Note) {
    return (
      <NoteCard
        key={n.id}
        note={n}
        archivedMode={N.archivedMode}
        editing={N.editingId === n.id}
        editText={N.editText}
        activeTag={N.tag}
        onEditText={N.setEditText}
        onStartEdit={() => N.startEdit(n)}
        onCancelEdit={N.cancelEdit}
        onSaveEdit={N.saveEdit}
        onToggleDone={() => N.toggleDone(n)}
        onTogglePin={() => N.togglePin(n)}
        onArchive={() => N.archive(n)}
        onRestore={() => N.restore(n)}
        onRemove={() => N.remove(n)}
        onCardDoubleClick={(e) => onCardDoubleClick(e, n)}
        onOpenAsset={onOpenAsset}
        onTagClick={(name) => N.setTag(N.tag === name ? null : name)}
      />
    )
  }

  return (
    <div className="page">
      {N.archivedMode ? null : <Composer c={C} tags={tags} />}

      <FilterBar
        archivedMode={N.archivedMode}
        archivedCount={archivedCount}
        pinnedOnly={N.pinnedOnly}
        tag={N.tag}
        doneFilter={N.doneFilter}
        usedTags={usedTags}
        searchInput={N.searchInput}
        onShowAll={() => { N.setPinnedOnly(false); N.setTag(null); N.setDoneFilter('') }}
        onToggleDoneFilter={(v) => N.setDoneFilter(N.doneFilter === v ? '' : v)}
        onTogglePinned={() => N.setPinnedOnly((v) => !v)}
        onToggleArchived={N.toggleArchivedMode}
        onToggleTag={(name) => N.setTag(N.tag === name ? null : name)}
        onNewTag={() => C.setNewTagOpen(true)}
        onSearchInput={N.setSearchInput}
      />

      {N.error ? <div className="alert" style={{ marginTop: 14 }}>{N.error}</div> : null}

      {N.loading && N.notes.length === 0 ? (
        <div className="empty"><Spinner /></div>
      ) : N.notes.length === 0 ? (
        <Empty
          icon={N.archivedMode ? <Archive size={22} /> : <Inbox size={22} />}
          title={N.archivedMode
            ? (N.q ? '没有匹配的归档便签' : '还没有归档的便签')
            : N.q || N.tag || N.doneFilter ? '没有匹配的便签' : '还没有便签'}
          text={N.archivedMode
            ? (N.q ? '换个关键词试试。' : '点便签右上角的「归档」把用不着的收起来；归档后默认不显示，只在这里看得到。')
            : N.q || N.tag || N.doneFilter ? '换个关键词，或清掉筛选条件。' : '在上面写第一条。用 #标签 归类，点 📌 置顶，点左边的圆圈标记完成。'}
        />
      ) : N.archivedMode ? (
        <>
          <div className="section-title"><Archive size={12} /> 已归档 · 只读</div>
          <div className="note-list">{N.notes.map(renderNote)}</div>
        </>
      ) : (
        <>
          {N.pinned.length > 0 && !N.pinnedOnly ? (
            <>
              <div className="section-title"><Pin size={12} /> 置顶</div>
              <div className="note-list">{N.pinned.map(renderNote)}</div>
              <div className="section-title">全部</div>
            </>
          ) : null}
          <div className="note-list" style={{ marginTop: N.pinned.length > 0 && !N.pinnedOnly ? 0 : 18 }}>
            {(N.pinnedOnly ? N.pinned : N.pinned.length > 0 && !N.pinnedOnly ? N.rest : N.notes).map(renderNote)}
          </div>
        </>
      )}

      <Modal
        open={C.newTagOpen}
        onClose={() => C.setNewTagOpen(false)}
        title="新建标签"
        width={380}
        footer={
          <>
            <Button variant="ghost" onClick={() => C.setNewTagOpen(false)}>取消</Button>
            <Button variant="primary" onClick={C.createTag} disabled={!C.newTagName.trim()}>创建</Button>
          </>
        }
      >
        <div className="field">
          <label>名称</label>
          <input
            className="input"
            value={C.newTagName}
            autoFocus
            placeholder="例如：待办"
            onChange={(e) => C.setNewTagName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') C.createTag() }}
          />
          <span className="hint">创建后会直接插到便签里；也可以只在设置页管理。</span>
        </div>
        <div className="field">
          <label>颜色</label>
          <input
            type="color"
            value={C.newTagColor}
            onChange={(e) => C.setNewTagColor(e.target.value)}
            style={{ width: 52, height: 34, padding: 2, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8 }}
          />
        </div>
      </Modal>
    </div>
  )
}
