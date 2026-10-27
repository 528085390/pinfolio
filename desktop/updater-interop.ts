/**
 * electron-updater 的 ESM/CJS interop 取包 + `installerPath` 预检查判定
 * （Task 8 修复轮 1 / C1、修复轮 2 / N1）。
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

/**
 * `installerPath` 预检查的判定（Task 8 修复轮 2 / N1）：装，还是不装。
 *
 * `installerPath` 是 electron-updater `BaseUpdater` 的 **protected getter**，类型上取不到，只能运行时探。
 * 它的用途只有一个：`quitAndInstall()` 整条链**不抛异常**（BaseUpdater.install 里 installerPath 为 null
 * 时只是 dispatchError + return false），所以「根本没下到包」这个最常见的失败必须在关服务**之前**挡住，
 * 否则用户拿到的是后端已停、页面全废、又退不掉的窗口。
 *
 * 反过来的坑是**更新通道静默永久失效**：electron-updater 一旦把这个字段改名，属性读出来就是 undefined，
 * 若把「读不到」一律当成「没有安装包」，就会永远拒绝安装 —— 不变砖，但用户再也装不上任何更新，日志之外看不出异常。
 * 所以这里**fail-open**：
 *
 * - `hasProperty === false`（`'installerPath' in updater` 为假 → 属性根本不存在，多半是改名的）→ **照常装**：
 *   真装不上由 quitAndInstall() 之后的 3 秒看门狗兜底（判定「进程还在」→ relaunch 一个可用实例），
 *   最坏结果等于退回这层预检查之前的行为 + 看门狗；
 * - 属性**存在**时按值严格判：null / 空串 / 非字符串 → abort（走「更新文件不完整，请再点一次检查更新重下」）。
 *
 * `in` 查的是整条原型链，protected getter 在 prototype 上也能查到 —— 这就是「属性存在但值为 undefined」
 * 与「属性不存在」两者唯一的区分手段，别用 `updater.installerPath === undefined` 判（它把两者混为一谈）。
 */
export function decideInstall(hasProperty: boolean, rawValue: unknown): 'proceed' | 'abort' {
  if (!hasProperty) return 'proceed'
  if (typeof rawValue !== 'string' || rawValue === '') return 'abort'
  return 'proceed'
}
