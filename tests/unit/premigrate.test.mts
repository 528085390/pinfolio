import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { migrate, type Migration } from '../../server/migrations.js'
import { prunePremigrate, snapshotBeforeMigrate, PREMIGRATE_RE } from '../../server/backup/premigrate.js'

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'pinfolio-premigrate-'))
}

test('全新库（user_version=0）不拍快照', () => {
  const dir = tmp()
  try {
    const db = new DatabaseSync(join(dir, 'a.db'))
    assert.equal(snapshotBeforeMigrate(db, dir, 0), null)
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('升级前拍一张，数据跟着走', () => {
  const dir = tmp()
  try {
    const db = new DatabaseSync(join(dir, 'pinboard.db'))
    db.exec('CREATE TABLE t (v TEXT)')
    db.exec("INSERT INTO t VALUES ('keep-me')")
    db.exec('PRAGMA user_version = 1')
    const step: Migration = { version: 2, up: (d) => d.exec('CREATE TABLE t2 (v TEXT)') }
    assert.equal(migrate(db, [step], { dataDir: dir }), 2)
    const names = readdirSync(join(dir, 'backups'))
    assert.equal(names.length, 1)
    assert.ok(PREMIGRATE_RE.test(names[0]), names[0])
    // 快照里是升级前的样子：有 t，没有 t2
    const snap = new DatabaseSync(join(dir, 'backups', names[0]))
    const rows = snap.prepare('SELECT v FROM t').all() as { v: string }[]
    assert.equal(rows[0].v, 'keep-me')
    assert.throws(() => snap.prepare('SELECT 1 FROM t2').get())
    snap.close()
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('快照只留最近 5 份，不碰别的备份', () => {
  const dir = tmp()
  try {
    mkdirSync(join(dir, 'backups'), { recursive: true })
    for (let i = 1; i <= 7; i++) {
      const f = join(dir, 'backups', 'pre-migrate-v1-2026010' + i + '030000.db')
      writeFileSync(f, 'x')
      utimesSync(f, new Date(2026, 0, i), new Date(2026, 0, i))
    }
    writeFileSync(join(dir, 'backups', 'pinfolio-20260101-0300.tar.gz'), 'x')
    const dead = prunePremigrate(join(dir, 'backups'), 5)
    assert.equal(dead.length, 2)
    const left = readdirSync(join(dir, 'backups')).sort()
    assert.equal(left.filter((n) => PREMIGRATE_RE.test(n)).length, 5)
    assert.ok(left.includes('pinfolio-20260101-0300.tar.gz'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
