import { Camera, ExternalLink, Globe, Link2 } from 'lucide-react'
import type { QuickLink } from '../../lib/api'

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function Icon({ name }: { name: string }) {
  if (name === 'image' || name === 'photo' || name === 'camera') return <Camera size={15} />
  if (name === 'globe' || name === 'web') return <Globe size={15} />
  return <Link2 size={15} />
}

/**
 * 观测台顶部的「快捷入口」卡：整张卡就是一个外链，不参与观测
 * （没有状态、没有心跳、不进统计与筛选，配置在根目录 quick-links.json）。
 */
export function QuickLinks({ links }: { links: QuickLink[] }) {
  if (!links || links.length === 0) return null
  return (
    <>
      <div className="quick-head">
        快捷入口
        <span>不参与观测</span>
      </div>
      <div className="asset-grid monitor-grid quick-grid">
        {links.map((l) => (
          <a
            key={l.url}
            className="asset-card quick-card"
            href={l.url}
            target="_blank"
            rel="noreferrer noopener"
            title={l.label || l.url}
          >
            <div className="asset-card-head">
              <div className="asset-icon"><Icon name={l.icon} /></div>
              <div className="grow">
                <div className="asset-name">{l.name}</div>
                <div className="asset-sub">{l.note || hostOf(l.url)}</div>
              </div>
              <ExternalLink size={13} className="quick-open" />
            </div>
          </a>
        ))}
      </div>
    </>
  )
}
