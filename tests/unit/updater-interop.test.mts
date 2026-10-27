import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickAutoUpdater } from '../../desktop/updater-interop.js'

// electron-updater 的 ESM/CJS interop（Task 8 修复轮 1）：
// `electron-updater/out/main.js` 末尾用 `Object.defineProperty(exports, "autoUpdater", { get })` 暴露该导出，
// Node 的 cjs-module-lexer 静态分析识别不到 → `(await import('electron-updater')).autoUpdater === undefined`，
// 只有 `.default.autoUpdater` / `['module.exports'].autoUpdater` 能拿到。这里是不 import 任何 runtime 的纯函数，
// node --test 里能直接跑（不 import electron、不 import electron-updater）。

const FAKE = { autoDownload: false, autoInstallOnAppQuit: false }

test('pickAutoUpdater：只有具名导出（正常 CJS interop）', () => {
  assert.equal(pickAutoUpdater({ autoUpdater: FAKE }), FAKE)
})

test('pickAutoUpdater：只有 default.autoUpdater（electron-updater 6.8.11 实测形状）', () => {
  assert.equal(pickAutoUpdater({ default: { autoUpdater: FAKE } }), FAKE)
})

test('pickAutoUpdater：只有 module.exports.autoUpdater', () => {
  assert.equal(pickAutoUpdater({ 'module.exports': { autoUpdater: FAKE } }), FAKE)
})

test('pickAutoUpdater：三种都没有 → 抛可读错误，不是 TypeError', () => {
  assert.throws(
    () => pickAutoUpdater({ AppUpdater: {}, default: {}, 'module.exports': {} }),
    /electron-updater 未导出 autoUpdater（ESM\/CJS interop）/,
  )
})

test('pickAutoUpdater：namespace 本身不是对象（null / undefined / 数字）也不炸成 TypeError', () => {
  for (const ns of [null, undefined, 42, 'electron-updater']) {
    assert.throws(() => pickAutoUpdater(ns), /electron-updater 未导出 autoUpdater/)
  }
})

test('pickAutoUpdater：default 是 null / 非对象时继续往下找 module.exports', () => {
  assert.equal(pickAutoUpdater({ default: null, 'module.exports': { autoUpdater: FAKE } }), FAKE)
  assert.equal(pickAutoUpdater({ default: 1, 'module.exports': { autoUpdater: FAKE } }), FAKE)
})

test('pickAutoUpdater：autoUpdater 为 null 视为没有（继续往下找）', () => {
  assert.equal(pickAutoUpdater({ autoUpdater: null, default: { autoUpdater: FAKE } }), FAKE)
})

test('pickAutoUpdater：三种同时存在时优先取具名导出', () => {
  const named = { tag: 'named' }
  const fromDefault = { tag: 'default' }
  const fromModuleExports = { tag: 'module.exports' }
  const picked = pickAutoUpdater({
    autoUpdater: named,
    default: { autoUpdater: fromDefault },
    'module.exports': { autoUpdater: fromModuleExports },
  })
  assert.equal(picked, named)
})
