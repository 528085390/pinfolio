import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { resolveSnapshotTarget } from '../../server/snapshot/target.js'

// SNAPSHOT 落盘目标是一个**纯函数**：入参全给进来，不读 process.env、不 import db.js（那会开库）。
// 锁死三件事：正式实例照旧写根目录、隔离实例照旧不写、桌面端能用 PINBOARD_SNAPSHOT 显式指定。
// 全是假目录（/r、/u），本文件不碰磁盘、不出现任何真实路径。
//
// 期望值用 join('/r', 'SNAPSHOT.md') 而不是字面量 "/r/SNAPSHOT.md"：
// 任务书里那是 POSIX 写法，Windows 上分隔符是 \，用 join 拼才两边都对。

test('正式实例（dataDir = root/data）：写根目录 SNAPSHOT.md', () => {
  assert.equal(
    resolveSnapshotTarget({ snapshotEnv: undefined, root: '/r', dataDir: '/r/data' }),
    join('/r', 'SNAPSHOT.md'),
  )
})

test('隔离实例（dataDir 指到别处且没设 PINBOARD_SNAPSHOT）：不写，返回 null', () => {
  assert.equal(
    resolveSnapshotTarget({ snapshotEnv: undefined, root: '/r', dataDir: '/tmp/x' }),
    null,
  )
})

test('桌面端显式指定 PINBOARD_SNAPSHOT：隔离实例也照写那个路径', () => {
  assert.equal(
    resolveSnapshotTarget({ snapshotEnv: '/u/SNAPSHOT.md', root: '/r', dataDir: '/u/data' }),
    '/u/SNAPSHOT.md',
  )
})

test('PINBOARD_SNAPSHOT 是空串时按「没设置」处理（docker-compose 里常见 VAR=）', () => {
  assert.equal(
    resolveSnapshotTarget({ snapshotEnv: '', root: '/r', dataDir: '/r/data' }),
    join('/r', 'SNAPSHOT.md'),
  )
  assert.equal(resolveSnapshotTarget({ snapshotEnv: '', root: '/r', dataDir: '/tmp/x' }), null)
})

test('尾部分隔符不同不算隔离实例（/r/data/ 与 /r/data 同一目录）', () => {
  assert.equal(
    resolveSnapshotTarget({ snapshotEnv: undefined, root: '/r', dataDir: '/r/data/' }),
    join('/r', 'SNAPSHOT.md'),
  )
})

test('Windows 反斜杠 / 大小写差异不误判成隔离实例', { skip: process.platform !== 'win32' }, () => {
  assert.equal(
    resolveSnapshotTarget({ snapshotEnv: undefined, root: 'C:\\R', dataDir: 'c:/r/data' }),
    join('C:\\R', 'SNAPSHOT.md'),
  )
})
