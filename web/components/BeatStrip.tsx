import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../lib/api'
import { relativeTime, stamp } from '../lib/format'
import { STATUS, TONE } from '../pages/monitors/status'
import { t, useLocale } from '../lib/i18n'

// 心跳条：卡片和抽屉共用一份渲染逻辑，免得两处各写一套四态判断。
// 四态监视器（每日打卡那种按天心跳）靠心跳消息前缀上色，Kuma 的 status 只有 up/down 区分不出来。
export type BeatCell = { status: number | null; tone: string | null }

/** 一拍的心跳细节：卡片从列表 payload 的 beatTimes/beatMsgs/beatPings 取，抽屉从详情接口的 beats 取。 */
export type BeatDetail = { time?: string | null; msg?: string | null; ping?: number | null }

export function beatClass(b: BeatCell, type: string): string {
  // 四态前缀是心跳消息里的中文标签（数据，不是界面文案），写成 \u 转义，免得被 i18n 巡检当成待翻译
  if (b.tone === '\u7eff') return 's1' // 绿
  if (b.tone === '\u9ec4') return 's2' // 黄
  if (b.tone === '\u7ea2') return 's0' // 红
  if (b.tone === '\u7070') return 's3' // 灰
  if (type === 'push') return 's-none'
  if (b.status === 1) return 's1'
  if (b.status === 0) return 's0'
  if (b.status === 2) return 's2'
  if (b.status === 3) return 's3'
  return 's-none'
}

/** 这一拍该显示什么：四态优先，再看 Kuma 状态码，都没有 = 无数据。 */
function labelOf(b: BeatCell) {
  if (b.tone && TONE[b.tone]) return TONE[b.tone]
  return b.status === null ? null : STATUS[b.status] || null
}

/** 提示框与色条的间距（px） */
const TIP_GAP = 8
/** 离视口左右边缘的最小距离（px，留半个提示框宽 + 余量，靠边的卡片也不会把框顶出屏幕） */
const TIP_EDGE = 150
/** 色条离视口上沿小于这个距离就往下弹，否则往上弹（px，够放一个提示框 + 间距） */
const TIP_FLIP = 120

type Hit = { i: number; x: number; top: number; bottom: number }

/**
 * 40 段心跳色条。给了 details 就逐拍悬停显示「这一拍的时间 / 状态 / 响应 / 消息」。
 * 提示框必须 portal 到 body + position:fixed：`.content` 是 overflow auto/hidden 的滚动容器，
 * 卡片里任何绝对定位的弹层都会被裁掉（见坑 11、坑 31）。
 */
export function BeatStrip({ cells, type, title, details }: {
  cells: BeatCell[]
  type: string
  /** 没给 details 时整条退回原来的原生 title */
  title?: string
  /** 与 cells 一一对应；缺项（null）的那一拍不弹提示 */
  details?: (BeatDetail | null)[]
}) {
  useLocale() // 组件被 React.memo 包着时要自己订阅语言，切语言才重渲染
  const [hit, setHit] = useState<Hit | null>(null)
  const hasDetail = !!details && details.length > 0
  const open = hit !== null

  // 滚动 / 改窗口大小后锚点坐标就失效了：直接收起，免得提示框飘在原地
  useEffect(() => {
    if (!open) return
    const clear = () => setHit(null)
    window.addEventListener('scroll', clear, true)
    window.addEventListener('resize', clear)
    return () => {
      window.removeEventListener('scroll', clear, true)
      window.removeEventListener('resize', clear)
    }
  }, [open])

  // 挂在整条上，但「第几拍」取鼠标实际落在的那一段（ev.target），不是用 clientX 按等宽反推：
  // 悬停会让这一段变宽、把左右邻居挤开，用坐标算出来的边界跟着动，会把自己挤到邻居身上抖成一片（见坑 32）。
  function track(ev: React.MouseEvent<HTMLDivElement>) {
    if (!hasDetail || cells.length === 0) return
    const el = ev.target as HTMLElement
    const own = el.tagName === 'I' && el.parentElement === ev.currentTarget && el.dataset.i !== undefined
    if (!own) return // 划在 2px 的缝隙上：保持现状，别闪
    const i = Number(el.dataset.i)
    if (!details![i]) return
    const r = ev.currentTarget.getBoundingClientRect()
    // 变宽是绕这一段的中心对称进行的，所以拿它自己的中心当提示框锚点
    const br = el.getBoundingClientRect()
    const x = br.left + br.width / 2
    // 同一拍内来回移动不要每帧重渲染整条色条
    setHit((prev) => (prev && prev.i === i && prev.top === r.top && prev.bottom === r.bottom ? prev : { i, x, top: r.top, bottom: r.bottom }))
  }

  const d = hit && details ? details[hit.i] : null
  const cell = hit ? cells[hit.i] : null
  const info = cell ? labelOf(cell) : null
  // 色条靠近视口上沿就往下弹，否则往上弹；水平夹在视口内
  const below = hit ? hit.top < TIP_FLIP : false
  const tipStyle = hit
    ? {
        left: Math.min(Math.max(hit.x, TIP_EDGE), Math.max(TIP_EDGE, window.innerWidth - TIP_EDGE)),
        top: below ? hit.bottom + TIP_GAP : hit.top - TIP_GAP,
        transform: below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
      }
    : undefined

  return (
    <div
      className={cx('monitor-beats')}
      title={hasDetail ? undefined : title}
      onMouseMove={hasDetail ? track : undefined}
      onMouseLeave={hasDetail ? () => setHit(null) : undefined}
    >
      {cells.length === 0
        ? <i className="s-none" />
        : cells.map((b, i) => (
            <i key={i} data-i={i} className={cx(beatClass(b, type), hit?.i === i ? 'hot' : '')} />
          ))}
      {d && hit
        ? createPortal(
            <div className="beat-tip" style={tipStyle}>
              <div className="beat-tip-head">
                <span className="status-dot" style={{ background: info ? info.color : 'var(--muted)' }} />
                <span className="beat-tip-status">{info ? info.label : t('无数据')}</span>
                <span className="beat-tip-time">{d.time ? stamp(d.time) : '—'}</span>
              </div>
              <div className="beat-tip-sub">
                <span>{d.time ? relativeTime(d.time) : t('时间未知')}</span>
                {typeof d.ping === 'number' ? <span>{d.ping} ms</span> : null}
                <span className="beat-tip-idx">{t('第 {i}/{n} 拍', { i: hit.i + 1, n: cells.length })}</span>
              </div>
              {d.msg ? <div className="beat-tip-msg">{d.msg}</div> : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
