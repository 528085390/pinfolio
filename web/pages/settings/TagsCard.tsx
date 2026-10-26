import { Plus, Trash2 } from 'lucide-react'
import { Button, TagChip } from '../../components/ui'
import type { Tag } from '../../lib/api'
import { t } from '../../lib/i18n'
import type { SettingsState } from './useSettings'

export function TagsCard({ s, tags }: { s: SettingsState; tags: Tag[] }) {
  return (
    <div className="card">
      <div className="section-title" style={{ marginTop: 0 }}>{t('标签')}</div>
      <div className="filters" style={{ marginBottom: 12 }}>
        {tags.length === 0 ? <span className="muted" style={{ fontSize: 13 }}>{t('还没有标签。在便签里写 #标签 会自动创建。')}</span> : null}
        {tags.map((tg) => (
          <span key={tg.id} className="row" style={{ gap: 2 }}>
            <TagChip name={'#' + tg.name} color={tg.color} />
            <span className="muted" style={{ fontSize: 11 }}>{tg.notes || 0}/{tg.assets || 0}</span>
            <Button variant="ghost" size="sm" icon title={t('删除标签')} onClick={() => s.removeTag(tg)}>
              <Trash2 size={12} />
            </Button>
          </span>
        ))}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <input className="input" style={{ maxWidth: 220 }} value={s.tagName} placeholder={t('新标签名')}
          onChange={(e) => s.setTagName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') s.addTag() }} />
        <input type="color" value={s.tagColor} onChange={(e) => s.setTagColor(e.target.value)}
          style={{ width: 34, height: 34, padding: 2, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)' }} />
        <Button size="sm" onClick={s.addTag}><Plus size={14} /> {t('添加')}</Button>
      </div>
    </div>
  )
}
