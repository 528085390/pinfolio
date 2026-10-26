import { Check, ImagePlus, Pin, Plus, Tag as TagIcon } from 'lucide-react'
import { cx, type Tag } from '../../lib/api'
import { Button, Spinner } from '../../components/ui'
import { useComposer } from './useComposer'
import { useImageUpload } from './useImageUpload'

/**
 * 顶部输入框 + 置顶 / 标签 / 图片三个 chip + 标签弹层。
 * 草稿与标签弹层的状态在 useComposer，图片上传在 useImageUpload。
 */
export function Composer({ c, tags, onError }: {
  c: ReturnType<typeof useComposer>
  tags: Tag[]
  onError: (msg: string) => void
}) {
  const img = useImageUpload({ value: c.draft, onChange: c.setDraft, taRef: c.taRef, onError })
  return (
    <div className="composer" onDrop={img.onDrop} onDragOver={img.onDragOver} onDragLeave={img.onDragLeave}>
      <textarea
        ref={c.taRef}
        value={c.draft}
        placeholder="记点什么…  用 #标签 自动归类，Ctrl/⌘ + Enter 保存；图片可以直接粘贴或拖进来"
        onChange={(e) => c.setDraft(e.target.value)}
        onPaste={img.onPaste}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) c.submit()
        }}
      />
      {img.dragging ? <div className="composer-drop">松手就上传图片</div> : null}
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
        <button
          className={cx('chip', img.pending > 0 && 'active')}
          onClick={img.pickFiles}
          type="button"
          disabled={img.pending > 0}
          title="插入图片（也可以直接粘贴或拖进来）"
        >
          <ImagePlus size={12} /> {img.pending > 0 ? '上传中…' : '图片'}
        </button>
        <input
          ref={img.fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          onChange={img.onFileChange}
        />
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
