import { useMemo, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { API_BASE } from '../lib/api/http'
import { addImageAttrs, enhanceAttachments, rewriteAttachmentUrls, type AttachmentMeta } from '../lib/images'
import { Lightbox } from './Lightbox'

marked.setOptions({ gfm: true, breaks: true })

/**
 * Markdown 渲染。附件三件事在这里做（顺序不能换）：
 * ① sanitize 之后把正文里的 `/api/attachments/12` 换成部署前缀（公网挂在 /pinfolio/ 下也能显示）；
 * ② 有元数据时把附件链接换成播放器 / 音频条 / 下载卡片（视频不能只给一个链接）；
 * ③ 给 <img> 补懒加载，点图开灯箱。所有标签都是 sanitize 之后才加的，别绕过清洗。
 */
export function Markdown({ text, className, attachments }: { text: string; className?: string; attachments?: AttachmentMeta[] }) {
  const [zoom, setZoom] = useState<string | null>(null)
  const html = useMemo(() => {
    let raw: string
    try {
      raw = marked.parse(text, { async: false }) as string
    } catch {
      raw = text
    }
    const safe = DOMPurify.sanitize(raw, { ADD_ATTR: ['target', 'rel'] })
    return addImageAttrs(enhanceAttachments(rewriteAttachmentUrls(safe, API_BASE), attachments))
  }, [text, attachments])
  return (
    <>
      <div
        className={'prose ' + (className || '')}
        onClick={(e) => {
          const t = e.target as HTMLElement
          if (t && t.tagName === 'IMG') setZoom((t as HTMLImageElement).src)
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {zoom ? <Lightbox src={zoom} onClose={() => setZoom(null)} /> : null}
    </>
  )
}
