import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cx } from '../lib/api'

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  size?: 'md' | 'sm'
  icon?: boolean
}

export function Button({ variant = 'default', size = 'md', icon, className, children, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      className={cx(
        'btn',
        variant === 'primary' && 'btn-primary',
        variant === 'ghost' && 'btn-ghost',
        variant === 'danger' && 'btn-danger',
        size === 'sm' && 'btn-sm',
        icon && 'btn-icon',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Field({ label, hint, children, span }: { label: string; hint?: string; children: ReactNode; span?: boolean | number }) {
  return (
    <label className={cx('field', span ? 'span-2' : false)}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon ? <div className="empty-icon">{icon}</div> : null}
      <div className="empty-title">{title}</div>
      {text ? <div className="empty-text">{text}</div> : null}
      {action ? <div style={{ marginTop: 16 }}>{action}</div> : null}
    </div>
  )
}

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
}

export function Modal({ open, onClose, title, children, footer, width }: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  useEscape(open, onClose)
  if (!open) return null
  return createPortal(
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <div className="modal-card" style={width ? { width: 'min(' + width + 'px, 100%)' } : undefined}>
          <div className="modal-head">
            <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
            <Button variant="ghost" size="sm" icon style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="关闭">
              <X size={16} />
            </Button>
          </div>
          <div className="modal-body">{children}</div>
          {footer ? <div className="modal-foot">{footer}</div> : null}
        </div>
      </div>
    </>,
    document.body,
  )
}

export function Drawer({ open, onClose, title, children, footer }: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  useEscape(open, onClose)
  if (!open) return null
  return createPortal(
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div className="grow" style={{ minWidth: 0 }}>{title}</div>
          <Button variant="ghost" size="sm" icon onClick={onClose} aria-label="关闭">
            <X size={16} />
          </Button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer ? <div className="drawer-foot">{footer}</div> : null}
      </aside>
    </>,
    document.body,
  )
}

export function TagChip({ name, color, onClick, active }: { name: string; color: string; onClick?: () => void; active?: boolean }) {
  const style = active
    ? { color: '#fff8ee', background: color, borderColor: color }
    : { color, borderColor: 'color-mix(in srgb, ' + color + ' 35%, transparent)', background: 'color-mix(in srgb, ' + color + ' 8%, transparent)' }
  return (
    <button type="button" className={cx('tag', !onClick && 'static')} style={style} onClick={onClick}>
      {name}
    </button>
  )
}

export function Spinner() {
  return <span className="spinner" />
}
