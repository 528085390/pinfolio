import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'

test('SQLite PRAGMA 配置：synchronous 设为 NORMAL(1)', () => {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  const row: any = db.prepare('PRAGMA synchronous').get()
  assert.equal(Number(row.synchronous), 1)
})

test('SQLite PRAGMA 配置：cache_size 设为 -20000', () => {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA cache_size = -20000')
  const row: any = db.prepare('PRAGMA cache_size').get()
  assert.equal(Number(row.cache_size), -20000)
})

test('SQLite PRAGMA 配置：temp_store 设为 MEMORY(2)', () => {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA temp_store = MEMORY')
  const row: any = db.prepare('PRAGMA temp_store').get()
  assert.equal(Number(row.temp_store), 2)
})
