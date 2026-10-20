import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(here, '..')
export const DATA_DIR = process.env.PINBOARD_DATA ? resolve(process.env.PINBOARD_DATA) : join(ROOT, 'data')
mkdirSync(DATA_DIR, { recursive: true })
export const DB_PATH = join(DATA_DIR, 'pinboard.db')

export const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS tags (',
  '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
  '  name TEXT NOT NULL UNIQUE,',
  '  color TEXT NOT NULL DEFAULT \'#b45309\'',
  ');',
  'CREATE TABLE IF NOT EXISTS field_defs (',
  '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
  '  key TEXT NOT NULL UNIQUE,',
  '  label TEXT NOT NULL,',
  '  type TEXT NOT NULL DEFAULT \'text\',',
  '  options TEXT NOT NULL DEFAULT \'[]\',',
  '  sort INTEGER NOT NULL DEFAULT 0',
  ');',
  'CREATE TABLE IF NOT EXISTS assets (',
  '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
  '  name TEXT NOT NULL,',
  '  kind TEXT NOT NULL DEFAULT \'device\',',
  '  status TEXT NOT NULL DEFAULT \'active\',',
  '  location TEXT NOT NULL DEFAULT \'\',',
  '  vendor TEXT NOT NULL DEFAULT \'\',',
  '  serial TEXT NOT NULL DEFAULT \'\',',
  '  price REAL,',
  '  currency TEXT NOT NULL DEFAULT \'CNY\',',
  '  purchased_at TEXT,',
  '  expires_at TEXT,',
  '  url TEXT NOT NULL DEFAULT \'\',',
  '  notes TEXT NOT NULL DEFAULT \'\',',
  '  custom TEXT NOT NULL DEFAULT \'{}\',',
  '  created_at TEXT NOT NULL,',
  '  updated_at TEXT NOT NULL',
  ');',
  'CREATE TABLE IF NOT EXISTS notes (',
  '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
  '  content TEXT NOT NULL DEFAULT \'\',',
  '  pinned INTEGER NOT NULL DEFAULT 0,',
  '  archived INTEGER NOT NULL DEFAULT 0,',
  '  done INTEGER NOT NULL DEFAULT 0,',
  '  asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,',
  '  created_at TEXT NOT NULL,',
  '  updated_at TEXT NOT NULL',
  ');',
  'CREATE TABLE IF NOT EXISTS note_tags (',
  '  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,',
  '  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,',
  '  PRIMARY KEY (note_id, tag_id)',
  ');',
  'CREATE TABLE IF NOT EXISTS asset_tags (',
  '  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,',
  '  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,',
  '  PRIMARY KEY (asset_id, tag_id)',
  ');',
  'CREATE INDEX IF NOT EXISTS idx_notes_created ON notes(created_at DESC);',
  'CREATE INDEX IF NOT EXISTS idx_notes_asset ON notes(asset_id);',
  'CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(kind);',
  'CREATE TABLE IF NOT EXISTS mail_accounts (',
  '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
  '  label TEXT NOT NULL DEFAULT \'\',',
  '  email TEXT NOT NULL DEFAULT \'\',',
  '  host TEXT NOT NULL,',
  '  port INTEGER NOT NULL DEFAULT 993,',
  '  username TEXT NOT NULL,',
  '  password TEXT NOT NULL DEFAULT \'\',',
  '  security TEXT NOT NULL DEFAULT \'ssl\',',
  '  enabled INTEGER NOT NULL DEFAULT 1,',
  '  sort INTEGER NOT NULL DEFAULT 0,',
  '  created_at TEXT NOT NULL,',
  '  updated_at TEXT NOT NULL',
  ');',
  'CREATE TABLE IF NOT EXISTS mail_local_read (',
  '  account_id INTEGER NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,',
  '  folder TEXT NOT NULL DEFAULT \'INBOX\',',
  '  uid INTEGER NOT NULL,',
  '  read_at TEXT NOT NULL,',
  '  PRIMARY KEY (account_id, folder, uid)',
  ');',
  'CREATE INDEX IF NOT EXISTS idx_mail_local_read_lookup ON mail_local_read(folder, account_id);',
  'CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag_id);',
  'CREATE INDEX IF NOT EXISTS idx_asset_tags_tag ON asset_tags(tag_id);',
].join('\n')

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

export const TAG_COLORS = ['#b45309', '#0f766e', '#7c3aed', '#be123c', '#0369a1', '#4d7c0f', '#a16207', '#c2410c', '#0e7490', '#9333ea']
export function tagColor(name: string) {
  let h = 0
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) || 0)) >>> 0
  return TAG_COLORS[h % TAG_COLORS.length]
}

export function upsertTag(name: string) {
  run('INSERT INTO tags (name, color) VALUES (?, ?) ON CONFLICT(name) DO NOTHING', name, tagColor(name))
  return get<{ id: number }>('SELECT id FROM tags WHERE name = ?', name)!.id
}

const TAG_RE = /(?:^|[\s(（\[【,，、。．！!？?；;：:>"'“”‘’《》「」『』])#([\p{L}\p{N}_\-\/]+)/gu
export function extractTags(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(TAG_RE)) {
    const t = m[1].replace(/[.,;:!?]+$/, '')
    if (t) out.add(t)
  }
  return [...out]
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

// ---- 预设标签：只写一次（用 PRAGMA user_version 做标记，删掉不会再被塞回来）----
export const PRESET_TAGS: [string, string][] = [
  ['待办', '#d97706'],
  ['想法', '#7c3aed'],
  ['阅读', '#0369a1'],
  ['工作', '#0f766e'],
  ['学习', '#4d7c0f'],
  ['生活', '#15803d'],
  ['灵感', '#a16207'],
  ['重要', '#b91c1c'],
  ['整理', '#65a30d'],
  ['运维', '#57534e'],
  ['账号', '#be123c'],
  ['购物', '#c2410c'],
]
const userVersion = get<{ user_version: number }>('PRAGMA user_version')!.user_version
if (userVersion < 1) {
  for (const [name, color] of PRESET_TAGS) {
    run('INSERT INTO tags (name, color) VALUES (?, ?) ON CONFLICT(name) DO NOTHING', name, color)
  }
  db.exec('PRAGMA user_version = 1')
}
