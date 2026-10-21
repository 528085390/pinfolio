import { Plus, Trash2 } from 'lucide-react'
import { Button, TagChip } from '../../components/ui'
import type { Tag } from '../../lib/api'
import type { SettingsState } from './useSettings'

export function TagsCard({ s, tags }: { s: SettingsState; tags: Tag[] }) {
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="section-title" style={{ marginTop: 0 }}>标签</div>
      <div className="filters" style={{ marginBottom: 12 }}>
        {tags.length === 0 ? <span className="muted" style={{ fontSize: 13 }}>还没有标签。在便签里写 #标签 会自动创建。</span> : null}
        {tags.map((t) => (
          <span key={t.id} className="row" style={{ gap: 2 }}>
            <TagChip name={'#' + t.name} color={t.color} />
            <span className="muted" style={{ fontSize: 11 }}>{t.notes || 0}/{t.assets || 0}</span>
            <Button variant="ghost" size="sm" icon title="删除标签" onClick={() => s.removeTag(t)}>
              <Trash2 size={12} />
            </Button>
          </span>
        ))}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <input className="input" style={{ maxWidth: 220 }} value={s.tagName} placeholder="新标签名"
          onChange={(e) => s.setTagName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') s.addTag() }} />
        <input type="color" value={s.tagColor} onChange={(e) => s.setTagColor(e.target.value)}
          style={{ width: 34, height: 34, padding: 2, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)' }} />
        <Button size="sm" onClick={s.addTag}><Plus size={14} /> 添加</Button>
      </div>
    </div>
  )
}
