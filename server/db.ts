import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CORE_SCHEMA } from './schema/core.js'
import { MAIL_SCHEMA } from './schema/mail.js'
import { METRICS_SCHEMA } from './schema/metrics.js'
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

const SCHEMA = CORE_SCHEMA + "\n" + MAIL_SCHEMA + "\n" + METRICS_SCHEMA
db.exec(SCHEMA)

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

// ---- 迁移：给老库补 notes.done 列 ----
const noteCols = all<{ name: string }>('PRAGMA table_info(notes)').map((r) => r.name)
if (!noteCols.includes('done')) {
  db.exec('ALTER TABLE notes ADD COLUMN done INTEGER NOT NULL DEFAULT 0')
}

// ---- 迁移：给老库补 mail_accounts.proxy 列（2026-10-21：国内直连 imap.gmail.com 被墙，需要 SOCKS5 代理）----
const mailCols = all<{ name: string }>('PRAGMA table_info(mail_accounts)').map((r) => r.name)
if (!mailCols.includes('proxy')) {
  db.exec("ALTER TABLE mail_accounts ADD COLUMN proxy TEXT NOT NULL DEFAULT ''")
}

// ---- 预设标签：只写一次（用 PRAGMA user_version 做标记，删掉不会再被塞回来）----
const userVersion = get<{ user_version: number }>('PRAGMA user_version')!.user_version
if (userVersion < 1) {
  for (const [name, color] of PRESET_TAGS) {
    run('INSERT INTO tags (name, color) VALUES (?, ?) ON CONFLICT(name) DO NOTHING', name, color)
  }
  db.exec('PRAGMA user_version = 1')
}
