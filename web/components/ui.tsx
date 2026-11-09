import { useEffect, useRef, useState, type ButtonHTMLAttributes, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { t } from '../lib/i18n'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cx } from '../lib/api'
import { dragFollow, FLICK_VELOCITY, prefersReducedMotion, project, spring, SPRING_DRAWER } from '../lib/motion'

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

/** 退场时长（ms）：抽屉 260（= motion.css 的 --dur-overlay）、弹窗 240（spec §4.1 的 Modal 值）。 */
const DRAWER_EXIT_MS = 260
const MODAL_EXIT_MS = 240

/** 写进 DOM 的 data-state：退场期间元素仍留在 DOM 里，播完才真正卸载。 */
type PresenceState = 'open' | 'closing'

/**
 * presence：open 变 false 后不立刻卸载，先留 exitMs 播 CSS 退场（元素挂 data-state='closing'），
 * 窗口期内又 open 回来则退回 'open' —— transition 从当前值反向接着走，不会重头播。
 */
function usePresence(open: boolean, exitMs: number): { mounted: boolean; state: PresenceState } {
  const [mounted, setMounted] = useState(open)
  const state: PresenceState = open ? 'open' : 'closing'

  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    if (!mounted) return
    const id = window.setTimeout(() => setMounted(false), exitMs)
    return () => window.clearTimeout(id)
  }, [open, mounted, exitMs])

  return { mounted, state }
}

/**
 * 冻结最后一次 open 时的内容：关闭瞬间调用方常会 setSelectedId(null)，children 当帧就空了，
 * 不冻结会看到抽屉里先闪白再退场。open 期间每次渲染刷新快照，退场期间只读快照。
 */
function useFrozen<T>(live: T, open: boolean): T {
  const snap = useRef(live)
  useEffect(() => {
    if (open) snap.current = live
  })
  return open ? live : snap.current
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
  const { mounted, state } = usePresence(open, MODAL_EXIT_MS)
  const frozenTitle = useFrozen(title, open)
  const frozenBody = useFrozen(children, open)
  const frozenFooter = useFrozen(footer, open)
  if (!mounted) return null
  return createPortal(
    <>
      <div className="overlay" data-state={state} onClick={onClose} />
      <div className="modal" data-state={state}>
        <div className="modal-card" style={width ? { width: 'min(' + width + 'px, 100%)' } : undefined}>
          <div className="modal-head">
            <div style={{ fontSize: 14, fontWeight: 600 }}>{frozenTitle}</div>
            <Button variant="ghost" size="sm" icon style={{ marginLeft: 'auto' }} onClick={onClose} aria-label={t('关闭')}>
              <X size={16} />
            </Button>
          </div>
          <div className="modal-body">{frozenBody}</div>
          {frozenFooter ? <div className="modal-foot">{frozenFooter}</div> : null}
        </div>
      </div>
    </>,
    document.body,
  )
}

/* ---------- 抽屉跟手拖拽（spec §4.4 状态机：idle → dragging → settling → idle） ---------- */

/** 一次拖拽的全部状态，放 ref 里：跟手期间每帧直接写行内样式，不触发 React 重渲染。 */
type DrawerDrag = {
  pointerId: number
  capture: HTMLElement       // setPointerCapture 的落点（.drawer-head）
  el: HTMLElement            // aside.drawer
  overlay: HTMLElement | null
  startX: number
  startOffset: number        // 起手时已有的位移（打断上一次 spring 时不是 0）
  width: number
  moves: { t: number; x: number }[]   // 最近几条轨迹，松手时算速度
  shown: number              // 当前实际位移（dragFollow 之后的像素）
  reduced: boolean           // 起手那一刻的 prefers-reduced-motion
  onMove: (e: PointerEvent) => void
  onUp: (e: PointerEvent) => void
}

function detachDrag(d: DrawerDrag) {
  window.removeEventListener('pointermove', d.onMove)
  window.removeEventListener('pointerup', d.onUp)
  window.removeEventListener('pointercancel', d.onUp)
}

/** 读元素当前的 translateX（px）：打断 spring 时要从屏幕上的位置继续，而不是从 0。 */
function translateXOf(el: HTMLElement): number {
  const tf = getComputedStyle(el).transform
  if (!tf || tf === 'none') return 0
  try {
    return new DOMMatrixReadOnly(tf).m41
  } catch {
    return 0
  }
}

/** 手势结束：把遮罩的行内透明度与过渡恢复成 CSS 说了算。 */
function resetOverlay(d: DrawerDrag) {
  if (!d.overlay) return
  d.overlay.style.transition = ''
  d.overlay.style.opacity = ''
}

/** 直接写行内 transform + 遮罩透明度衰减（不用 CSS 变量驱动子元素，spec §4.4）。 */
function applyDragOffset(d: DrawerDrag, x: number) {
  d.shown = x
  d.el.style.transform = 'translate3d(' + x + 'px, 0, 0)'
  if (d.overlay) d.overlay.style.opacity = String(Math.max(0, 1 - (x / d.width) * 0.9))
}

export function Drawer({ open, onClose, title, children, footer }: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  useEscape(open, onClose)
  const { mounted, state } = usePresence(open, DRAWER_EXIT_MS)
  const frozenTitle = useFrozen(title, open)
  const frozenBody = useFrozen(children, open)
  const frozenFooter = useFrozen(footer, open)

  const drawerRef = useRef<HTMLElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DrawerDrag | null>(null)
  const settleRef = useRef<(() => void) | null>(null)   // 正在跑的 spring 的 cancel
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  // 拖拽关到底后行内 transform 会留到卸载（见 onDone）；若退场窗口内又 open 回来，
  // 必须立刻清掉它，否则抽屉会带着 translateX(100%) 出现在屏幕外。
  useEffect(() => {
    if (!open) return
    if (drawerRef.current) drawerRef.current.style.transform = ''
    if (overlayRef.current) overlayRef.current.style.opacity = ''
  }, [open])

  // 卸载兜底：拖到一半路由切走时，事件监听、指针捕获与还在跑的 spring 都要收干净
  useEffect(() => () => {
    const d = dragRef.current
    if (d) {
      detachDrag(d)
      try { d.capture.releasePointerCapture(d.pointerId) } catch { /* 已释放 */ }
    }
    dragRef.current = null
    settleRef.current?.()
    settleRef.current = null
  }, [])

  function onHeadPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!open) return
    const el = drawerRef.current
    if (!el) return
    const target = e.target as HTMLElement
    // 只认抽屉头（以及移动端的手势条）：正文里绝不抓，否则会抢走表单的文本选择
    const handle = target.closest('.drawer-head, .drawer-grab')
    if (!handle || !el.contains(handle)) return
    // 头部里的按钮 / 链接 / 输入框照常工作
    if (target.closest('button, a, input, textarea, select, label, [role="button"]')) return
    if (e.pointerType === 'mouse' && e.button !== 0) return

    // 上一次 spring 还在跑（拖到一半松手又抓回来）：立刻接管，从当前位移继续
    settleRef.current?.()
    settleRef.current = null

    const width = el.getBoundingClientRect().width || 1
    const d: DrawerDrag = {
      pointerId: e.pointerId,
      capture: handle as HTMLElement,
      el,
      overlay: overlayRef.current,
      startX: e.clientX,
      startOffset: translateXOf(el),
      width,
      moves: [{ t: performance.now(), x: e.clientX }],
      shown: 0,
      reduced: prefersReducedMotion(),
      onMove: () => {},
      onUp: () => {},
    }
    d.shown = d.startOffset

    d.onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== d.pointerId) return
      const dx = Math.max(0, d.startOffset + (ev.clientX - d.startX))   // 只允许向右关
      d.moves.push({ t: performance.now(), x: ev.clientX })
      if (d.moves.length > 5) d.moves.shift()
      // 减少动效：不跟手（spec §4.7「拖拽位移禁用、松手即关」），只记录轨迹
      if (d.reduced) return
      applyDragOffset(d, dragFollow(dx, d.width))
    }

    d.onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== d.pointerId) return
      if (dragRef.current === d) dragRef.current = null
      detachDrag(d)
      try { d.capture.releasePointerCapture(d.pointerId) } catch { /* 已释放 */ }
      d.el.removeAttribute('data-dragging')

      // 松手速度：最近 100ms 的平均速度（px/ms，向右为正）
      const now = performance.now()
      const recent = d.moves.filter((m) => now - m.t <= 100)
      let v = 0
      if (recent.length >= 2) {
        const dt = recent[recent.length - 1].t - recent[0].t
        if (dt > 0) v = (recent[recent.length - 1].x - recent[0].x) / dt
      }
      const dx = Math.max(0, d.startOffset + (ev.clientX - d.startX))
      const projected = dx + project(v)
      const closing = projected > d.width * 0.5 || v > FLICK_VELOCITY

      // 减少动效：不播 spring，直接判定开 / 关（CSS 过渡已被全局兜底压成 1ms）
      if (d.reduced) {
        d.el.style.transform = ''
        resetOverlay(d)
        if (closing) closeRef.current()
        return
      }

      settleRef.current?.()
      settleRef.current = spring({
        from: d.shown,
        to: closing ? d.width : 0,
        velocity: v,
        zeta: SPRING_DRAWER.zeta,
        response: SPRING_DRAWER.response,
        onFrame: (x) => applyDragOffset(d, Math.min(Math.max(x, 0), d.width)),
        onDone: () => {
          settleRef.current = null
          if (closing) {
            // 已经停在屏幕外：保留行内 transform 到卸载（presence 播完退场再移除元素），
            // 此时清掉会看到抽屉「又滑一次」。
            closeRef.current()
            return
          }
          d.el.style.transform = ''
          resetOverlay(d)
        },
      })
    }

    dragRef.current = d
    if (d.overlay) d.overlay.style.transition = 'none' // 跟手期间遮罩不能跟着 200ms 过渡滞后
    try { d.capture.setPointerCapture(e.pointerId) } catch { /* 捕获失败也别中断手势 */ }
    el.setAttribute('data-dragging', 'true')
    window.addEventListener('pointermove', d.onMove)
    window.addEventListener('pointerup', d.onUp)
    window.addEventListener('pointercancel', d.onUp)
  }

  if (!mounted) return null
  return createPortal(
    <>
      <div className="overlay" ref={overlayRef} data-state={state} onClick={onClose} />
      <aside className="drawer" ref={drawerRef} data-state={state} role="dialog" aria-modal="true">
        <div className="drawer-head" onPointerDown={onHeadPointerDown}>
          <div className="grow" style={{ minWidth: 0 }}>{frozenTitle}</div>
          <Button variant="ghost" size="sm" icon onClick={onClose} aria-label={t('关闭')}>
            <X size={16} />
          </Button>
        </div>
        <div className="drawer-body">{frozenBody}</div>
        {frozenFooter ? <div className="drawer-foot">{frozenFooter}</div> : null}
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
