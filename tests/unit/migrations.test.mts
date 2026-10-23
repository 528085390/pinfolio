import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS, migrate, currentVersion } from '../../server/migrations.js'
import { CORE_SCHEMA } from '../../server/schema/core.js'
import { MAIL_SCHEMA } from '../../server/schema/mail.js'

const tables = (db: DatabaseSync) =>
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r: any) => r.name)
const cols = (db: DatabaseSync, t: string) =>
  db.prepare('PRAGMA table_info(' + t + ')').all().map((r: any) => r.name)

test('空库迁移到最新版本，表齐全', () => {
  const db = new DatabaseSync(':memory:')
  const to = migrate(db, MIGRATIONS)
  assert.equal(to, MIGRATIONS[MIGRATIONS.length - 1].version)
  assert.equal(currentVersion(db), to)
  const t = tables(db)
  for (const name of ['tags', 'field_defs', 'assets', 'notes', 'note_tags', 'asset_tags', 'mail_accounts', 'mail_local_read', 'host_metrics']) {
    assert.ok(t.includes(name), '缺表 ' + name)
  }
})

test('预设标签写入一次，重复迁移不会重复塞', () => {
  const db = new DatabaseSync(':memory:')
  migrate(db, MIGRATIONS)
  const first = db.prepare('SELECT COUNT(*) AS n FROM tags').get() as any
  assert.ok(Number(first.n) > 0, '预设标签没写进去')
  migrate(db, MIGRATIONS)
  const second = db.prepare('SELECT COUNT(*) AS n FROM tags').get() as any
  assert.equal(Number(second.n), Number(first.n))
})

test('老库（user_version = 0、缺 done / proxy 列）归一到 v1', () => {
  // 造一个「老库」：先按真实 schema 建表，再把后加的两列删掉、版本号归零
  const db = new DatabaseSync(':memory:')
  db.exec(CORE_SCHEMA)
  db.exec(MAIL_SCHEMA)
  db.exec('ALTER TABLE notes DROP COLUMN done')
  db.exec('ALTER TABLE mail_accounts DROP COLUMN proxy')
  assert.ok(!cols(db, 'notes').includes('done'))
  assert.ok(!cols(db, 'mail_accounts').includes('proxy'))
  migrate(db, MIGRATIONS)
  assert.ok(cols(db, 'notes').includes('done'), 'notes.done 没补上')
  assert.ok(cols(db, 'mail_accounts').includes('proxy'), 'mail_accounts.proxy 没补上')
  assert.equal(currentVersion(db), MIGRATIONS[MIGRATIONS.length - 1].version)
})

test('迁移中途抛错：回滚该步、版本号停在上一步', () => {
  const db = new DatabaseSync(':memory:')
  const bad = [
    { version: 1, up(d: DatabaseSync) { d.exec('CREATE TABLE a (x TEXT)') } },
    { version: 2, up() { throw new Error('boom') } },
  ]
  assert.throws(() => migrate(db, bad), /boom/)
  assert.equal(currentVersion(db), 1)
  assert.ok(tables(db).includes('a'))
})
