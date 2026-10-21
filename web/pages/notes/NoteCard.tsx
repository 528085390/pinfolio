import type { MouseEvent } from 'react'
import { Pin, PinOff, Pencil, Trash2, Check, X, Link2, Circle, CheckCircle2, Archive, RotateCcw } from 'lucide-react'
import { cx, type Note } from '../../lib/api'
import { relativeTime, fullTime } from '../../lib/format'
import { Button, TagChip } from '../../components/ui'
import { Markdown } from '../../components/Markdown'
import { KindIcon } from '../../components/KindIcon'

export type NoteCardProps = {
  note: Note
  archivedMode: boolean
  editing: boolean
  editText: string
  activeTag: string | null
  onEditText: (v: string) => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onToggleDone: () => void
  onTogglePin: () => void
  onArchive: () => void
  onRestore: () => void
  onRemove: () => void
  onCardDoubleClick: (e: MouseEvent<HTMLElement>) => void
  onOpenAsset: (id: number) => void
  onTagClick: (name: string) => void
}

/** 单张便签卡片。所有状态由 NotesPage 持有，这里只负责渲染与回调。 */
export function NoteCard(p: NoteCardProps) {
  const n = p.note
  return (
    <article
      className={cx('note', n.pinned && 'pinned', n.done && 'done')}
      onDoubleClick={p.archivedMode ? undefined : p.onCardDoubleClick}
      title={p.archivedMode ? '已归档（只读）' : n.done ? '双击取消完成' : '双击标记完成'}
    >
      <div className="note-head">
        {p.archivedMode ? null : (
          <button
            className={cx('note-check', n.done && 'on')}
            title={n.done ? '标记为未完成' : '标记为已完成'}
            onClick={p.onToggleDone}
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
          {p.archivedMode ? (
            <>
              <Button variant="ghost" size="sm" icon title="恢复" onClick={p.onRestore}>
                <RotateCcw size={14} />
              </Button>
              <Button variant="danger" size="sm" icon title="永久删除" onClick={p.onRemove}>
                <Trash2 size={14} />
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" icon title={n.pinned ? '取消置顶' : '置顶'} onClick={p.onTogglePin}>
                {n.pinned ? <PinOff size={14} /> : <Pin size={14} />}
              </Button>
              <Button variant="ghost" size="sm" icon title="编辑" onClick={p.onStartEdit}>
                <Pencil size={14} />
              </Button>
              <Button variant="ghost" size="sm" icon title="归档" onClick={p.onArchive}>
                <Archive size={14} />
              </Button>
            </>
          )}
        </div>
      </div>

      {p.editing && !p.archivedMode ? (
        <div>
          <textarea
            className="textarea"
            value={p.editText}
            autoFocus
            onChange={(e) => p.onEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) p.onSaveEdit()
              if (e.key === 'Escape') p.onCancelEdit()
            }}
            style={{ minHeight: 90 }}
          />
          <div className="row" style={{ marginTop: 8 }}>
            <Button size="sm" variant="primary" onClick={p.onSaveEdit}><Check size={13} /> 保存</Button>
            <Button size="sm" variant="ghost" onClick={p.onCancelEdit}><X size={13} /> 取消</Button>
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
            <button className="note-asset" onClick={() => p.onOpenAsset(n.asset!.id)} title="打开关联资产">
              <KindIcon kind={n.asset.kind} size={12} />
              {n.asset.name}
              <Link2 size={11} />
            </button>
          ) : null}
          {n.tags.map((t) => (
            <TagChip key={t.id} name={'#' + t.name} color={t.color} onClick={() => p.onTagClick(t.name)} active={p.activeTag === t.name} />
          ))}
        </div>
      )}
    </article>
  )
}
