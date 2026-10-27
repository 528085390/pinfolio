/**
 * electron-updater 的 ESM/CJS interop 取包（Task 8 修复轮 1 / C1）。
 *
 * 实测（Electron 45.0.0 + electron-updater 6.8.11，真正跑起来量到的）：`electron-updater/out/main.js`
 * 末尾是 `Object.defineProperty(exports, "autoUpdater", { enumerable: true, get: ... })`，Node 的
 * cjs-module-lexer **静态分析不出来**这个具名导出，于是：
 *
 *   const ns = await import('electron-updater')
 *   ns.autoUpdater             // undefined  ← 类型声明里明明有具名导出，tsc 不报错
 *   ns.default.autoUpdater     // 对象
 *   ns['module.exports'].autoUpdater  // 对象（同一个）
 *
 * 后果是 `autoUpdater.autoDownload = false` 抛 TypeError，打包态的自动更新整条链变成死代码，
 * 而开发态被 `app.isPackaged` 守卫挡在前面，所以单测/开发日志全绿却什么都没验证到。
 *
 * 这个文件是**纯函数**：不 import electron、不 import electron-updater 的 runtime
 * （`typeof import('electron-updater')` 只出现在类型位置，编译后完全擦除），所以
 * tests/unit/updater-interop.test.mts 能在 node --test 里直接跑。
 */

/** electron-updater 的 AppUpdater 类型（纯类型位置引用，runtime 零加载） */
export type AutoUpdaterLike = (typeof import('electron-updater'))['autoUpdater']

/** 只认对象/函数，null 与原始值一律当「没有」处理，别让 interop 兜底自己炸成 TypeError */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null) return value as Record<string, unknown>
  if (typeof value === 'function') return value as unknown as Record<string, unknown>
  return null
}

/** 从 namespace 里按顺序找一个非空的 autoUpdater */
function takeFrom(source: Record<string, unknown> | null): AutoUpdaterLike | null {
  if (source === null) return null
  const value = source['autoUpdater']
  if (value === undefined || value === null) return null
  return value as AutoUpdaterLike
}

/**
 * 从 `await import('electron-updater')` 的 namespace 里取出 autoUpdater。
 *
 * 优先级：具名导出 → `default.autoUpdater` → `['module.exports'].autoUpdater`。
 * 三种都没有就抛错（错误文案固定，方便日志里 grep）。
 */
export function pickAutoUpdater(ns: unknown): AutoUpdaterLike {
  const root = asRecord(ns)
  const named = takeFrom(root)
  if (named !== null) return named

  if (root !== null) {
    const fromDefault = takeFrom(asRecord(root['default']))
    if (fromDefault !== null) return fromDefault
    const fromModuleExports = takeFrom(asRecord(root['module.exports']))
    if (fromModuleExports !== null) return fromModuleExports
  }

  throw new Error('electron-updater 未导出 autoUpdater（ESM/CJS interop）')
}
