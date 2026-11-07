import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const LINKS_FILE = process.env.MONITOR_LINKS || join(process.cwd(), 'monitor-links.json')

export type LinkRule = { name?: string; id?: number; url: string; label?: string }

export type LinkRef = { id: number; name: string }

export function loadLinks(): LinkRule[] {
  try {
    const parsed = JSON.parse(readFileSync(LINKS_FILE, 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter((r: any) => r && typeof r.url === 'string' && r.url)
  } catch {
    return []
  }
}

export function pickLink(rules: LinkRule[], m: LinkRef): { url: string; label: string } | null {
  const hit = rules.find((r) => typeof r.id === 'number' && r.id === m.id)
    || rules.find((r) => r.name && r.name === m.name)
  return hit ? { url: hit.url, label: hit.label || hit.url } : null
}
