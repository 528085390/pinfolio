import DOMPurify from 'dompurify'
import { scrubCss } from './css'

export { scrubCss }

/** 图片策略记在本机：默认显示，用户点过「隐藏图片」就一直隐藏 */
const IMG_KEY = 'pinboard-mail-images'

/** 读「是否显示远程图片」；隐私模式 / 存储被禁用时按显示处理 */
export function loadImagePref(): boolean {
  try {
    return localStorage.getItem(IMG_KEY) !== 'hide'
  } catch {
    return true
  }
}

export function saveImagePref(show: boolean): void {
  try {
    localStorage.setItem(IMG_KEY, show ? 'show' : 'hide')
  } catch {
    /* 隐私模式下写不了，忽略 */
  }
}

/**
 * 阅读区的基础样式（注入到 Shadow DOM 里，跟邮件自带样式一起生效）。
 * 用 CSS 变量取主界面的暖纸色，变量能穿透 shadow 边界；写死颜色的话深色模式就不跟了。
 * max-width/height 加 !important 是为了压住邮件自带的 width=600 之类固定宽度，避免横向溢出。
 */
export const BASE_CSS = `
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
export function fitWidth(host: HTMLElement, root: ShadowRoot): void {
  const el = root.querySelector('.mail-doc') as HTMLElement | null
  if (!el) return
  el.style.zoom = ''
  const avail = host.clientWidth
  const need = el.scrollWidth
  if (avail > 0 && need > avail + 2) el.style.zoom = String(Math.max(0.5, avail / need))
}

export type MailDoc = { docHtml: string; blocked: number; remote: number }

export const EMPTY_DOC: MailDoc = { docHtml: '', blocked: 0, remote: 0 }

/**
 * 把邮件 HTML 变成能安全塞进 Shadow DOM 的片段：
 * 1. 用 DOMParser 解析成游离文档（不执行脚本、不发请求），只取 body 内容 + 所有 <style> 的文本
 * 2. 删掉 script/iframe/form/link 等；<style> 不删——它要跟着进 shadow root，排版才不散
 * 3. 内联 style 只清洗不删除（原来整段剥掉，邮件排版就崩了）：去掉 @import / expression / fixed 定位
 * 4. 图片：cid: 换成附件接口地址（内嵌图，安全）；远程图片默认保留，用户点了「隐藏图片」才摘成 data-src
 * 5. 链接一律新窗口打开，javascript: 一律去掉
 * 6. 最后交给 DOMPurify 兜底
 */
export function buildMailDoc(
  html: string,
  opts: { showImages: boolean; cidMap: Map<string, number>; attUrl: (index: number) => string },
): MailDoc {
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
