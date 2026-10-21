import { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { Eye, EyeOff, FileText, Paperclip } from 'lucide-react'
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

/** 图片策略记在本机：默认显示，用户点过「隐藏图片」就一直隐藏 */
const IMG_KEY = 'pinboard-mail-images'

/**
 * 阅读区的基础样式（注入到 Shadow DOM 里，跟邮件自带样式一起生效）。
 * 用 CSS 变量取主界面的暖纸色，变量能穿透 shadow 边界；写死颜色的话深色模式就不跟了。
 * max-width/height 加 !important 是为了压住邮件自带的 width=600 之类固定宽度，避免横向溢出。
 */
const BASE_CSS = `
  :host { display: block; }
  .mail-doc { font-size: 13.5px; line-height: 1.7; color: var(--ink-2); overflow-wrap: anywhere; max-width: 100%; }
  /* 邮件常用固定宽度（这封就是 width:720px），阅读区只有 650 出头，不压住就会横向溢出被裁 */
  .mail-doc * { max-width: 100% !important; box-sizing: border-box; }
  .mail-doc img { height: auto !important; }
  .mail-doc img[data-blocked] {
    display: inline-block; min-width: 120px; min-height: 30px;
    border: 1px dashed var(--line-strong); border-radius: 6px; background: var(--surface-2);
  }
  .mail-doc a { color: var(--accent); }
  .mail-doc table { max-width: 100%; border-collapse: collapse; }
  .mail-doc td, .mail-doc th { padding: 2px 6px; }
  .mail-doc blockquote { margin: 8px 0; padding-left: 10px; border-left: 2px solid var(--line-strong); color: var(--muted); }
  .mail-doc pre { white-space: pre-wrap; overflow-x: auto; }
`

/**
 * 邮件里常见 width:720px 这种固定宽度，阅读区只有 650 出头。
 * 光靠 max-width 压不住：表格（table-layout:auto）的 used width 取 min-content，
 * 内部元素按 100% 解析又绕回表格自身宽度，结果是整块 720 硬撑着、右边被裁。
 * 所以按比例缩小（CSS zoom）——排版完全不变，只是整体缩到放得下。
 */
function fitWidth(host: HTMLElement, root: ShadowRoot) {
  const doc = root.querySelector('.mail-doc') as HTMLElement | null
  if (!doc) return
  doc.style.zoom = ''
  const avail = host.clientWidth
  const need = doc.scrollWidth
  if (avail > 0 && need > avail + 2) doc.style.zoom = String(Math.max(0.5, avail / need))
}

/** 邮件 CSS 里的危险/越界写法：@import 拉外链、expression()、behavior、fixed 定位会盖住整个应用 */
function scrubCss(css: string, allowRemote: boolean): string {
  let out = css
    .replace(/@import[^;]*;?/gi, '')
    .replace(/expression\s*\(/gi, 'none(')
    .replace(/javascript\s*:/gi, '')
    .replace(/behavior\s*:[^;}]*;?/gi, '')
    .replace(/-moz-binding\s*:[^;}]*;?/gi, '')
    .replace(/position\s*:\s*(fixed|sticky)/gi, 'position:static')
  if (!allowRemote) out = out.replace(/url\(\s*['"]?https?:[^)]*\)/gi, 'none')
  return out
}

/**
 * 把邮件 HTML 变成能安全塞进 Shadow DOM 的片段：
 * 1. 用 DOMParser 解析成游离文档（不执行脚本、不发请求），只取 body 内容 + 所有 <style> 的文本
 * 2. 删掉 script/iframe/form/link 等；<style> 不删——它要跟着进 shadow root，排版才不散
 * 3. 内联 style 只清洗不删除（原来整段剥掉，邮件排版就崩了）：去掉 @import / expression / fixed 定位
 * 4. 图片：cid: 换成附件接口地址（内嵌图，安全）；远程图片默认保留，用户点了「隐藏图片」才摘成 data-src
 * 5. 链接一律新窗口打开，javascript: 一律去掉
 * 6. 最后交给 DOMPurify 兜底
 */
function buildMailDoc(
  html: string,
  opts: { showImages: boolean; cidMap: Map<string, number>; attUrl: (index: number) => string },
): { docHtml: string; blocked: number; remote: number } {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const emailCss = [...doc.querySelectorAll('style')].map((s) => s.textContent || '').join('\n')
  doc.querySelectorAll('style').forEach((el) => el.remove())
  doc
    .querySelectorAll('script,iframe,frame,object,embed,form,meta,base,link,noscript,svg use')
    .forEach((el) => el.remove())

  let blocked = 0
  let remote = 0
  doc.querySelectorAll('img').forEach((img) => {
    const src = (img.getAttribute('src') || '').trim()
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
    if (!src || /^data:/i.test(src)) return
    if (!/^(https?:)?\/\//i.test(src)) return
    remote++
    if (!opts.showImages) {
      img.setAttribute('data-src', src)
      img.setAttribute('data-blocked', '1')
      img.removeAttribute('src')
      blocked++
    }
  })

  doc.querySelectorAll('*').forEach((el) => {
    el.removeAttribute('srcset')
    el.removeAttribute('ping')
    el.removeAttribute('background')
  })
  doc.querySelectorAll('[style]').forEach((el) => {
    const cleaned = scrubCss(el.getAttribute('style') || '', opts.showImages)
    if (cleaned.trim()) el.setAttribute('style', cleaned)
    else el.removeAttribute('style')
  })
  doc.querySelectorAll('a').forEach((a) => {
    const href = (a.getAttribute('href') || '').trim()
    if (!href || /^javascript:/i.test(href)) {
      a.removeAttribute('href')
      return
    }
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noopener noreferrer')
  })

  const clean = DOMPurify.sanitize(doc.body.innerHTML, {
    FORBID_TAGS: ['script', 'iframe', 'frame', 'object', 'embed', 'form', 'meta', 'base', 'link', 'style'],
    FORBID_ATTR: ['srcset', 'ping', 'background', 'action', 'formaction'],
    ADD_ATTR: ['target', 'data-src', 'data-blocked'],
  })
  const docHtml = '<style>' + BASE_CSS + '\n' + scrubCss(emailCss, opts.showImages) + '</style>' + '<div class="mail-doc">' + clean + '</div>'
  return { docHtml, blocked, remote }
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
  const [showImages, setShowImages] = useState<boolean>(() => {
    try {
      return localStorage.getItem(IMG_KEY) !== 'hide'
    } catch {
      return true
    }
  })
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
    if (!msg || !msg.html) return { docHtml: '', blocked: 0, remote: 0 }
    try {
      return buildMailDoc(msg.html, { showImages, cidMap, attUrl })
    } catch {
      return { docHtml: '', blocked: 0, remote: 0 }
    }
  }, [msg, showImages, cidMap, accountId, folder, uid])

  const useText = mode === 'text' || !msg?.html

  // 正文走 Shadow DOM：邮件自带的 <style> 只在 shadow 里生效，不会污染整个便签夹的样式
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
      try {
        localStorage.setItem(IMG_KEY, next ? 'show' : 'hide')
      } catch {
        /* 隐私模式下写不了，忽略 */
      }
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
        {rendered.remote > 0 ? (
          <Button size="sm" variant="ghost" onClick={toggleImages} title={showImages ? '不再请求发件人的图片' : '加载邮件里的远程图片'}>
            {showImages ? <EyeOff size={14} /> : <Eye size={14} />}
            {showImages ? '隐藏图片' : '显示图片（' + rendered.remote + '）'}
          </Button>
        ) : null}
      </div>

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
