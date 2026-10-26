import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { t, useLocale } from '../lib/i18n'

/**
 * 页内看大图：铺满浮层，点空白 / 点 ✕ / Esc 关闭。
 * portal 到 body —— 便签列表在 .content 这个滚动容器里，直接渲染会被裁掉。
 */
export function Lightbox({ src, alt, onClose }: { src: string; alt?: string; onClose: () => void }) {
  useLocale() // 组件被 React.memo 包着时要自己订阅语言，切语言才重渲染
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return createPortal(
    <div className="lightbox" onClick={onClose} role="dialog" aria-modal="true" aria-label={t('查看大图')}>
      <img src={src} alt={alt || ''} onClick={(e) => e.stopPropagation()} />
      <button className="lightbox-close" onClick={onClose} title={t('关闭（Esc）')} type="button">✕</button>
    </div>,
    document.body,
  )
}
