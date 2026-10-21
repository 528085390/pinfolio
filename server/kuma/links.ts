import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// 观测项 → 项目管理页的跳转表（monitor-links.json，可随时改，不用重启）。
// 每条形如 { "name": "Kuma 里的监视器名", "url": "...", "label": "悬浮提示" }，
// name 对不上时还可以用 { "id": 6, "url": "..." }。
const LINKS_FILE = process.env.MONITOR_LINKS || join(process.cwd(), 'monitor-links.json')

export type LinkRule = { name?: string; id?: number; url: string; label?: string }

/** 只要 id + name：状态页的观测项、socket 回来的 bean 都能直接传进来。 */
export type LinkRef = { id: number; name: string }

export function loadLinks(): LinkRule[] {
  try {
    const parsed = JSON.parse(readFileSync(LINKS_FILE, 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter((r: any) => r && typeof r.url === 'string' && r.url)
  } catch {
    return [] // 没配置就当没有管理页
  }
}

/**
 * 按 id 优先匹配：观测项可以在抽屉里改名，名字不再是稳定键（改名后按名字配的规则会失配）。
 * name 规则保留作兜底，给「按名字写更顺手」的临时配置用。
 */
export function pickLink(rules: LinkRule[], m: LinkRef): { url: string; label: string } | null {
  const hit = rules.find((r) => typeof r.id === 'number' && r.id === m.id)
    || rules.find((r) => r.name && r.name === m.name)
  return hit ? { url: hit.url, label: hit.label || hit.url } : null
}
