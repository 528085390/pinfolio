import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, FileText } from 'lucide-react'
import { api, type MailMessage } from '../lib/api'
import { Button, Empty, Spinner } from './ui'
import { MailMeta } from './mail-reader/MailMeta'
import { MailViewbar } from './mail-reader/MailViewbar'
import { MailAttachments } from './mail-reader/MailAttachments'
import { buildMailDoc, EMPTY_DOC, fitWidth, loadImagePref, saveImagePref } from './mail-reader/doc'

/**
 * 邮件阅读区：取信 → 清洗 HTML → 塞进 Shadow DOM。
 * 正文为什么走 Shadow DOM：邮件自带的 <style> 只在 shadow 里生效，不会污染整个主界面的样式；
 * 清洗规则与「固定宽度怎么压」都在 ./mail-reader/doc.ts，纯文本/地址/大小格式化在 ./mail-reader/text.ts。
 */
export function MailReader({ accountId, folder, uid, folderLabel }: {
  accountId: number
  folder: string
  uid: number
  folderLabel?: string
}) {
  const [msg, setMsg] = useState<MailMessage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'html' | 'text'>('html')
  const [showImages, setShowImages] = useState<boolean>(loadImagePref)
  const scroller = useRef<HTMLDivElement>(null)
  const htmlHost = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    setMsg(null)
    setMode('html')
    if (scroller.current) scroller.current.scrollTop = 0
    api.mail
      .message({ account: accountId, folder, uid })
      .then((m) => {
        if (alive) setMsg(m)
      })
      .catch((e: any) => {
        if (alive) setError(e.message)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [accountId, folder, uid])

  // 没有 HTML 正文就自动切纯文本
  useEffect(() => {
    if (msg && !msg.html) setMode('text')
  }, [msg])

  const cidMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of msg?.attachments || []) {
      if (a.cid) map.set(a.cid.replace(/^<|>$/g, '').toLowerCase(), a.index)
    }
    return map
  }, [msg])

  const attUrl = (index: number) => api.mail.attachmentUrl({ account: accountId, folder, uid, index })

  const rendered = useMemo(() => {
    if (!msg || !msg.html) return EMPTY_DOC
    try {
      return buildMailDoc(msg.html, { showImages, cidMap, attUrl })
    } catch {
      return EMPTY_DOC
    }
  }, [msg, showImages, cidMap, accountId, folder, uid])

  const useText = mode === 'text' || !msg?.html

  // 正文走 Shadow DOM：邮件自带的 <style> 只在 shadow 里生效，不会污染整个主界面的样式
  useEffect(() => {
    if (useText || !htmlHost.current) return
    const host = htmlHost.current
    const root = host.shadowRoot || host.attachShadow({ mode: 'open' })
    root.innerHTML = rendered.docHtml
    fitWidth(host, root)
    // 拖窗口 / 收起侧栏会改阅读区宽度，宽度变了才重算（缩完高度也变，不看宽度会自激）
    let lastW = host.clientWidth
    const ro = new ResizeObserver(() => {
      const w = host.clientWidth
      if (w === lastW) return
      lastW = w
      fitWidth(host, root)
    })
    ro.observe(host)
    return () => ro.disconnect()
  }, [rendered.docHtml, useText])

  function toggleImages() {
    setShowImages((v) => {
      const next = !v
      saveImagePref(next)
      return next
    })
  }

  if (loading) {
    return (
      <div className="mail-reader-empty">
        <Spinner />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mail-reader-empty">
        <Empty icon={<FileText size={20} />} title="这封邮件打不开" text={error} />
      </div>
    )
  }

  if (!msg) return null

  return (
    <div className="mail-reader">
      <MailMeta msg={msg} folderLabel={folderLabel} />
      <MailViewbar
        useText={useText}
        hasHtml={!!msg.html}
        onMode={setMode}
        remote={rendered.remote}
        showImages={showImages}
        onToggleImages={toggleImages}
      />
      <div className="mail-reader-body" ref={scroller}>
        {!showImages && rendered.blocked > 0 ? (
          <div className="mail-img-banner">
            <span>已拦截 {rendered.blocked} 张外部图片（防止追踪像素，不影响邮箱里的已读状态）</span>
            <Button size="sm" variant="ghost" onClick={toggleImages}>
              <Eye size={13} /> 显示图片
            </Button>
          </div>
        ) : null}

        {useText ? (
          <pre className="mail-text">{msg.text || '（这封邮件没有纯文本正文）'}</pre>
        ) : (
          <div className="mail-html" ref={htmlHost} />
        )}

        <MailAttachments attachments={msg.attachments} attUrl={attUrl} />
      </div>
    </div>
  )
}
