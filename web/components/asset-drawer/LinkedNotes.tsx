import { Link2, Plus, StickyNote } from 'lucide-react'
import type { Note } from '../../lib/api'
import { fullTime, money } from '../../lib/format'
import { Button, TagChip } from '../ui'
import { Markdown } from '../Markdown'
import type { AssetFormState } from './form'
import { t } from '../../lib/i18n'

/** 已有资产才显示：关联便签列表 + 就地记一条 + 创建/更新时间。 */
export function LinkedNotes({ form, linked, noteDraft, setNoteDraft, onAddNote, onUnlinkNote, meta }: {
  form: AssetFormState
  linked: Note[]
  noteDraft: string
  setNoteDraft: (v: string) => void
  onAddNote: () => void
  onUnlinkNote: (id: number) => void
  meta: { createdAt: string; updatedAt: string } | null
}) {
  return (
    <>
      <div className="section-title" style={{ marginTop: 22 }}>
        <StickyNote size={12} /> {t('关联便签')} <span className="muted">({linked.length})</span>
      </div>

      {linked.length === 0 ? (
        <div className="muted" style={{ fontSize: 12.5, padding: '4px 2px 8px' }}>{t('还没有关联便签。')}</div>
      ) : (
        <div className="note-list">
          {linked.map((n) => (
            <div className="note" key={n.id} style={{ padding: '10px 12px' }}>
              <div className="note-head" style={{ marginBottom: 6 }}>
                <span>{fullTime(n.createdAt)}</span>
                <div className="grow" />
                <Button variant="ghost" size="sm" icon title={t('解除关联')} onClick={() => onUnlinkNote(n.id)}>
                  <Link2 size={13} />
                </Button>
              </div>
              <Markdown text={n.content} />
              {n.tags.length > 0 ? (
                <div className="note-foot">
                  {n.tags.map((tg) => <TagChip key={tg.id} name={'#' + tg.name} color={tg.color} />)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <div className="composer" style={{ marginTop: 10, padding: 10 }}>
        <textarea
          value={noteDraft}
          placeholder={t('给这件资产记一条便签…')}
          onChange={(e) => setNoteDraft(e.target.value)}
          style={{ minHeight: 44, fontSize: 13.5 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onAddNote()
          }}
        />
        <div className="composer-foot" style={{ paddingTop: 6 }}>
          <span className="composer-hint">{t('Ctrl/⌘ + Enter 添加')}</span>
          <div className="grow" />
          <Button size="sm" variant="primary" onClick={onAddNote} disabled={!noteDraft.trim()}>
            <Plus size={13} /> {t('添加')}
          </Button>
        </div>
      </div>

      {meta ? (
        <div className="muted" style={{ fontSize: 11.5, marginTop: 18 }}>
          {t('创建于 {created} · 更新于 {updated}', { created: fullTime(meta.createdAt), updated: fullTime(meta.updatedAt) })}
          {form.price !== '' ? ' · ' + t('参考价') + ' ' + money(Number(form.price), form.currency) : ''}
        </div>
      ) : null}
    </>
  )
}
