import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const QUICK_FILE = process.env.MONITOR_QUICK || join(process.cwd(), 'quick-links.json')

export type QuickLink = {
  name: string
  url: string
  note: string
  label: string
  icon: string
}

export const QUICK_NAME_MAX = 40
export const QUICK_NOTE_MAX = 60

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

export function isHttpUrl(url: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(url)
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

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
    return []
  }
}
