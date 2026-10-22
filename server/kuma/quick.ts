import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// 观测台顶部的「快捷入口」卡片（quick-links.json，每次请求热读，改完刷新页面即生效）。
// 与观测项无关：不产生 Kuma 检查、没有心跳与状态、不进统计与筛选，整张卡就是一个外链。
// 每条形如 { "name": "Immich 图库", "url": "http://…:2283", "note": "os · 东京", "label": "悬停提示", "icon": "image" }
const QUICK_FILE = process.env.MONITOR_QUICK || join(process.cwd(), 'quick-links.json')

export type QuickLink = {
  /** 卡片标题；留空时退回 URL 的 host */
  name: string
  /** 只认 http(s)，其余一律丢掉 */
  url: string
  /** 副标题：放机器 / 端口这类定位信息；空串时前端退回显示 host */
  note: string
  /** 悬停提示；空串时前端用 name */
  label: string
  /** 图标名（image / globe / link…），不认识的前端退回默认图标 */
  icon: string
}

export const QUICK_NAME_MAX = 40
export const QUICK_NOTE_MAX = 60

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

/** 只认 http(s)：手滑写成 javascript: / data: 也不会变成可点的链接。 */
export function isHttpUrl(url: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(url)
}

/** 取 host:port 给副标题兜底；解析不出来回空串。 */
export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/**
 * 解析 quick-links.json 的内容：坏条目跳过、同一 URL 只留第一条（重复写不会出现两张一样的卡）。
 * 不碰文件，纯函数，单测在 tests/unit/kuma-quick.test.mts。
 */
export function parseQuick(input: unknown): QuickLink[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const out: QuickLink[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const url = text(r.url, 500)
    if (!isHttpUrl(url) || seen.has(url)) continue
    const name = text(r.name, QUICK_NAME_MAX) || hostOf(url)
    if (!name) continue
    seen.add(url)
    out.push({
      name,
      url,
      note: text(r.note, QUICK_NOTE_MAX),
      label: text(r.label, 200) || name,
      icon: text(r.icon, 20),
    })
  }
  return out
}

export function loadQuick(): QuickLink[] {
  try {
    return parseQuick(JSON.parse(readFileSync(QUICK_FILE, 'utf8')))
  } catch {
    return [] // 没配置（或写坏了）就当没有快捷入口，观测台照常
  }
}
