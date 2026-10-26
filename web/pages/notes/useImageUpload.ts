import { useRef, useState } from 'react'
import type { ChangeEvent, ClipboardEvent, DragEvent, RefObject } from 'react'
import { api } from '../../lib/api'
import { imageMarkdown, insertSnippet, pickImageFiles } from '../../lib/images'
import { t } from '../../lib/i18n'

/** 超过这个体积才压：小图再压只会掉画质 */
const COMPRESS_ABOVE_BYTES = 300 * 1024
/** 长边上限：2000px 在手机和桌面上都够清楚，体积却只有原图的零头 */
const MAX_EDGE = 2000

/**
 * 浏览器端压一遍再传（见 docs/features.md「便签图片」）：
 * 手机原图 5 MB → 200~400 KB 的 WebP，公网经 frp 上传也不卡。
 * GIF 原样传（压了就丢动画）；解码不了（HEIC 之类）也原样传，让服务端给明确的错。
 */
async function compress(file: File): Promise<Blob> {
  if (file.type === 'image/gif' || file.size <= COMPRESS_ABOVE_BYTES) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) { bitmap.close?.(); return file }
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85))
    // 压完反而更大（本来就优化过的图）就用原图
    if (!blob || blob.size >= file.size) return file
    return blob
  } catch {
    return file
  }
}

type Options = {
  /** 当前正文 */
  value: string
  /** 正文变更（受控 textarea 的 setter） */
  onChange: (next: string) => void
  taRef: RefObject<HTMLTextAreaElement | null>
  onError: (msg: string) => void
}

/**
 * 图片入口：粘贴 / 拖拽 / 选文件 → 压缩 → 上传 → 在光标处插 Markdown。
 * composer 与行内编辑框共用这一个 hook（各自持有一份 pending / dragging 状态）。
 */
export function useImageUpload({ value, onChange, taRef, onError }: Options) {
  const [pending, setPending] = useState(0)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  // 上传要几百毫秒，期间用户可能还在打字：始终拿最新的正文来插，别把新打的字冲掉
  const valueRef = useRef(value)
  valueRef.current = value

  async function addFiles(files: File[]) {
    const imgs = pickImageFiles(files)
    if (!imgs.length) {
      if (files.length) onError(t('只能插入 PNG / JPEG / WebP / GIF 图片'))
      return
    }
    const ta = taRef.current
    const start = ta?.selectionStart ?? valueRef.current.length
    const end = ta?.selectionEnd ?? start
    setPending((n) => n + imgs.length)
    const snippets: string[] = []
    for (const file of imgs) {
      try {
        const blob = await compress(file)
        const up = await api.attachments.upload(blob, file.name)
        snippets.push(imageMarkdown(up.id))
      } catch (e: any) {
        onError(e && e.message ? t('图片上传失败：{msg}', { msg: e.message }) : t('图片上传失败'))
      } finally {
        setPending((n) => Math.max(0, n - 1))
      }
    }
    if (!snippets.length) return
    const { text, caret } = insertSnippet(valueRef.current, snippets.join('\n\n'), start, end)
    onChange(text)
    // 受控组件：等 React 把新值画进 textarea，再放光标
    requestAnimationFrame(() => {
      const el = taRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData?.files ?? [])
    if (!files.length) return // 纯文本粘贴照旧交给浏览器
    e.preventDefault()
    void addFiles(files)
  }

  function onDrop(e: DragEvent<HTMLElement>) {
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (!files.length) return
    e.preventDefault()
    setDragging(false)
    void addFiles(files)
  }

  function onDragOver(e: DragEvent<HTMLElement>) {
    if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragging(true)
  }

  function onDragLeave(e: DragEvent<HTMLElement>) {
    // 在子元素之间移动也会触发 dragleave，出了容器才算离开
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setDragging(false)
  }

  function pickFiles() {
    fileRef.current?.click()
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // 同一个文件连选两次也要能触发
    void addFiles(files)
  }

  return { pending, dragging, fileRef, pickFiles, onFileChange, onPaste, onDrop, onDragOver, onDragLeave, addFiles }
}
