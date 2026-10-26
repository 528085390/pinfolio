import { useMemo, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { API_BASE } from '../lib/api/http'
import { addImageAttrs, rewriteAttachmentUrls } from '../lib/images'
import { Lightbox } from './Lightbox'

marked.setOptions({ gfm: true, breaks: true })

/**
 * Markdown 渲染。图片两件事在这里做：
 * ① 把正文里的 `/api/attachments/12` 换成部署前缀（公网挂在 /pinfolio/ 下也能显示）；
 * ② 点图开灯箱。属性都在 sanitize **之后**补，别绕过清洗。
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const [zoom, setZoom] = useState<string | null>(null)
  const html = useMemo(() => {
    let raw: string
    try {
      raw = marked.parse(text, { async: false }) as string
    } catch {
      raw = text
    }
    const safe = DOMPurify.sanitize(raw, { ADD_ATTR: ['target', 'rel'] })
    return addImageAttrs(rewriteAttachmentUrls(safe, API_BASE))
  }, [text])
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
