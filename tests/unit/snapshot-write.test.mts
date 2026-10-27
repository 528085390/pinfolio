import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// writeSnapshot() 真要落盘就绕不开 db.ts（import 即开库），所以先把两个环境变量指到 mkdtemp：
// 数据目录和快照目标全在临时目录里，真实库、真实根目录 SNAPSHOT.md 一个字节都不碰。
// 必须在 import 之前设 —— db.ts 的 DATA_DIR、write.ts 的 SNAPSHOT_TARGET 都是模块级单例。
const dir = mkdtempSync(join(tmpdir(), 'pinfolio-snapshot-write-'))
// 父目录**故意不存在**：桌面端首启把快照指到用户目录时就是这种情形
const target = join(dir, 'nested', 'deeper', 'SNAPSHOT.md')
process.env.PINBOARD_DATA = join(dir, 'data')
process.env.PINBOARD_SNAPSHOT = target

const { SNAPSHOT_PATH, writeSnapshot } = await import('../../server/snapshot/write.js')
// 收尾要先把 db 关掉：Windows 下删还被 SQLite 打开的文件是 EPERM（这个库就在临时目录里）
const { db } = await import('../../server/db.js')

after(() => {
  try {
    db.close()
  } catch {
    // 已经关了就算了
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('PINBOARD_SNAPSHOT 生效：SNAPSHOT_PATH 就是它', () => {
  assert.equal(SNAPSHOT_PATH, target)
})

test('目标父目录不存在时 writeSnapshot() 会建目录并写出来（桌面端首启场景）', async () => {
  assert.equal(existsSync(target), false)
  const wrote = await writeSnapshot()
  assert.equal(wrote, target)
  assert.equal(existsSync(target), true)
  const text = readFileSync(target, 'utf8')
  assert.match(text, /^# pinfolio 快照/)
})
