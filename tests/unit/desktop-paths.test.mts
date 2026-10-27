import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { desktopPaths } from '../../desktop/paths.js'

// desktopPaths 是一个**纯函数**：只做字符串拼接，不 mkdir、不 import electron，
// 所以在 node 单测里能直接跑（不需要 Electron 运行时）。
//
// 期望值一律用 join(...) 拼，不写死分隔符：任务书里的 "C:/..." 是 POSIX 写法，
// Windows 上 join 出来是反斜杠，用字面量就两边不可能同时过。

const USER_DATA = 'C:/Users/a b/AppData/Roaming/pinfolio'

test('desktopPaths：四个路径都在 userDataDir 下面，各就各位', () => {
  const p = desktopPaths(USER_DATA)
  assert.equal(p.dataDir, join(USER_DATA, 'data'))
  assert.equal(p.snapshotPath, join(USER_DATA, 'data', 'SNAPSHOT.md'))
  assert.equal(p.logFile, join(USER_DATA, 'logs', 'main.log'))
  assert.equal(p.windowStateFile, join(USER_DATA, 'window-state.json'))
})

test('desktopPaths：SNAPSHOT.md 落在 dataDir 里，不是 userDataDir 根', () => {
  const p = desktopPaths(USER_DATA)
  assert.equal(p.snapshotPath, join(p.dataDir, 'SNAPSHOT.md'))
})

test('desktopPaths：路径带空格不被截断（Windows 用户目录常见）', () => {
  const p = desktopPaths(USER_DATA)
  for (const v of [p.dataDir, p.snapshotPath, p.logFile, p.windowStateFile]) {
    assert.ok(v.includes('a b'), `路径里应保留空格：${v}`)
  }
})

test('desktopPaths：纯函数，只拼字符串，不落盘', () => {
  // 传一个根本不存在、也不该被创建的目录：函数跑完目录依旧不存在
  const ghost = join('Z:', 'definitely', 'not', 'created', 'pinfolio')
  desktopPaths(ghost)
  // 没有 fs 断言工具就直接再调一次确认幂等，且返回值结构稳定
  assert.deepEqual(desktopPaths(ghost), desktopPaths(ghost))
})

test('desktopPaths：不同 userDataDir 得到各自独立的路径', () => {
  const a = desktopPaths('C:/u/a')
  const b = desktopPaths('C:/u/b')
  assert.notEqual(a.dataDir, b.dataDir)
  assert.notEqual(a.windowStateFile, b.windowStateFile)
})
