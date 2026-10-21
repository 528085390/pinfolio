import { cx } from '../lib/api'

// 心跳条：卡片和抽屉共用一份渲染逻辑，免得两处各写一套四态判断。
// 四态监视器（每日打卡那种按天心跳）靠心跳消息前缀上色，Kuma 的 status 只有 up/down 区分不出来。
export type BeatCell = { status: number | null; tone: string | null }

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

export function BeatStrip({ cells, type, title }: { cells: BeatCell[]; type: string; title?: string }) {
  return (
    <div className={cx('monitor-beats')} title={title}>
      {cells.length === 0
        ? <i className="s-none" />
        : cells.map((b, i) => <i key={i} className={beatClass(b, type)} />)}
    </div>
  )
}
