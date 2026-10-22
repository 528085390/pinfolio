import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../lib/api'
import { relativeTime, stamp } from '../lib/format'
import { STATUS, TONE } from '../pages/monitors/status'

// 心跳条：卡片和抽屉共用一份渲染逻辑，免得两处各写一套四态判断。
// 四态监视器（每日打卡那种按天心跳）靠心跳消息前缀上色，Kuma 的 status 只有 up/down 区分不出来。
export type BeatCell = { status: number | null; tone: string | null }

/** 一拍的心跳细节：卡片从列表 payload 的 beatTimes/beatMsgs/beatPings 取，抽屉从详情接口的 beats 取。 */
export type BeatDetail = { time?: string | null; msg?: string | null; ping?: number | null }

export function beatClass(b: BeatCell, type: string): string {
  if (b.tone === '绿') return 's1'
  if (b.tone === '黄') return 's2'
  if (b.tone === '红') return 's0'
  if (b.tone === '灰') return 's3'
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

  // 挂在整条上按 x 反推是第几拍（比 40 个 onMouseEnter 稳：划过 2px 的缝隙时不会闪烁）
  function track(ev: React.MouseEvent<HTMLDivElement>) {
    if (!hasDetail || cells.length === 0) return
    const r = ev.currentTarget.getBoundingClientRect()
    if (!r.width) return
    const i = Math.min(cells.length - 1, Math.max(0, Math.floor(((ev.clientX - r.left) / r.width) * cells.length)))
    if (!details![i]) { setHit(null); return }
    const x = r.left + (r.width * (i + 0.5)) / cells.length
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
        : cells.map((b, i) => <i key={i} className={beatClass(b, type)} />)}
      {d && hit
        ? createPortal(
            <div className="beat-tip" style={tipStyle}>
              <div className="beat-tip-head">
                <span className="status-dot" style={{ background: info ? info.color : 'var(--muted)' }} />
                <span className="beat-tip-status">{info ? info.label : '无数据'}</span>
                <span className="beat-tip-time">{d.time ? stamp(d.time) : '—'}</span>
              </div>
              <div className="beat-tip-sub">
                <span>{d.time ? relativeTime(d.time) : '时间未知'}</span>
                {typeof d.ping === 'number' ? <span>{d.ping} ms</span> : null}
                <span className="beat-tip-idx">第 {hit.i + 1}/{cells.length} 拍</span>
              </div>
              {d.msg ? <div className="beat-tip-msg">{d.msg}</div> : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
