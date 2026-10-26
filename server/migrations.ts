import type { DatabaseSync } from 'node:sqlite'
import { snapshotBeforeMigrate } from './backup/premigrate.js'
import { ATTACHMENTS_SCHEMA } from './schema/attachments.js'
import { CORE_SCHEMA } from './schema/core.js'
import { MAIL_SCHEMA } from './schema/mail.js'
import { METRICS_SCHEMA } from './schema/metrics.js'
import { PRESET_TAGS } from './tags.js'
import { t } from './i18n.js'

// 表结构演进：只追加、不改旧步，每步一个事务。
// 版本号存在 PRAGMA user_version 里；老库（user_version = 0）由 v1 兜底归一。

export type Migration = { version: number; up: (db: DatabaseSync) => void }

const SCHEMA = [CORE_SCHEMA, MAIL_SCHEMA, METRICS_SCHEMA, ATTACHMENTS_SCHEMA].join('\n')

// 迁移前钩子：05 的自动备份注册进来，迁移前先快照一份。
const preMigrateHooks: Array<() => void> = []

export function registerPreMigrate(fn: () => void) {
  preMigrateHooks.push(fn)
}

export function currentVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
  return Number(row?.user_version ?? 0)
}

function columns(db: DatabaseSync, table: string): string[] {
  return db.prepare('PRAGMA table_info(' + table + ')').all().map((r: any) => String(r.name))
}

// v1：现有表结构基线 + 老库补列 + 预设标签（原 db.ts:67-86 的三段逻辑）。
function v1(db: DatabaseSync) {
  db.exec(SCHEMA)

  // 2026-10-20：便签增加「已完成」
  if (!columns(db, 'notes').includes('done')) {
    db.exec('ALTER TABLE notes ADD COLUMN done INTEGER NOT NULL DEFAULT 0')
  }
  // 2026-10-21：国内直连 imap.gmail.com 被墙，邮件账号需要 SOCKS5 代理
  if (!columns(db, 'mail_accounts').includes('proxy')) {
    db.exec("ALTER TABLE mail_accounts ADD COLUMN proxy TEXT NOT NULL DEFAULT ''")
  }

  // 预设标签只写一次（删掉不会再被塞回来）
  const insert = db.prepare('INSERT INTO tags (name, color) VALUES (?, ?) ON CONFLICT(name) DO NOTHING')
  for (const [name, color] of PRESET_TAGS) insert.run(name, color)
}

// v2：鉴权（见 docs/superpowers/specs/2026-10-23-pinfolio-oss/02-auth.md）
const AUTH_SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  token_hash   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  ua           TEXT NOT NULL DEFAULT '',
  ip           TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS api_tokens (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_used_at TEXT
);
`

function v2(db: DatabaseSync) {
  db.exec(AUTH_SCHEMA)
}

// v3：便签图片（2026-10-26）。只新建一张表，不动旧表；真身在 data/uploads/。
// 老库走到这里时 v1 已经跑过（那时 SCHEMA 里还没有这张表），所以单独补一步。
function v3(db: DatabaseSync) {
  db.exec(ATTACHMENTS_SCHEMA)
}

export const MIGRATIONS: Migration[] = [
  { version: 1, up: v1 },
  { version: 2, up: v2 },
  { version: 3, up: v3 },
]

export type MigrateOptions = {
  /** 给了就拍迁移前快照（data/backups/pre-migrate-v<旧版本>-<时间戳>.db，保留 5 份） */
  dataDir?: string
  keep?: number
}

export function migrate(db: DatabaseSync, migrations: Migration[] = MIGRATIONS, opts: MigrateOptions = {}): number {
  const from = currentVersion(db)
  const pending = migrations.filter((m) => m.version > from).sort((a, b) => a.version - b.version)
  if (pending.length === 0) return from
  for (const hook of preMigrateHooks) hook()
  if (opts.dataDir) {
    try {
      const file = snapshotBeforeMigrate(db, opts.dataDir, from, opts.keep ?? 5)
      if (file) console.log('  迁移前已备份  ->  ' + file)
    } catch (err) {
      // 拍不了快照就不升级：宁可不升，也不要留下没有退路的半迁移库
      throw new Error(t('迁移前备份失败，已中止升级：') + (err instanceof Error ? err.message : String(err)))
    }
  }
  for (const m of pending) {
    db.exec('BEGIN')
    try {
      m.up(db)
      db.exec('PRAGMA user_version = ' + m.version)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
  return currentVersion(db)
}
