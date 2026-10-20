import { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { FileText, Image as ImageIcon, Paperclip } from 'lucide-react'
import { api, cx, type MailAddr, type MailMessage } from '../lib/api'
import { Button, Empty, Spinner } from './ui'
import { fullTime } from '../lib/format'

function addrText(a: MailAddr | null | undefined) {
  if (!a) return ''
  if (a.name && a.address) return a.name + ' <' + a.address + '>'
  return a.name || a.address || ''
}

function addrList(list: MailAddr[] | undefined) {
  if (!list || !list.length) return '（无）'
  return list.map(addrText).filter(Boolean).join('，')
}

function bytes(n: number) {
  if (!n) return ''
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

/**
 * 把邮件 HTML 处理成可安全注入的片段：
 * 1. 用 DOMParser 解析成游离文档（不会执行脚本、不会发请求）
 * 2. 删掉 script/style/link/iframe 等，去掉所有内联 style（邮件自带的样式会污染整页）
 * 3. 远程图片默认摘掉 src 存到 data-src（FR-20：默认不加载远程资源），cid: 图片换成附件接口地址
 * 4. 链接一律新窗口打开（FR-23）
 * 5. 最后交给 DOMPurify 兜底
 */
function renderMailHtml(
  html: string,
  opts: { showImages: boolean; cidMap: Map<string, number>; attUrl: (index: number) => string },
): { html: string; blocked: number } {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script,style,link,iframe,frame,object,embed,form,meta,base,noscript,svg use').forEach((el) => el.remove())
  doc.querySelectorAll('*').forEach((el) => {
    el.removeAttribute('style')
    el.removeAttribute('srcset')
    el.removeAttribute('ping')
    el.removeAttribute('background')
  })
  let blocked = 0
  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || ''
    if (/^cid:/i.test(src)) {
      const key = src.slice(4).replace(/^<|>$/g, '').toLowerCase()
      const index = opts.cidMap.get(key)
      if (index === undefined) {
        img.remove()
        return
      }
      img.setAttribute('src', opts.attUrl(index))
      return
    }
    if (!src) return
    if (!opts.showImages) {
      img.setAttribute('data-src', src)
      img.setAttribute('data-blocked', '1')
      img.removeAttribute('src')
      if (!img.getAttribute('alt')) img.setAttribute('alt', '图片已拦截')
      blocked++
    }
  })
  doc.querySelectorAll('a').forEach((a) => {
    const href = a.getAttribute('href') || ''
    if (!href || /^javascript:/i.test(href)) {
      a.removeAttribute('href')
      return
    }
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noopener noreferrer')
  })
  const clean = DOMPurify.sanitize(doc.body.innerHTML, {
    FORBID_TAGS: ['style', 'link', 'script', 'iframe', 'frame', 'object', 'embed', 'form', 'meta', 'base'],
    FORBID_ATTR: ['style', 'srcset', 'ping', 'background'],
    ADD_ATTR: ['target', 'data-src', 'data-blocked'],
  })
  return { html: clean, blocked }
}

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
  const [showImages, setShowImages] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    setMsg(null)
    setMode('html')
    setShowImages(false)
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
    if (!msg || !msg.html) return { html: '', blocked: 0 }
    try {
      return renderMailHtml(msg.html, { showImages, cidMap, attUrl })
    } catch {
      return { html: '', blocked: 0 }
    }
  }, [msg, showImages, cidMap, accountId, folder, uid])

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

  const useText = mode === 'text' || !msg.html

  return (
    <div className="mail-reader">
      <div className="mail-reader-head">
        <h2 className="mail-reader-subject">{msg.subject || '（无主题）'}</h2>
        <div className="mail-reader-meta">
          <div className="mail-meta-row">
            <span className="mail-meta-k">发件人</span>
            <span className="mail-meta-v">{addrText(msg.from) || '（无）'}</span>
          </div>
          <div className="mail-meta-row">
            <span className="mail-meta-k">收件人</span>
            <span className="mail-meta-v">{addrList(msg.to)}</span>
          </div>
          {msg.cc && msg.cc.length ? (
            <div className="mail-meta-row">
              <span className="mail-meta-k">抄送</span>
              <span className="mail-meta-v">{addrList(msg.cc)}</span>
            </div>
          ) : null}
          <div className="mail-meta-row">
            <span className="mail-meta-k">时间</span>
            <span className="mail-meta-v">{fullTime(msg.date)}</span>
          </div>
          <div className="mail-meta-row">
            <span className="mail-meta-k">邮箱</span>
            <span className="mail-meta-v">
              {msg.accountLabel}
              {msg.accountEmail ? ' · ' + msg.accountEmail : ''}
              {folderLabel ? ' · ' + folderLabel : ''}
            </span>
          </div>
        </div>
      </div>

      <div className="mail-viewbar">
        <div className="mail-seg">
          <button
            type="button"
            className={cx('mail-seg-btn', !useText && 'active')}
            onClick={() => setMode('html')}
            disabled={!msg.html}
            title={msg.html ? '显示 HTML 排版' : '这封邮件只有纯文本'}
          >
            HTML
          </button>
          <button type="button" className={cx('mail-seg-btn', useText && 'active')} onClick={() => setMode('text')}>
            纯文本
          </button>
        </div>
        {rendered.blocked > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => setShowImages(true)}>
            <ImageIcon size={14} /> 显示图片（{rendered.blocked}）
          </Button>
        ) : null}
        {showImages && rendered.blocked > 0 ? <span className="mail-hint">远程图片已放行</span> : null}
      </div>

      <div className="mail-reader-body" ref={scroller}>
        {useText ? (
          <pre className="mail-text">{msg.text || '（这封邮件没有纯文本正文）'}</pre>
        ) : (
          <div className="mail-html" dangerouslySetInnerHTML={{ __html: rendered.html }} />
        )}

        {msg.attachments.length ? (
          <div className="mail-attach">
            <div className="mail-attach-title">
              <Paperclip size={13} /> 附件 {msg.attachments.length} 个
            </div>
            <div className="mail-attach-list">
              {msg.attachments.map((a) => (
                <a key={a.index} className="mail-attach-item" href={attUrl(a.index)} download={a.filename}>
                  <span className="mail-attach-name">{a.filename}</span>
                  <span className="mail-attach-size">{bytes(a.size)}</span>
                </a>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
