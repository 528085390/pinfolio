import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({ gfm: true, breaks: true })

export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => {
    try {
      const raw = marked.parse(text, { async: false }) as string
      return DOMPurify.sanitize(raw, { ADD_ATTR: ['target', 'rel'] })
    } catch {
      return DOMPurify.sanitize(text)
    }
  }, [text])
  return <div className={'prose ' + (className || '')} dangerouslySetInnerHTML={{ __html: html }} />
}
