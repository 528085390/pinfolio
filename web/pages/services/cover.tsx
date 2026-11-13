import type { CSSProperties, ReactNode } from 'react'
import type { ServiceRec } from '../../lib/api'
import { KIND_LABEL } from './model'

/**
 * 服务卡的封面：一张卡就是这张服务的一张「代表图」。
 *
 * 原则（2026-11-13 用户定的方向）：
 *  - 图上不塞信息，卡面只留「名字 + 一行说明 + 底部药丸」，一眼看过去是图墙；
 *  - 图不追求真实截图，可以是这台服务的字标 + 图标（用户原话：「随便截张图或者你画一张就行」）；
 *  - 有真实横幅就优先用图（IMG），没有就按 BRAND 表画字标，BRAND 里也没有就按类型兜底。
 *
 * 换图只改 BRAND 一行：服务 id → [字标, 小标签, 色相, 图标名]。
 */

export type CoverSpec = {
  /** 衬线大字：这张服务自己怎么写自己的名字 */
  word: string
  /** 字标下面那行小标签（小写英文 / 中文短语都行） */
  tag: string
  /** 色相：0–360，卡面底色、图标、水印都由它推出来 */
  hue: number
  /** 图标（24×24 线稿，描边由 CSS 给） */
  glyph: ReactNode
  /** 有横幅 / 截图就用图，不画字标 */
  img?: string
}

/** 线稿图标，统一 24×24、不填色、描边 1.7 */
const GLYPH: Record<string, ReactNode> = {
  package: (
    <>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
      <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
    </>
  ),
  cog: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v2.6M12 18.4V21M3 12h2.6M18.4 12H21M5.6 5.6l1.9 1.9M16.5 16.5l1.9 1.9M18.4 5.6l-1.9 1.9M7.5 16.5l-1.9 1.9" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M3.4 12h17.2M12 3.4c2.6 2.4 3.9 5.4 3.9 8.6s-1.3 6.2-3.9 8.6c-2.6-2.4-3.9-5.4-3.9-8.6S9.4 5.8 12 3.4z" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4.6" width="18" height="14.8" rx="3" />
      <path d="M7.4 10l2.4 2.2-2.4 2.2M12.6 14.4h4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7.4V12l3.2 2" />
    </>
  ),
  router: (
    <>
      <path d="M4 15h16v5H4z" />
      <path d="M8 17.5h.01M12 17.5h.01" />
      <path d="M12 11V6l-3.2 2M12 6l3.2 2" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="9" r="3" />
      <path d="M3.6 19c.6-3 2.8-4.6 5.4-4.6S13.8 16 14.4 19" />
      <circle cx="16.6" cy="8.6" r="2.3" />
      <path d="M15.2 13.3c2.5-.2 4.4 1.3 5 4" />
    </>
  ),
  pin: (
    <>
      <path d="M9.2 3h5.6l-1.1 5.1 3.1 3.1v1.6h-3.1l-.4 5.2h-5.8l-.4-5.2H3.2v-1.6l3.1-3.1L9.2 3z" />
      <path d="M12 18.2V22" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="3" />
      <path d="M8 3.5v3M16 3.5v3M3.5 10h17" />
      <path d="M8.6 14.6l2.1 2.1 4.2-4.3" />
    </>
  ),
  flame: <path d="M12 21c3.6 0 6-2.4 6-5.6 0-4-3.4-5.9-4.3-9.4-.9 2-2.4 2.6-3.4 4.3-.6-1-.8-2-.8-3.2C7.6 9.4 6 11.8 6 15.4 6 18.6 8.4 21 12 21z" />,
  pulse: <path d="M2.5 12h4l2.4-6 4.2 12.5 2.4-6.5h6" />,
  rings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="10.6" />
    </>
  ),
  rays: (
    <>
      <circle cx="12" cy="12" r="2.6" />
      <path d="M12 2.4v3.2M12 18.4v3.2M2.4 12h3.2M18.4 12h3.2M5.1 5.1l2.3 2.3M16.6 16.6l2.3 2.3M18.9 5.1l-2.3 2.3M7.4 16.6l-2.3 2.3" />
    </>
  ),
  bolt: <path d="M13.6 2.6L5.4 13.6h5.6l-1.4 7.8 8.2-11H12l1.6-5z" />,
  grid: (
    <>
      <rect x="3" y="3" width="7.6" height="7.6" rx="1.8" />
      <rect x="13.4" y="3" width="7.6" height="7.6" rx="1.8" />
      <rect x="3" y="13.4" width="7.6" height="7.6" rx="1.8" />
      <rect x="13.4" y="13.4" width="7.6" height="7.6" rx="1.8" />
    </>
  ),
  wave: (
    <>
      <path d="M2.5 9.2c2.9 0 2.9-3.4 5.8-3.4s2.9 3.4 5.8 3.4 2.9-3.4 5.8-3.4" />
      <path d="M2.5 15.4c2.9 0 2.9-3.4 5.8-3.4s2.9 3.4 5.8 3.4 2.9-3.4 5.8-3.4" />
    </>
  ),
  gate: (
    <>
      <path d="M4 21V9l8-5.6L20 9v12" />
      <path d="M9.2 21v-6.2h5.6V21" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2.8l7 2.6v6.2c0 4.4-3 7.7-7 9.3-4-1.6-7-4.9-7-9.3V5.4l7-2.6z" />
      <path d="M8.8 11.9l2.3 2.3 4.2-4.5" />
    </>
  ),
  loop: (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 3.6v4.2h-4.2" />
    </>
  ),
  chart: (
    <>
      <path d="M3.4 20.6h17.2" />
      <rect x="6" y="12" width="3.4" height="6" rx="1.1" />
      <rect x="10.9" y="8" width="3.4" height="10" rx="1.1" />
      <rect x="15.8" y="4.6" width="3.4" height="13.4" rx="1.1" />
    </>
  ),
  chip: (
    <>
      <rect x="5.6" y="5.6" width="12.8" height="12.8" rx="2.6" />
      <rect x="9.8" y="9.8" width="4.4" height="4.4" rx="1" />
      <path d="M9.4 2.6v3M14.6 2.6v3M9.4 18.4v3M14.6 18.4v3M2.6 9.4h3M2.6 14.6h3M18.4 9.4h3M18.4 14.6h3" />
    </>
  ),
  coins: (
    <>
      <ellipse cx="12" cy="6.4" rx="7" ry="3" />
      <path d="M5 6.4v5.1c0 1.7 3.1 3 7 3s7-1.3 7-3V6.4" />
      <path d="M5 11.5v5.1c0 1.7 3.1 3 7 3s7-1.3 7-3v-5.1" />
    </>
  ),
  hub: (
    <>
      <circle cx="12" cy="12" r="2.6" />
      <circle cx="4.6" cy="6" r="1.9" />
      <circle cx="19.4" cy="6" r="1.9" />
      <circle cx="4.6" cy="18" r="1.9" />
      <circle cx="19.4" cy="18" r="1.9" />
      <path d="M6.2 7.3l3.9 3.2M17.8 7.3l-3.9 3.2M6.2 16.7l3.9-3.2M17.8 16.7l-3.9-3.2" />
    </>
  ),
  wall: (
    <>
      <rect x="3" y="4.6" width="18" height="14.8" rx="2.6" />
      <path d="M3 9.5h18M3 14.5h18M8.6 4.6v4.9M15.4 9.5v5M8.6 14.5v4.9" />
    </>
  ),
  archive: (
    <>
      <rect x="3" y="4" width="18" height="4.6" rx="1.7" />
      <path d="M4.9 8.6v10c0 .9.7 1.6 1.6 1.6h11c.9 0 1.6-.7 1.6-1.6v-10" />
      <path d="M9.6 12.6h4.8" />
    </>
  ),
  eye: (
    <>
      <path d="M2.6 12S6 6.6 12 6.6 21.4 12 21.4 12 18 17.4 12 17.4 2.6 12 2.6 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  tree: (
    <>
      <circle cx="12" cy="3" r="1.5" />
      <path d="M12 4.6v3.2M12 7.8H6.4v3.6M12 7.8h5.6v3.6M12 7.8v8" />
      <rect x="4" y="11.4" width="5" height="4.6" rx="1.4" />
      <rect x="15" y="11.4" width="5" height="4.6" rx="1.4" />
      <rect x="9.5" y="15.8" width="5" height="5.2" rx="1.4" />
    </>
  ),
}

/** 没有专属封面时按类型给的色相与图标（跟观测台/资产页的配色一致：项目橙、服务蓝、站点紫、脚本青、任务红） */
const HUE_BY_KIND: Record<string, number> = { project: 18, service: 198, site: 268, script: 152, task: 10 }
const GLYPH_BY_KIND: Record<string, string> = {
  project: 'package',
  service: 'cog',
  site: 'globe',
  script: 'terminal',
  task: 'clock',
}

/** 服务 id → [字标, 小标签, 色相, 图标名]。加一个服务想给它专属封面，就在这里加一行。 */
const BRAND: Record<string, [string, string, number, string]> = {
  wbapi: ['wb2api', 'openai 兼容 · 号池网关', 26, 'router'],
  manager: ['WorkBuddy', '账号池 · 管理端', 32, 'users'],
  pinboard: ['pinfolio', 'notes · assets · monitors', 22, 'pin'],
  yb: ['签到台', 'daily check-in', 44, 'calendar'],
  douyin: ['续火花', 'streak panel', 350, 'flame'],
  streak: ['心跳', 'heartbeat push', 8, 'pulse'],
  singbox: ['sing-box', 'reality + hysteria2', 205, 'rings'],
  xray: ['Xray', 'vless · reality', 228, 'rays'],
  hysteria: ['Hysteria2', 'udp 443 · quic', 192, 'bolt'],
  caddy: ['Caddy', 'auto tls · web', 268, 'grid'],
  v2ray: ['V2Ray', 'ws backend', 176, 'wave'],
  nginx: ['Nginx', 'entry · subscription', 262, 'gate'],
  demos: ['NOCTURNE', '5 个演示站 · 8443', 268, 'globe'],
  certbot: ['certbot', '3 张证书 · 自动续期', 140, 'shield'],
  sub2api: ['sub2api', 'keepalive · 15min', 158, 'loop'],
  nodemetrics: ['node-metrics', '/proc · 5 min', 148, 'chart'],
  memwatch: ['memwatch', 'rss · 300s', 164, 'chip'],
  costguard: ['costguard', 'oci 成本 · 30min', 172, 'coins'],
  subhub: ['subhub', '30min rotate', 154, 'hub'],
  armfw: ['arm-firewall', 'iptables', 188, 'wall'],
  restic: ['restic', 'daily 05:10', 20, 'archive'],
  hy2cert: ['hy2cert', 'expiry watch', 196, 'eye'],
  doctree: ['doc-tree', 'daily 09:10', 250, 'tree'],
}

/** 有真实横幅的服务：用图代替字标（图片放 web/public/covers/） */
const IMG: Record<string, string> = { demos: 'covers/demos.webp' }

/** 部署在子路径时（PINBOARD_BASE=pinfolio）静态资源也得跟着走 */
const asset = (p: string) => (import.meta.env.BASE_URL || '/') + p

export function coverSpecOf(svc: ServiceRec): CoverSpec {
  const b = BRAND[svc.id]
  if (b) return { word: b[0], tag: b[1], hue: b[2], glyph: GLYPH[b[3]] ?? GLYPH.package, img: IMG[svc.id] }
  const name = svc.name.trim()
  return {
    word: name.length > 14 ? name.slice(0, 13) + '…' : name,
    tag: KIND_LABEL[svc.kind] ?? '',
    hue: HUE_BY_KIND[svc.kind] ?? 30,
    glyph: GLYPH[GLYPH_BY_KIND[svc.kind] ?? 'package'],
    img: IMG[svc.id],
  }
}

/** 字标长度决定字号：短名大字，长名小字，都不撑破卡片 */
function wordSize(word: string): number {
  if (word.length <= 8) return 30
  if (word.length <= 11) return 26
  if (word.length <= 14) return 22
  return 19
}

/**
 * 卡面底图：有图用图（虚化铺底 + 原图居中，宽横幅也不会被裁掉字），
 * 没图就用「图标徽章 + 衬线字标 + 小标签」画一张。
 */
export function ServiceCover({ svc }: { svc: ServiceRec }) {
  const c = coverSpecOf(svc)
  const style = { '--svc-hue': String(c.hue) } as CSSProperties
  if (c.img) {
    const url = `url(${asset(c.img)})`
    return (
      <div className="svc-cover is-img" style={style} aria-hidden="true">
        <span className="svc-cover-fill" style={{ backgroundImage: url }} />
        <span className="svc-cover-sharp" style={{ backgroundImage: url }} />
      </div>
    )
  }
  return (
    <div className="svc-cover" style={style} aria-hidden="true">
      <svg className="svc-wm" viewBox="0 0 24 24">{c.glyph}</svg>
      <span className="svc-badge">
        <svg viewBox="0 0 24 24">{c.glyph}</svg>
      </span>
      <span className="svc-word" style={{ fontSize: wordSize(c.word) }}>{c.word}</span>
      {c.tag ? <span className="svc-tag">{c.tag}</span> : null}
    </div>
  )
}
