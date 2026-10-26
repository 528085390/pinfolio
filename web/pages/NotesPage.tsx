import { useRef, type MouseEvent } from 'react'
import { Archive, Inbox, Pin } from 'lucide-react'
import { type Note, type Tag } from '../lib/api'
import { Button, Empty, Spinner, Modal } from '../components/ui'
import { useNotes } from './notes/useNotes'
import { useComposer } from './notes/useComposer'
import { NoteCard } from './notes/NoteCard'
import { Composer } from './notes/Composer'
import { FilterBar } from './notes/FilterBar'
import { useMasonry } from './notes/useMasonry'
import { t } from '../lib/i18n'

export function NotesPage({ tags, refreshMeta, onOpenAsset, archivedCount }: {
  tags: Tag[]
  refreshMeta: () => void
  onOpenAsset: (id: number) => void
  archivedCount: number
}) {
  const N = useNotes(refreshMeta)
  const C = useComposer({ reload: N.reload, refreshMeta, onError: N.setError })

  // 三个列表各自排瀑布流（归档 / 置顶 / 其余），卡片高度变了就重量一遍。
  const archivedRef = useRef<HTMLDivElement | null>(null)
  const pinnedRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  useMasonry(archivedRef, [N.notes])
  useMasonry(pinnedRef, [N.pinned])
  useMasonry(listRef, [N.notes, N.pinned, N.rest, N.pinnedOnly, N.editingId])

  const usedTags = tags.filter((tg) => (tg.notes || 0) > 0)

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
        onError={N.setError}
      />
    )
  }

  return (
    <div className="page page-notes">
      {N.archivedMode ? null : <Composer c={C} tags={tags} onError={N.setError} />}

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
            ? (N.q ? t('没有匹配的归档便签') : t('还没有归档的便签'))
            : N.q || N.tag || N.doneFilter ? t('没有匹配的便签') : t('还没有便签')}
          text={N.archivedMode
            ? (N.q ? t('换个关键词试试。') : t('点便签右上角的「归档」把用不着的收起来；归档后默认不显示，只在这里看得到。'))
            : N.q || N.tag || N.doneFilter ? t('换个关键词，或清掉筛选条件。') : t('在上面写第一条。用 #标签 归类，点 📌 置顶，点左边的圆圈标记完成。')}
        />
      ) : N.archivedMode ? (
        <>
          <div className="section-title"><Archive size={12} /> {t('已归档 · 只读')}</div>
          <div className="note-list note-grid" ref={archivedRef}>{N.notes.map(renderNote)}</div>
        </>
      ) : (
        <>
          {N.pinned.length > 0 && !N.pinnedOnly ? (
            <>
              <div className="section-title"><Pin size={12} /> {t('置顶')}</div>
              <div className="note-list note-grid" ref={pinnedRef}>{N.pinned.map(renderNote)}</div>
              <div className="section-title">{t('全部')}</div>
            </>
          ) : null}
          <div className="note-list note-grid" ref={listRef} style={{ marginTop: N.pinned.length > 0 && !N.pinnedOnly ? 0 : 18 }}>
            {(N.pinnedOnly ? N.pinned : N.pinned.length > 0 && !N.pinnedOnly ? N.rest : N.notes).map(renderNote)}
          </div>
        </>
      )}

      <Modal
        open={C.newTagOpen}
        onClose={() => C.setNewTagOpen(false)}
        title={t('新建标签')}
        width={380}
        footer={
          <>
            <Button variant="ghost" onClick={() => C.setNewTagOpen(false)}>{t('取消')}</Button>
            <Button variant="primary" onClick={C.createTag} disabled={!C.newTagName.trim()}>{t('创建')}</Button>
          </>
        }
      >
        <div className="field">
          <label>{t('名称')}</label>
          <input
            className="input"
            value={C.newTagName}
            autoFocus
            placeholder={t('例如：待办')}
            onChange={(e) => C.setNewTagName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') C.createTag() }}
          />
          <span className="hint">{t('创建后会直接插到便签里；也可以只在设置页管理。')}</span>
        </div>
        <div className="field">
          <label>{t('颜色')}</label>
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
