import { Pin, Plus, Check, Tag as TagIcon } from 'lucide-react'
import { cx, type Tag } from '../../lib/api'
import { Button, Spinner } from '../../components/ui'
import type { useComposer } from './useComposer'

/** 顶部输入框 + 置顶/标签两个 chip + 标签弹层。状态全在 useComposer 里。 */
export function Composer({ c, tags }: { c: ReturnType<typeof useComposer>; tags: Tag[] }) {
  return (
    <div className="composer">
      <textarea
        ref={c.taRef}
        value={c.draft}
        placeholder="记点什么…  用 #标签 自动归类，Ctrl/⌘ + Enter 保存"
        onChange={(e) => c.setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) c.submit()
        }}
      />
      <div className="composer-foot">
        <button
          className={cx('chip', c.draftPinned && 'active')}
          onClick={() => c.setDraftPinned((v) => !v)}
          type="button"
          title="置顶这条便签"
        >
          <Pin size={12} /> 置顶
        </button>
        <div style={{ position: 'relative' }} ref={c.tagWrapRef}>
          <button
            ref={c.tagBtnRef}
            className={cx('chip', c.tagMenu && 'active')}
            onClick={c.openTagMenu}
            type="button"
            title="从已有标签里挑一个插进便签"
          >
            <TagIcon size={12} /> 标签
          </button>
          {c.tagMenu ? (
            <div
              className={cx('tag-pop', c.tagPopPlacement.dir === 'down' && 'tag-pop-down')}
              style={{ maxHeight: c.tagPopPlacement.maxHeight }}
            >
              <div className="tag-pop-head">点一下插进便签</div>
              <div className="tag-pop-list">
                {tags.length === 0 ? <span className="muted" style={{ fontSize: 12 }}>还没有标签</span> : null}
                {tags.map((t) => (
                  <button key={t.id} className="chip" onClick={() => c.pickTag(t.name)}>
                    #{t.name}
                  </button>
                ))}
              </div>
              <button
                className="tag-pop-new"
                onClick={() => { c.closeTagMenu(); c.setNewTagOpen(true) }}
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
        <Button variant="primary" size="sm" onClick={c.submit} disabled={!c.draft.trim() || c.saving}>
          {c.saving ? <Spinner /> : <Check size={14} />} 记下
        </Button>
      </div>
    </div>
  )
}
