// electron-updater 的「供应商包」（Task 9 / 方案 A）。文件名是 .cts 不是 .ts 的原因见文末。
//
// 为什么需要它：electron-updater 在 devDependencies 里，而 electron-builder 只把
// **production dependencies** 装进 app，运行时 `await import('electron-updater')` 在装出来的
// 应用里会直接失败 —— 开发态用整个工作树的 node_modules，一点看不出来。
//
// 两条路的取舍（见任务书）：A = 单独打一个把 electron-updater 内联进来的小包（就是本文件，
// build:desktop:vendor 生成 dist-desktop/updater-vendor.cjs）；B = 把 electron-updater 挪进
// dependencies，代价是 Web / Docker 的 `pnpm install --prod` 白胖一圈（builder-util-runtime、
// fs-extra、js-yaml、semver 全跟着进）。优先 A：更新代码整块进 asar，依赖图不变。
//
// 注意 `--bundle` 后面**不能**带 `--packages=external`（那正是要内联的东西），
// 只留 `--external:electron`：electron 必须由运行时提供，打进包里既没意义也会炸。
import { autoUpdater } from 'electron-updater'

export { autoUpdater }

// 为什么是 .cts：产物必须是 CommonJS 的 .cjs（原因见下），而 `import('./updater-vendor.cjs')`
// 要能被 tsc 解析，源码就必须叫 updater-vendor.cts（TS 的 .cjs ↔ .cts 是一对，.cjs 不会映射到 .ts）。
//
// 为什么产物必须是 CJS 而不是任务书里写的 ESM：实测 --format=esm 打出来的包在 Electron 主进程里
// 一 import 就炸 —— `Error: Dynamic require of "fs" is not supported`（esbuild 在 ESM 产物里把
// 打包进来的 CJS 依赖的 require("fs") 编译成自己的 __require 兜底，而 ESM 作用域里没有 require）。
// 触发点在 fs-extra → graceful-fs，electron-updater 的第一层依赖，绕不过去。所以改打 CJS：
// require 是原生的，整条链正常，代价只是 `import()` 拿到的具名导出要走 interop（updater-interop.ts
// 的 pickAutoUpdater 已经覆盖：具名 → default → module.exports，实测三者都拿得到 autoUpdater）。
