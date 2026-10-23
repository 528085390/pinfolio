import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from './migrations.js'
import { extractTags, PRESET_TAGS, TAG_COLORS, tagColor } from './tags.js'

// 纯函数挪到 tags.ts 是为了能单测（本文件一 import 就打开 SQLite、跑迁移）；
// 这里再导出一次，老的 `from '../db.js'` 调用点不用改。
export { extractTags, PRESET_TAGS, TAG_COLORS, tagColor }

const here = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(here, '..')
export const DATA_DIR = process.env.PINBOARD_DATA ? resolve(process.env.PINBOARD_DATA) : join(ROOT, 'data')
mkdirSync(DATA_DIR, { recursive: true })
export const DB_PATH = join(DATA_DIR, 'pinboard.db')

export const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 5000')

// 表结构演进走有序迁移（server/migrations.ts）：每步一个事务，只追加、不改旧步。
migrate(db)

export const nowIso = () => new Date().toISOString()

export function all<T = any>(sql: string, ...params: any[]): T[] {
  return db.prepare(sql).all(...params) as T[]
}
export function get<T = any>(sql: string, ...params: any[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined
}
export function run(sql: string, ...params: any[]) {
  const r = db.prepare(sql).run(...params)
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) }
}

export function upsertTag(name: string) {
  run('INSERT INTO tags (name, color) VALUES (?, ?) ON CONFLICT(name) DO NOTHING', name, tagColor(name))
  return get<{ id: number }>('SELECT id FROM tags WHERE name = ?', name)!.id
}

export function syncNoteTags(noteId: number, content: string) {
  run('DELETE FROM note_tags WHERE note_id = ?', noteId)
  for (const name of extractTags(content)) {
    const tagId = upsertTag(name)
    run('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)', noteId, tagId)
  }
}

export function setAssetTags(assetId: number, names: string[]) {
  run('DELETE FROM asset_tags WHERE asset_id = ?', assetId)
  for (const raw of names) {
    const name = String(raw).trim().replace(/^#/, '')
    if (!name) continue
    const tagId = upsertTag(name)
    run('INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?, ?)', assetId, tagId)
  }
}

export function toBool(v: any) {
  return v === true || v === 1 || v === '1' ? 1 : 0
}

// 老库补列与预设标签都在 migrations.ts 的 v1 里（本文件只负责开库）。
