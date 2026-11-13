import type { CSSProperties } from 'react'
import type { ServiceRec } from '../../lib/api'
import { KIND_LABEL } from './model'

/**
 * 服务卡的封面：一张卡 = 这张服务的一张小海报。
 *
 * 原则（2026-11-14 用户改的方向）：
 *  - 之前「图标 + 字标」太单一，改成每个服务自己一张构图：不同的几何场景、不同的双色调、
 *    不同的留白与压角，让人一眼认出是哪一台服务，而不是一堆同样的模板；
 *  - 场景全部是 SVG 现画的（不联网、不截图、不随机种子），每个服务固定一套，重建也一样；
 *  - 有真图（演示站那张 NOCTURNE 横幅）就优先用图，图上叠一层同色系洗色；
 *  - 图里不写长句，卡面信息还是「名字 + 一行说明 + 底部药丸」，图只负责气质。
 *
 * 加一个服务：在 CASES 里补一行 { word, tag, motif, hue, hue2, anchor, notes }。
 */

/** 场景类型：每个都是一种真实拓扑/气质，不是图标 */
type Motif =
  | 'funnel' | 'accountgrid' | 'notes' | 'calendar' | 'flame' | 'ecg' | 'orbit'
  | 'prism' | 'comets' | 'rings' | 'wavebars' | 'fanout' | 'renewring' | 'pipeline'
  | 'trace' | 'membars' | 'meter' | 'hub' | 'fwgrid' | 'slabs' | 'seal' | 'tree'

/** 场景重心：决定画面往哪个角压，避免 23 张卡长得一样 */
type Anchor = 'tr' | 'br' | 'center' | 'full' | 'left' | 'right'

export type CoverSpec = {
  word: string
  tag: string
  hue: number
  hue2: number
  motif: Motif
  anchor: Anchor
  /** 角落里的技术注脚，1–2 条，很短 */
  notes: string[]
  img?: string
}

/** 每台服务的真图：能截到管理页的直接截图，跑在后台没有页面的截它的 systemctl / 配置输出 */
const IMG: Record<string, string> = {
  wbapi: 'covers/wbapi.webp',
  manager: 'covers/manager.webp',
  pinboard: 'covers/pinboard.webp',
  yb: 'covers/yb.webp',
  douyin: 'covers/douyin.webp',
  singbox: 'covers/singbox.webp',
  xray: 'covers/xray.webp',
  hysteria: 'covers/hysteria.webp',
  caddy: 'covers/caddy.webp',
  v2ray: 'covers/v2ray.webp',
  nginx: 'covers/nginx.webp',
  apicdemo: 'covers/apicdemo.webp',
  pricing: 'covers/pricing.webp',
  bank: 'covers/bank.webp',
  si: 'covers/si.webp',
  certbot: 'covers/certbot.webp',
  sub2api: 'covers/sub2api.webp',
  nodemetrics: 'covers/nodemetrics.webp',
  memwatch: 'covers/memwatch.webp',
  costguard: 'covers/costguard.webp',
  subhub: 'covers/subhub.webp',
  armfw: 'covers/armfw.webp',
  restic: 'covers/restic.webp',
  hy2cert: 'covers/hy2cert.webp',
  doctree: 'covers/doctree.webp',
  'english-practice-machine': 'covers/epm.webp',
}


/** 真 UI 截图：放大并往 logo 那边偏，让小字截图也有「一张图」的存在感 */
const ZOOM: Record<string, [number, string]> = {
  wbapi: [178, '0% 6%'],
  manager: [178, '0% 6%'],
  pinboard: [156, '10% 8%'],
  yb: [170, '0% 4%'],
  douyin: [172, '0% 0%'],
  'english-practice-machine': [176, '0% 2%'],
  pricing: [172, '0% 6%'],
  bank: [168, '50% 34%'],
  si: [172, '50% 28%'],
  sub2api: [170, '0% 4%'],
}
/** 宽横幅（3:1 那种）用「模糊铺底 + 居中完整显示」，截图（4:3）用 cover 铺满 */
const WIDE = new Set(['apicdemo'])
/** 封面是 public/ 下的定名文件，换图后靠这个版本号让浏览器重新拉 */
const COVER_V = '20261114f'
const asset = (p: string) => `${import.meta.env.BASE_URL || '/'}${p}?v=${COVER_V}`

const KIND_HUE: Record<string, number> = { project: 18, service: 198, site: 268, script: 152, task: 10 }

/** 23 台服务，一台一套 */
const CASES: Record<string, [string, string, Motif, number, number, Anchor, string[]]> = {
  // id          字标             小标签                   场景          主色  辅色  重心      注脚
  wbapi: ['wb2api', 'OPENAI · 号池网关', 'funnel', 26, 44, 'right', ['/v1 · 7863', 'pool → gateway']],
  manager: ['WorkBuddy', '账号池 · 管理端', 'accountgrid', 214, 220, 'center', ['7864', 'accounts']],
  pinboard: ['pinfolio', 'NOTES · ASSETS', 'notes', 26, 12, 'br', ['7798', 'notes · assets']],
  yb: ['签到台', 'DAILY CHECK-IN', 'calendar', 44, 30, 'right', ['8787', 'daily']],
  douyin: ['续火花', 'STREAK PANEL', 'flame', 348, 20, 'center', ['8765', 'streak']],
  streak: ['心跳', 'HEARTBEAT PUSH', 'ecg', 6, 26, 'full', ['cron', 'daily 08:30']],
  singbox: ['sing-box', 'REALITY · HY2', 'orbit', 196, 210, 'br', ['443 tcp/udp', 'os · ox']],
  xray: ['Xray', 'VLESS · REALITY', 'prism', 268, 292, 'left', ['443', 'oj · aws']],
  hysteria: ['Hysteria2', 'UDP 443 · QUIC', 'comets', 178, 196, 'full', ['443/udp', 'aws']],
  caddy: ['Caddy', 'AUTO TLS · WS', 'rings', 232, 258, 'center', ['8443', '80 → 308']],
  v2ray: ['V2Ray', 'WS BACKEND', 'wavebars', 150, 172, 'full', ['29195', 'loopback']],
  nginx: ['Nginx', 'SNI · SUBSCRIBE', 'fanout', 104, 138, 'right', ['80 / 443', '/sub/']],
  demos: ['NOCTURNE', 'A-PICTURE DEMO', 'orbit', 44, 38, 'center', ['8443', '×5 sites']],
  certbot: ['certbot', 'LE AUTO RENEW', 'renewring', 46, 32, 'center', ['timer', '3 certs']],
  sub2api: ['sub2api', 'KEEP-ALIVE', 'pipeline', 158, 178, 'left', ['15s', 'reset loop']],
  nodemetrics: ['node-metrics', 'PROC · DF 5 MIN', 'trace', 168, 190, 'full', ['4 nodes', '/var/lib']],
  memwatch: ['memwatch', 'MEMORY WATCHDOG', 'membars', 186, 202, 'left', ['300s', '60 MB']],
  costguard: ['costguard', 'OCI COST GUARD', 'meter', 34, 18, 'center', ['30 min', 'budget']],
  subhub: ['subhub', 'SUBSCRIPTION HUB', 'hub', 202, 220, 'center', ['30 min', 'push → os']],
  armfw: ['arm-firewall', 'NFTABLES WHITELIST', 'fwgrid', 244, 268, 'full', ['inbound', 'allowlist']],
  restic: ['restic', 'DAILY SNAPSHOT', 'slabs', 216, 236, 'left', ['oci bucket', 'incremental']],
  hy2cert: ['hy2cert', 'CERT EXPIRY WATCH', 'seal', 190, 208, 'center', ['self-signed', 'alert']],
  doctree: ['doctree', 'AGENTS DRIFT AUDIT', 'tree', 262, 286, 'right', ['09:10', 'links']],
}

const FALLBACK: [string, string, Motif, number, number, Anchor, string[]] = ['', '', 'notes', 30, 22, 'br', []]

export function coverSpecOf(svc: ServiceRec): CoverSpec {
  const row = CASES[svc.id] ?? FALLBACK
  const name = svc.name.trim()
  const word = row[0] || (name.length > 14 ? name.slice(0, 13) + '…' : name)
  return {
    word,
    tag: row[1] || KIND_LABEL[svc.kind] || '',
    motif: row[2],
    hue: row[3] || KIND_HUE[svc.kind] || 30,
    hue2: row[4] || (KIND_HUE[svc.kind] ?? 30) + 18,
    anchor: row[5],
    notes: row[6].length ? row[6] : [KIND_LABEL[svc.kind] ?? ''],
    img: IMG[svc.id],
  }
}

/* ---------------- 画场景 ---------------- */

const W = 320
const H = 240

type Ink = { line: string; soft: string; fill: string; alt: string; paper: string }

function ink(h: number, h2: number): Ink {
  return {
    line: `hsl(${h} 72% 64%)`,
    soft: `hsl(${h} 62% 58% / .38)`,
    fill: `hsl(${h} 70% 56% / .16)`,
    alt: `hsl(${h2} 68% 62%)`,
    paper: 'hsl(40 30% 94% / .82)',
  }
}

/** 场景按 320×240 画，卡片是 4:3，切片铺满 */
function scene(motif: Motif, h: number, h2: number) {
  const c = ink(h, h2)
  const P = c.paper
  switch (motif) {
    case 'funnel':
      return (
        <>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <path key={i} d={`M14 ${92 + i * 9} H150 C186 ${92 + i * 9} 200 120 232 120`}
              fill="none" stroke={i % 2 ? c.soft : c.line} strokeWidth={i % 2 ? 1 : 1.3} strokeLinecap="round" opacity={0.35 + i * 0.1} />
          ))}
          <path d="M232 96h34a10 10 0 0 1 10 10v28a10 10 0 0 1-10 10h-34a10 10 0 0 1-10-10v-28a10 10 0 0 1 10-10z" fill="none" stroke={P} strokeWidth="1.3" />
          <path d="M240 120h18" stroke={P} strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="259" cy="120" r="2.6" fill={c.alt} />
        </>
      )
    case 'accountgrid':
      return (
        <>
          {Array.from({ length: 18 }).map((_, i) => {
            const x = 88 + (i % 6) * 25
            const y = 62 + Math.floor(i / 6) * 25
            const lit = i === 8 || i === 15 || i === 3
            return (
              <rect key={i} x={x} y={y} width="17" height="17" rx="5"
                fill={lit ? c.fill : 'none'} stroke={lit ? c.line : c.soft} strokeWidth={lit ? 1.4 : 1} />
            )
          })}
          <rect x="128" y="150" width="64" height="18" rx="9" fill={P} opacity=".9" />
          <path d="M150 159h20" stroke="hsl(220 20% 12%)" strokeWidth="1.6" strokeLinecap="round" />
        </>
      )
    case 'notes':
      return (
        <>
          <g transform="translate(46 44) rotate(-7)">
            <rect width="150" height="112" rx="10" fill="hsl(40 40% 96% / .07)" stroke={c.soft} />
          </g>
          <g transform="translate(64 54) rotate(-2)">
            <rect width="150" height="112" rx="10" fill="hsl(40 40% 96% / .1)" stroke={c.soft} />
            {[0, 1, 2, 3].map((i) => (
              <path key={i} d={`M18 ${30 + i * 17}h${i === 3 ? 60 : 112}`} stroke={i === 0 ? c.line : c.soft} strokeWidth={i === 0 ? 2 : 1.2} strokeLinecap="round" />
            ))}
          </g>
          <g transform="translate(196 96)">
            <circle r="26" fill={c.fill} stroke={c.line} strokeWidth="1.4" />
            <path d="M0 -13c6 0 10 4.4 10 10 0 7-10 16-10 16S-10 4-10-3c0-5.6 4.4-10 10-10z" fill="none" stroke={P} strokeWidth="1.6" />
            <circle cy="-3" r="3.4" fill={P} />
          </g>
        </>
      )
    case 'calendar':
      return (
        <>
          <rect x="60" y="56" width="196" height="132" rx="10" fill="hsl(40 40% 96% / .05)" stroke={c.soft} />
          <path d="M60 84h196" stroke={c.soft} />
          {Array.from({ length: 28 }).map((_, i) => {
            const x = 74 + (i % 7) * 26
            const y = 96 + Math.floor(i / 7) * 24
            const done = i < 19
            return done ? (
              <path key={i} d={`M${x} ${y + 4}l4 4 7-8`} stroke={i > 15 ? c.alt : c.line} strokeWidth="1.6" fill="none" strokeLinecap="round" />
            ) : (
              <circle key={i} cx={x + 5} cy={y + 4} r="2" fill={c.soft} />
            )
          })}
        </>
      )
    case 'flame':
      return (
        <>
          <path d="M160 196c-30 0-50-20-50-46 0-30 26-44 34-70 22 20 30 32 30 48 8-8 10-18 10-28 18 18 26 34 26 50 0 26-20 46-50 46z"
            fill={c.fill} stroke={c.line} strokeWidth="1.4" />
          <path d="M160 176c-12 0-20-9-20-20 0-12 10-18 14-28 8 10 12 16 12 24 4-4 6-10 6-14 6 8 8 14 8 20 0 11-8 18-20 18z"
            fill="none" stroke={c.alt} strokeWidth="1.3" />
          {[[112, 60], [206, 74], [96, 128], [222, 138], [160, 40]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={i % 2 ? 1.6 : 2.4} fill={c.alt} opacity={0.45 + i * 0.1} />
          ))}
        </>
      )
    case 'ecg':
      return (
        <>
          <path d="M0 150h320M0 110h320" stroke={c.soft} strokeWidth="0.8" strokeDasharray="2 6" />
          <path d="M0 138h54l10-8 9 34 12-62 11 40 10 10h30l14-6 10 6h48l10-8 9 34 12-62 11 40 10 10h30"
            fill="none" stroke={c.line} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <path d="M0 138h54l10-8 9 34 12-62 11 40 10 10h30l14-6 10 6h48l10-8 9 34 12-62 11 40 10 10h30"
            fill="none" stroke={c.alt} strokeWidth="6" opacity=".12" strokeLinejoin="round" />
          <circle cx="170" cy="118" r="3.4" fill={c.alt} />
        </>
      )
    case 'orbit':
      return (
        <>
          {[34, 62, 92].map((r, i) => (
            <ellipse key={r} cx="196" cy="140" rx={r * 1.5} ry={r} fill="none" stroke={i === 1 ? c.line : c.soft}
              strokeWidth={i === 1 ? 1.2 : 0.9} transform={`rotate(${-18 + i * 12} 196 140)`} strokeDasharray={i === 2 ? '3 7' : undefined} />
          ))}
          <circle cx="196" cy="140" r="9" fill={c.fill} stroke={c.line} strokeWidth="1.4" />
          <circle cx="196" cy="140" r="3" fill={c.alt} />
          {[[250, 96], [140, 118], [262, 178]].map(([x, y], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r="4" fill="hsl(40 30% 96% / .9)" />
              <circle cx={x} cy={y} r="9" fill="none" stroke={c.soft} />
            </g>
          ))}
        </>
      )
    case 'prism':
      return (
        <>
          <path d="M0 128h116" stroke="hsl(40 30% 96% / .75)" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M162 60l52 96h-104z" fill="hsl(40 30% 96% / .06)" stroke={P} strokeWidth="1.3" />
          {[0, 1, 2, 3, 4].map((i) => (
            <path key={i} d={`M182 138L320 ${52 + i * 26}`} stroke={i === 2 ? c.alt : c.line} strokeWidth={i === 2 ? 2.2 : 1.2} opacity={0.5 + i * 0.1} strokeLinecap="round" />
          ))}
        </>
      )
    case 'comets':
      return (
        <>
          {[[40, 190, 150], [110, 210, 120], [80, 120, 190], [190, 200, 96], [150, 60, 210], [250, 150, 150]].map(([x, y, len], i) => (
            <g key={i} opacity={0.4 + (i % 3) * 0.2}>
              <path d={`M${x} ${y}l${len * 0.5} -${len * 0.5}`} stroke={i % 2 ? c.alt : c.line} strokeWidth={i % 3 === 0 ? 2.2 : 1.2} strokeLinecap="round" />
              <circle cx={x} cy={y} r={i % 3 === 0 ? 3 : 1.8} fill={P} opacity=".8" />
            </g>
          ))}
        </>
      )
    case 'rings':
      return (
        <>
          {[96, 74, 52, 30].map((r, i) => (
            <circle key={r} cx="160" cy="120" r={r} fill="none" stroke={i === 1 ? c.line : c.soft}
              strokeWidth={i === 0 ? 1 : 1.2} strokeDasharray={i % 2 ? '5 9' : undefined} />
          ))}
          <rect x="148" y="108" width="24" height="20" rx="4" fill="none" stroke={P} strokeWidth="1.5" />
          <path d="M153 108v-6a7 7 0 0 1 14 0v6" fill="none" stroke={P} strokeWidth="1.5" />
          {Array.from({ length: 24 }).map((_, i) => {
            const a = (i / 24) * Math.PI * 2
            return <path key={i} d={`M${160 + Math.cos(a) * 100} ${120 + Math.sin(a) * 100}L${160 + Math.cos(a) * 108} ${120 + Math.sin(a) * 108}`} stroke={c.soft} strokeWidth="1" />
          })}
        </>
      )
    case 'wavebars':
      return (
        <>
          {Array.from({ length: 26 }).map((_, i) => {
            const hh = 14 + Math.abs(Math.sin(i * 0.7)) * 80
            return <rect key={i} x={18 + i * 11} y={150 - hh / 2} width="4" height={hh} rx="2"
              fill={i % 5 === 0 ? c.alt : c.line} opacity={0.35 + (hh / 100) * 0.6} />
          })}
          <path d="M12 150h296" stroke={c.soft} strokeWidth="1" strokeDasharray="3 7" />
        </>
      )
    case 'fanout':
      return (
        <>
          <circle cx="46" cy="120" r="10" fill={c.fill} stroke={c.line} strokeWidth="1.4" />
          {[36, 78, 120, 162, 204].map((y, i) => (
            <g key={y}>
              <path d={`M56 120C120 120 150 ${y} 226 ${y}`} fill="none" stroke={i === 2 ? c.line : c.soft} strokeWidth={i === 2 ? 1.6 : 1} />
              <circle cx="232" cy={y} r="6" fill="none" stroke={i === 2 ? P : c.soft} strokeWidth="1.2" />
            </g>
          ))}
        </>
      )
    case 'renewring':
      return (
        <>
          {Array.from({ length: 12 }).map((_, i) => {
            const a0 = (i / 12) * Math.PI * 2 - Math.PI / 2
            const a1 = ((i + 0.72) / 12) * Math.PI * 2 - Math.PI / 2
            const r = 74
            return (
              <path key={i}
                d={`M${160 + Math.cos(a0) * r} ${118 + Math.sin(a0) * r}A${r} ${r} 0 0 1 ${160 + Math.cos(a1) * r} ${118 + Math.sin(a1) * r}`}
                fill="none" stroke={i < 9 ? c.line : c.soft} strokeWidth="7" strokeLinecap="round" opacity={i < 9 ? 0.9 : 0.5} />
            )
          })}
          <path d="M160 96v22l14 10" stroke={P} strokeWidth="1.8" fill="none" strokeLinecap="round" />
        </>
      )
    case 'pipeline':
      return (
        <>
          {[0, 1, 2].map((i) => (
            <rect key={i} x={50 + i * 84} y={104} width="56" height="34" rx="8" fill={i === 1 ? c.fill : 'none'} stroke={i === 1 ? c.line : c.soft} strokeWidth="1.3" />
          ))}
          <path d="M106 121h28M190 121h28" stroke={c.line} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M132 110l5 11-5 11M216 110l5 11-5 11" fill="none" stroke={c.line} strokeWidth="1.4" strokeLinecap="round" />
          <path d="M78 138c0 40 164 40 164 0" fill="none" stroke={c.alt} strokeWidth="1.2" strokeDasharray="4 6" />
          <circle cx="78" cy="138" r="3" fill={c.alt} />
        </>
      )
    case 'trace':
      return (
        <>
          {Array.from({ length: 5 }).map((_, i) => (
            <path key={i} d={`M28 ${52 + i * 34}h268`} stroke={c.soft} strokeWidth="0.8" strokeDasharray="2 8" />
          ))}
          <path d="M28 186c30 0 40-52 70-52s44 34 74 34 40-64 72-64 36 30 52 30" fill="none" stroke={c.line} strokeWidth="2" strokeLinecap="round" />
          <path d="M28 186c30 0 40-52 70-52s44 34 74 34 40-64 72-64 36 30 52 30V202H28z" fill={c.fill} stroke="none" />
          {[[98, 134], [172, 168], [244, 104]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3" fill="hsl(40 30% 96% / .9)" />)}
        </>
      )
    case 'membars':
      return (
        <>
          {[0, 1, 2].map((i) => (
            <rect key={i} x="40" y={70 + i * 34} width="200" height="16" rx="8" fill="none" stroke={c.soft} />
          ))}
          {[0, 1, 2].map((i) => (
            <rect key={'f' + i} x="40" y={70 + i * 34} width={[168, 122, 44][i]} height="16" rx="8" fill={i === 2 ? c.alt : c.line} opacity={i === 2 ? 0.75 : 0.35} />
          ))}
          <path d="M110 56v124" stroke="hsl(0 70% 60% / .7)" strokeWidth="1.2" strokeDasharray="5 6" />
          <circle cx="252" cy="120" r="17" fill="none" stroke={c.line} strokeWidth="1.3" strokeDasharray="4 5" />
        </>
      )
    case 'meter':
      return (
        <>
          <path d="M64 176a96 96 0 0 1 192 0" fill="none" stroke={c.soft} strokeWidth="10" strokeLinecap="round" />
          <path d="M64 176a96 96 0 0 1 118-92" fill="none" stroke={c.line} strokeWidth="10" strokeLinecap="round" />
          <path d="M160 176L206 106" stroke={P} strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="160" cy="176" r="5" fill={P} />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <circle key={i} cx={92 + i * 27} cy={206} r={i < 4 ? 5 : 3} fill="none" stroke={i < 4 ? c.alt : c.soft} strokeWidth="1.2" />
          ))}
        </>
      )
    case 'hub':
      return (
        <>
          <circle cx="160" cy="120" r="26" fill={c.fill} stroke={c.line} strokeWidth="1.5" />
          <circle cx="160" cy="120" r="7" fill={c.alt} />
          {Array.from({ length: 8 }).map((_, i) => {
            const a = (i / 8) * Math.PI * 2 - Math.PI / 2
            const x = 160 + Math.cos(a) * 84
            const y = 120 + Math.sin(a) * 84
            return (
              <g key={i}>
                <path d={`M${160 + Math.cos(a) * 26} ${120 + Math.sin(a) * 26}L${x} ${y}`} stroke={c.soft} strokeWidth="1" />
                <circle cx={x} cy={y} r="7" fill="none" stroke={i % 3 === 0 ? c.line : c.soft} strokeWidth="1.2" />
              </g>
            )
          })}
        </>
      )
    case 'fwgrid':
      return (
        <>
          {Array.from({ length: 90 }).map((_, i) => {
            const x = 44 + (i % 15) * 16
            const y = 62 + Math.floor(i / 15) * 22
            const blocked = i === 41 || i === 42 || i === 57 || i === 72
            const open = i === 33 || i === 60
            return blocked ? (
              <path key={i} d={`M${x - 3} ${y - 3}l7 7M${x + 4} ${y - 3}l-7 7`} stroke="hsl(4 72% 58%)" strokeWidth="1.4" />
            ) : (
              <circle key={i} cx={x} cy={y} r={open ? 3 : 1.7} fill={open ? c.line : c.soft} />
            )
          })}
          <path d="M160 44l52 18v44c0 30-24 48-52 56-28-8-52-26-52-56V62z" fill="none" stroke={c.line} strokeWidth="1.2" opacity=".55" />
        </>
      )
    case 'slabs':
      return (
        <>
          {[0, 1, 2, 3].map((i) => (
            <g key={i} opacity={0.35 + i * 0.18}>
              <path d={`M${52 + i * 26} ${168 - i * 26}l62-30 62 30-62 30z`} fill={i === 3 ? c.fill : 'none'} stroke={i === 3 ? c.line : c.soft} strokeWidth="1.2" />
            </g>
          ))}
          <path d="M74 196l62-30 62 30" fill="none" stroke={c.alt} strokeWidth="1.2" strokeDasharray="4 6" />
        </>
      )
    case 'seal':
      return (
        <>
          <circle cx="160" cy="118" r="66" fill="none" stroke={c.line} strokeWidth="1.4" strokeDasharray="14 8" />
          <circle cx="160" cy="118" r="50" fill="none" stroke={c.soft} />
          <path d="M146 132l-22-14v-16l22-14 22 14v16z" fill="none" stroke={P} strokeWidth="1.5" />
          <path d="M156 108h8M160 104v8" stroke={P} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M232 168l16 26h-32z" fill="none" stroke="hsl(38 90% 62%)" strokeWidth="1.5" />
          <path d="M232 180v8M232 192v.8" stroke="hsl(38 90% 62%)" strokeWidth="1.8" strokeLinecap="round" />
        </>
      )
    case 'tree':
      return (
        <>
          <path d="M50 196V96m0 34h44m-44 34h44" stroke={c.soft} strokeWidth="1.2" />
          {[['140', '72'], ['140', '130'], ['140', '188']].map(([x, y], i) => (
            <g key={i}>
              <path d={`M94 ${i === 0 ? 72 : i === 1 ? 130 : 188}H${x}`} stroke={c.soft} strokeWidth="1.2" />
              <circle cx={Number(x)} cy={Number(y)} r="5" fill={i === 1 ? c.line : 'none'} stroke={i === 1 ? c.line : c.soft} strokeWidth="1.3" />
            </g>
          ))}
          <path d="M193 130h48m-48 58h48" stroke={c.soft} strokeWidth="1.1" />
          <circle cx="248" cy="130" r="4" fill="none" stroke={c.alt} strokeWidth="1.3" />
          <circle cx="248" cy="188" r="4" fill="none" stroke={c.alt} strokeWidth="1.3" />
          <circle cx="50" cy="96" r="6" fill={c.fill} stroke={c.line} strokeWidth="1.4" />
        </>
      )
  }
  return null
}

/** 场景重心 → 缩放/位移，让 23 张卡不重样 */
function place(anchor: Anchor): string {
  switch (anchor) {
    case 'tr': return 'translate(14 -6) scale(0.92)'
    case 'br': return 'translate(6 12) scale(0.96)'
    case 'center': return 'translate(0 4)'
    case 'left': return 'translate(-8 6) scale(1.02)'
    case 'right': return 'translate(10 2) scale(1.01)'
    default: return 'translate(0 0)'
  }
}

/** 角落刻度线，让画面有版式感 */
function rails(h: number, seed: number) {
  const o = (seed % 3) * 4
  return (
    <g stroke={`hsl(${h} 55% 70% / .18)`} strokeWidth="1">
      <path d={`M${16 + o} 18v10M${16 + o} 18h10`} />
      <path d={`M${W - 16 - o} ${H - 18}v-10M${W - 16 - o} ${H - 18}h-10`} />
      <path d={`M16 ${H / 2}h6`} />
      <path d={`M${W - 22} ${H / 2}h6`} />
    </g>
  )
}

export function ServiceCover({ svc }: { svc: ServiceRec }) {
  const c = coverSpecOf(svc)
  const seed = svc.id.length * 7 + svc.id.charCodeAt(0)
    const z = ZOOM[svc.id]
  const style = { '--svc-hue': String(c.hue), '--svc-hue2': String(c.hue2), ...(z ? { '--zoom': z[0] + '%', '--pos': z[1] } : {}) } as CSSProperties

  if (c.img) {
    const url = `url(${asset(c.img)})`
    return (
      <div className={`svc-cover is-img ${WIDE.has(svc.id) ? 'is-wide' : 'is-shot'}${ZOOM[svc.id] ? ' is-zoom' : ''}`} style={style} aria-hidden="true">
        <span className="svc-cover-fill" style={{ backgroundImage: url }} />
        <span className="svc-cover-sharp" style={{ backgroundImage: url }} />
        <span className="svc-wash" />
      </div>
    )
  }

  return (
    <div className="svc-cover" style={style} aria-hidden="true">
      <svg className="svc-scene" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id={`bg-${svc.id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={`hsl(${c.hue} 34% 12%)`} />
            <stop offset="58%" stopColor={`hsl(${c.hue2} 30% 8%)`} />
            <stop offset="100%" stopColor="hsl(30 14% 5%)" />
          </linearGradient>
          <radialGradient id={`bloom-${svc.id}`} cx="0.66" cy="0.42" r="0.62">
            <stop offset="0%" stopColor={`hsl(${c.hue} 80% 58% / .30)`} />
            <stop offset="60%" stopColor={`hsl(${c.hue2} 70% 50% / .10)`} />
            <stop offset="100%" stopColor="hsl(0 0% 0% / 0)" />
          </radialGradient>
        </defs>
        <rect width={W} height={H} fill={`url(#bg-${svc.id})`} />
        <rect width={W} height={H} fill={`url(#bloom-${svc.id})`} />
        <g opacity=".5">
          <circle cx={c.anchor === 'right' || c.anchor === 'tr' ? 250 : 90} cy="240" r="176"
            fill="none" stroke={`hsl(${c.hue2} 60% 60% / .16)`} strokeWidth="1" />
          <circle cx={c.anchor === 'right' || c.anchor === 'tr' ? 250 : 90} cy="240" r="206"
            fill="none" stroke={`hsl(${c.hue} 60% 66% / .1)`} strokeWidth="1" strokeDasharray="2 10" />
        </g>
        {rails(c.hue, seed)}
        <g transform={place(c.anchor)} opacity=".96">{scene(c.motif, c.hue, c.hue2)}</g>
      </svg>
      <span className="svc-grain" />
      <span className="svc-index">{svc.id.slice(0, 3).toUpperCase()}</span>
      <span className="svc-rail">
        {c.tag ? <b>{c.tag}</b> : null}
        {c.notes.map((n, i) => <i key={i}>{n}</i>)}
      </span>
    </div>
  )
}
