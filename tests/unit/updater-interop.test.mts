import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideInstall, pickAutoUpdater } from '../../desktop/updater-interop.js'

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

// installerPath 预检查的 fail-open（Task 8 修复轮 2 / N1）：
// `installerPath` 是 electron-updater BaseUpdater 的 protected getter，只能运行时探。
// 上一轮修「安装失败变砖」时把它当硬门槛：读不到就拒绝安装。但 electron-updater 若把这个字段改名，
// 属性读出来是 undefined → 也会被判成「没有安装包」→ 永远装不上任何更新（不变砖，但更新通道静默失效）。
// 所以只有「属性**存在**但值为 null / 空串 / 非字符串」才拒绝；属性不存在（改名了）时照常往下走，
// 失败交给 quitAndInstall() 之后的 3 秒看门狗兜底。`'installerPath' in updater` 负责区分这两种情况
// （getter 在原型链上，in 查得到）。

test('decideInstall：属性存在且为 null → abort（不关服务，提示重下）', () => {
  assert.equal(decideInstall(true, null), 'abort')
})

test('decideInstall：属性存在但为空串 / 非字符串 → abort', () => {
  for (const raw of ['', 0, false, {}, [], undefined, () => 'x']) {
    assert.equal(decideInstall(true, raw), 'abort', 'raw=' + String(raw))
  }
})

test('decideInstall：属性存在且为非空字符串 → proceed', () => {
  assert.equal(decideInstall(true, 'C:\\Users\\x\\AppData\\Local\\pinfolio-updater\\pending\\pinfolio Setup 1.2.0.exe'), 'proceed')
})

test('decideInstall：属性不存在（electron-updater 改名了）→ proceed（fail-open，看门狗兜底）', () => {
  assert.equal(decideInstall(false, undefined), 'proceed')
  // 不存在时属性值必然是 undefined，但**绝不能**跟「存在且为 undefined」混为一谈
  assert.equal(decideInstall(true, undefined), 'abort')
})
