# pinfolio 桌面端（Electron）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 或 superpowers:executing-plans，按任务逐条执行。步骤用 `- [ ]` 复选框跟踪。

**Goal:** 在 `feat/desktop` 分支上把 pinfolio 变成一份代码双形态：现有 Web / Docker 形态照旧，新增 Electron 桌面端（Windows x64），本机免密、数据落 `%APPDATA%`、可安装与自动更新。

**Architecture:** 把 `server/index.ts` 的组装逻辑抽成 `server/app.ts` 的 `startServer()`（返回 `{ url, port, desktopSession, close }`）；`server/index.ts` 退化为 CLI 启动器。Electron main 进程先设环境变量再动态 `import()` 该模块，拿到系统分配的端口后在 Electron 的 cookie jar 里注入服务端刚建好的 `pb_session`，窗口以 `loadURL(http://127.0.0.1:<port>)` 加载同一套 SPA。前端零改动。

**Tech Stack:** Node 24 + Hono + node:sqlite（沿用）；新增 Electron（>= 40）、electron-builder、electron-updater；esbuild 打桌面 main。

**Spec:** `docs/superpowers/specs/2026-10-27-pinfolio-desktop/spec.md`

## Global Constraints

- Node >= 24；`package.json` 是 `type: module`；`server/`、`desktop/` 里的相对 import 一律带 `.js` 后缀（tsx 与 esbuild 都按 ESM 解析）。
- `web/`、`shared/` 一个字节都不改（桌面端复用同一套前端）。
- 默认只监听 `127.0.0.1`；桌面端禁止监听 `0.0.0.0`。
- 新依赖全部进 `devDependencies`（含 electron / electron-builder / electron-updater），绝不能进 `dependencies`：Docker runtime 阶段 `pnpm install --prod` 只装那 7 个，多一个就多几十 MB。
- `pnpm-workspace.yaml` 的 `allowBuilds` 需要追加 `electron`，否则 pnpm 12 拦下 electron 的安装脚本，二进制不落地（报 Electron failed to install correctly）。
- 现有脚本语义不变：`pnpm dev` / `pnpm start` / `pnpm build` / `pnpm start:dist` / Dockerfile / `start.cmd` / `tools/pinboard.ps1` 行为与今天完全一致。
- 单测不得碰真实库：需要数据库的测试一律 `mkdtemp` + `process.env.PINBOARD_DATA`（在动态 `import()` 之前设），库路径永远在临时目录。
- commit message 英文，首行 < 70 字符，前缀 `feat:` / `refactor:` / `test:` / `docs:` / `chore:`；内部文档（本计划、spec、AGENTS、pitfalls、status-history）写中文。
- 版本：本分支开工时 `package.json` 是 0.4.0；Task 9 打包前升到 0.5.0（桌面端首个版本），CI 按 tag 出包。

## Review Focus

1. 端口传 0 时 `handle.url` 必须等于实际监听的端口（写错了窗口直接白屏，报 ERR_CONNECTION_REFUSED，很难查）。——由 Task 1 的测试钉住。
2. 免密只能对桌面端生效：Web 形态（不传 `desktopAutoLogin`）未登录访问 `/api/notes` 仍是 401。——Task 1。
3. `desktopAutoLogin` + 非回环地址必须直接抛错，不能默默免密（否则等于把无密码服务挂到局域网）。——Task 1。
4. 反复启动只留一条桌面会话：否则 `sessions` 表每次启动加一行，设置页的「已登录设备」会被自己刷屏。——Task 2。
5. 隔离实例（`PINBOARD_DATA` 指到别处）不许写 `SNAPSHOT.md`：桌面端数据目录天然不是 `<项目>/data`，写错了会把真库快照覆盖成空库那份。——Task 3。

---
## Task 1: 抽出 startServer（动态端口 + 幂等 close + 免密监听校验）

**Files:**
- Create: `server/app.ts`（组装 Hono、挂路由与静态托管、起定时器、返回 handle）
- Create: `tests/unit/server-start.test.mts`
- Modify: `server/index.ts`（只剩 CLI 参数与 `startServer()` 调用）

**Interfaces:**
- Consumes: `server/db.ts` 的 `db` / `DATA_DIR`、`server/static.ts` 的 `mountStatic`、`server/auth/middleware.ts`、14 个路由、`server/snapshot.js`、`server/backup/schedule.js`、`server/metrics/poll.js`、`server/tunnel.js`、`server/attachments/store.js`、`server/mail/routes.js` 的 `shutdownMail`、`server/secrets/key.js` / `secrets/migrate.js`。
- Produces:
~~~ts
export type StartServerOptions = { hostname?: string; port?: number; desktopAutoLogin?: boolean }
export type DesktopSession = { id: string; token: string }
export type ServerHandle = { url: string; port: number; desktopSession?: DesktopSession; close(): Promise<void> }
export function resolveListenOptions(
  opts?: StartServerOptions,
  env?: Record<string, string | undefined>,
): { hostname: string; port: number; desktopAutoLogin: boolean }
export function startServer(opts?: StartServerOptions): Promise<ServerHandle>
~~~

- [ ] **Step 1: 写失败测试** `tests/unit/server-start.test.mts`

~~~ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// 必须在任何 server/* 被 import 之前设：db.ts 是模块级单例（import 即开库）
process.env.PINBOARD_DATA = mkdtempSync(join(tmpdir(), "pinfolio-start-"))
const { startServer, resolveListenOptions } = await import("../../server/app.js")

test("resolveListenOptions：默认只绑回环 7788", () => {
  assert.deepEqual(resolveListenOptions(undefined, {}), { hostname: "127.0.0.1", port: 7788, desktopAutoLogin: false })
})

test("resolveListenOptions：desktopAutoLogin 只允许回环地址", () => {
  assert.throws(() => resolveListenOptions({ hostname: "0.0.0.0", desktopAutoLogin: true }, {}), /回环/)
  assert.doesNotThrow(() => resolveListenOptions({ hostname: "127.0.0.1", desktopAutoLogin: true }, {}))
})

test("startServer：port 0 回传真实端口，close 可重复调用", async () => {
  const h = await startServer({ port: 0 })
  assert.ok(h.port > 0)
  assert.equal(h.url, "http://127.0.0.1:" + h.port)
  const res = await fetch(h.url + "/api/health")
  assert.equal(res.status, 200)
  await h.close()
  await h.close()          // 幂等，不得抛
  await assert.rejects(fetch(h.url + "/api/health"))
})

test("startServer：Web 形态未登录仍是 401", async () => {
  const h = await startServer({ port: 0 })
  const res = await fetch(h.url + "/api/notes")
  assert.equal(res.status, 401)
  await h.close()
})
~~~

- [ ] **Step 2: 跑测试确认失败** `pnpm test:unit` → 失败信息应为找不到 `../../server/app.js`。

- [ ] **Step 3: 建 `server/app.ts`**，把 `server/index.ts` 第 31 行往后的组装逻辑整体搬进去，包进 `startServer()`（安全头中间件、locale 中间件、`api.use("*", authMiddleware)`、快照防抖中间件、14 条 `api.route(...)`、`mountStatic(app)`、`notFound`、`onError`、`serve()` 回调里的 `writeSnapshot()` 与 4 个启动器、`loadKey` + `migrateSecrets`、`bootstrapPassword`），并：
  - `resolveListenOptions` 读 `opts` 优先、其次 `process.env.PORT` / `process.env.HOST`；`desktopAutoLogin` 且 hostname 不属于 `127.0.0.1` / `::1` / `localhost` 时 `throw new Error("desktopAutoLogin 只允许回环地址")`。
  - `serve()` 后要拿到真实端口：监听 `listening` 事件，再读 `server.address().port`，用 `await new Promise` 包起来；`port` 为 0 时这就是系统分配的端口。4 个 `start*` 挪进 `listening` 回调。
  - `close()`：`clearTimeout` 快照防抖、`shutdownMail()`、关 HTTP 监听；内部用 `let closed = false` 保证幂等。**若单测进程不退出**，给 `startMetricsPoller` / `startTunnelProbe` / `startBackupScheduler` / `startAttachmentSweep` 里的 `setInterval` 补 `.unref()`。
  - `desktopAutoLogin` 分支本任务留空（Task 2 填），`handle.desktopSession` 暂时恒为 `undefined`。
- [ ] **Step 4: 改 `server/index.ts`** 成薄启动器：保留 `--reset-password` / `--new-token` / `--backup`（含 `--local` / `--remote`）三条 CLI 分支与 SIGINT/SIGTERM 处理，其余改成 `const h = await startServer()` 并打印 `h.url`。
- [ ] **Step 5: 验证**
  - `pnpm typecheck` → 0 错误。
  - `pnpm test:unit` → 全绿（含新增 4 条）。
  - `pnpm build && node tests/run.mjs --only=ci` → 全绿（Web 形态回归）。
  - 手动：`pnpm start` 后浏览器打开 `http://127.0.0.1:7788`，登录页正常、能登进设置页。
- [ ] **Step 6: 提交**
~~~bash
git add server/app.ts server/index.ts tests/unit/server-start.test.mts
git commit -m "refactor: extract startServer from server entry"
~~~

## Task 2: 桌面免密会话（`server/desktop-session.ts`）

**Files:**
- Create: `server/desktop-session.ts`
- Create: `tests/unit/desktop-session.test.mts`
- Modify: `server/app.ts`（`desktopAutoLogin` 分支：建会话并放进 handle）

**Interfaces:**
- Consumes: Task 1 的 `startServer()` 与 `ServerHandle.desktopSession`；`server/auth/store.js` 的 `createSession(db, { ua, ip, now })`、`deleteSession(db, id)`、`findValidSession`、`getSetting` / `setSetting` / `deleteSetting`。
- Produces:
~~~ts
export const DESKTOP_UA = "pinfolio-desktop"
export function ensureDesktopSession(db: DatabaseSync, opts: { ip: string; now?: number }): { id: string; token: string }
export function clearDesktopSession(db: DatabaseSync): void
~~~

- [ ] **Step 1: 写失败测试** `tests/unit/desktop-session.test.mts`：用 `new DatabaseSync(":memory:")` + `migrate(db, MIGRATIONS)`（照 `tests/unit/auth-store.test.mts` 的 `fresh()` 写法），断言：
  - 连调两次 `ensureDesktopSession` 后 `SELECT COUNT(*) FROM sessions` 是 1（旧的那条被删）。
  - `getSetting(db, "desktop_session_id")` 等于第二次返回的 `id`。
  - 返回的 token 能用 `findValidSession(db, token)` 查到（说明真的可登录）。
  - `clearDesktopSession(db)` 之后 `sessions` 表为空、`desktop_session_id` 被删。
- [ ] **Step 2: 跑测试** → 失败（模块不存在）。
- [ ] **Step 3: 实现**：先读 `desktop_session_id`，有就 `deleteSession`；再 `createSession(db, { ua: DESKTOP_UA, ip, now })`；`setSetting(db, "desktop_session_id", id)`。`clearDesktopSession` 读设置 → `deleteSession` → `deleteSetting`。
- [ ] **Step 4: 接进 `startServer()`**：`desktopAutoLogin` 为真时 `const s = ensureDesktopSession(db, { ip: "127.0.0.1" })` 塞进 `handle.desktopSession`；`close()` 里调 `clearDesktopSession(db)`。
- [ ] **Step 5: 验证** `pnpm typecheck && pnpm test:unit` 全绿；`node tests/run.mjs --only=ci` 仍全绿（Web 形态没被免密影响）。
- [ ] **Step 6: 提交** `git commit -m "feat: issue a local desktop session on startup"`
## Task 3: SNAPSHOT 路径可覆盖 + 隔离判定显式化

**Files:**
- Create: `server/snapshot/target.ts`（纯函数，不 import db）
- Create: `tests/unit/snapshot-target.test.mts`
- Modify: `server/snapshot/write.ts:12-61`（`SNAPSHOT_PATH` 与 `ISOLATED` 常量换成运行时求值）

**Interfaces:**
- Produces:
~~~ts
export function resolveSnapshotTarget(input: {
  snapshotEnv: string | undefined
  root: string
  dataDir: string
}): string | null   // null = 不写快照
~~~
- [ ] **Step 1: 写失败测试** `tests/unit/snapshot-target.test.mts`：
  - `{ snapshotEnv: undefined, root: "/r", dataDir: "/r/data" }` → `"/r/SNAPSHOT.md"`（Web 正式实例照旧）。
  - `{ snapshotEnv: undefined, root: "/r", dataDir: "/tmp/x" }` → `null`（隔离实例照旧不写）。
  - `{ snapshotEnv: "/u/SNAPSHOT.md", root: "/r", dataDir: "/u/data" }` → `"/u/SNAPSHOT.md"`（桌面端显式指定）。
- [ ] **Step 2: 跑失败** → 模块里没有该导出。
- [ ] **Step 3: 实现**：`write.ts` 里改成 `const target = resolveSnapshotTarget({ snapshotEnv: process.env.PINBOARD_SNAPSHOT, root: ROOT, dataDir: DATA_DIR })`；`SNAPSHOT_PATH` 导出值仍是 `target ?? join(ROOT, "SNAPSHOT.md")`（`pnpm snapshot` 与既有 import 都还用得到）；`writeSnapshot()` / `scheduleSnapshot()` 用 `target === null` 判定隔离，日志文案保持原样。
- [ ] **Step 4: 验证** `pnpm test:unit` 全绿；`pnpm start` 后改一条便签，等 2 秒确认根目录 `SNAPSHOT.md` 时间戳更新（行为没变）。
- [ ] **Step 5: 提交** `git commit -m "feat: allow overriding the snapshot path"`

## Task 4: 备份的根配置文件优先从数据目录读

**Files:**
- Modify: `server/backup/collect.ts:13-16` 及使用 `ROOT_CONFIGS` 的循环
- Create: `tests/unit/backup-config-paths.test.mts`

**Interfaces:**
- Produces: `export function resolveConfigPaths(names: string[], input: { dataDir: string; cwd: string }): string[]`（返回实际存在文件的绝对路径，数据目录优先）。
- [ ] **Step 1: 写失败测试**：临时目录造 `<data>/quick-links.json` 与 `<cwd>/monitor-links.json` → `resolveConfigPaths(["quick-links.json", "monitor-links.json", "nope.json"], {...})` 返回两条绝对路径，`quick-links.json` 指向数据目录；同名两份都在时以数据目录那份为准。
- [ ] **Step 2: 跑失败** → 导出不存在。
- [ ] **Step 3: 实现** 并把 `collect.ts` 的循环改成 `resolveConfigPaths(ROOT_CONFIGS, { dataDir: DATA_DIR, cwd: process.cwd() })`（打进 tar 的条目名保持裸文件名，`manifest.json` 格式不动）。
- [ ] **Step 4: 验证** `pnpm test:unit` 全绿；`pnpm build` 后 `node dist/server.js --backup --local` 成功，解包能见到 `quick-links.json`。
- [ ] **Step 5: 提交** `git commit -m "feat: read root config files from the data dir first"`

## Task 5: 桌面端纯逻辑（路径、窗口状态）+ 装 Electron 依赖

**Files:**
- Create: `desktop/paths.ts`、`desktop/window-state.ts`
- Create: `tests/unit/desktop-paths.test.mts`、`tests/unit/desktop-window-state.test.mts`
- Modify: `tsconfig.json`（`include` 加 `"desktop"`）、`package.json`（devDependencies）、`pnpm-workspace.yaml`（`allowBuilds` 加 `electron`）

**Interfaces:**
- Produces:
~~~ts
export type DesktopPaths = { dataDir: string; snapshotPath: string; logFile: string; windowStateFile: string }
export function desktopPaths(userDataDir: string): DesktopPaths
export type Bounds = { x?: number; y?: number; width: number; height: number }
export const DEFAULT_BOUNDS: Bounds
export const MIN_SIZE: { width: number; height: number }
export function clampBounds(b: Bounds, workArea: Bounds, min: { width: number; height: number }): Bounds
export function readWindowState(file: string): Bounds
export function writeWindowState(file: string, b: Bounds): void
~~~
- [ ] **Step 1: 装依赖** `pnpm add -D electron electron-builder electron-updater`；`pnpm-workspace.yaml` 的 `allowBuilds` 追加 `electron`；`pnpm install` 后确认 `node_modules/electron/dist/electron.exe` 存在。
- [ ] **Step 2: 写失败测试** `desktop-paths.test.mts`：输入 `"C:/Users/a b/AppData/Roaming/pinfolio"`（故意带空格）→ `dataDir` 是 `.../data`、`snapshotPath` 是 `.../SNAPSHOT.md`、`logFile` 是 `.../logs/main.log`、`windowStateFile` 是 `.../window-state.json`（一律 `join` 拼，不手写分隔符）。
  `desktop-window-state.test.mts`：`clampBounds` 三条——尺寸小于 `MIN_SIZE` 时抬到最小值；`x/y` 完全落在 `workArea` 外时居中；`x/y` 合法时原样返回。`readWindowState` 对不存在的文件与坏 JSON 都返回 `DEFAULT_BOUNDS`。
- [ ] **Step 3: 跑失败** → 模块不存在。
- [ ] **Step 4: 实现** 两个文件（`window-state.ts` 只碰 `node:fs`，`clampBounds` 不碰 fs）；`tsconfig.json` 的 `include` 加 `"desktop"`。
- [ ] **Step 5: 验证** `pnpm typecheck && pnpm test:unit` 全绿。
- [ ] **Step 6: 提交** `git commit -m "feat: add desktop path and window state helpers"`
## Task 6: 主进程（单实例、免密注入、窗口加载）

**Files:**
- Create: `desktop/main.ts`
- Modify: `package.json`（`main`、`build:desktop:main`、`dev:desktop` 三个字段/脚本）

**Interfaces:**
- Consumes: Task 1 的 `startServer()`、Task 2 的 `ServerHandle.desktopSession`、Task 5 的 `desktopPaths` / `readWindowState` / `writeWindowState` / `clampBounds` / `DEFAULT_BOUNDS` / `MIN_SIZE`。
- Produces: `export function createMainWindow(handle: { url: string; port: number }): Promise<BrowserWindow>`（供 Task 7 复用）。

- [ ] **Step 1: 实现 `desktop/main.ts`**，顺序不能变：
  1. `app.requestSingleInstanceLock()` 失败就 `app.quit()`；`second-instance` 事件里还原并聚焦已有窗口。
  2. `const paths = desktopPaths(app.getPath("userData"))`，`mkdirSync(paths.dataDir, { recursive: true })`，然后设 `process.env.PINBOARD_DATA = paths.dataDir`、`process.env.PINBOARD_SNAPSHOT = paths.snapshotPath`、`process.env.PORT = "0"`、`process.env.TRUST_PROXY = "0"`。**必须在下一步的动态 import 之前**。
  3. `const { startServer } = await import("../server/app.js")`（esbuild 会把这条内联进 `dist-desktop/main.js`，见 Step 2 的参数）。
  4. `const handle = await startServer({ port: 0, hostname: "127.0.0.1", desktopAutoLogin: true })`，然后 `console.log("[pinfolio] listening on " + handle.url)`（Task 10 的冒烟脚本靠这一行解析端口）。
  5. 注入 cookie：`session.defaultSession.cookies.set({ url: handle.url, name: "pb_session", value: handle.desktopSession.token, httpOnly: true, sameSite: "lax" })`。
  6. `createMainWindow(handle)`：`new BrowserWindow({ ...clampBounds(readWindowState(paths.windowStateFile), workArea, MIN_SIZE), minWidth: MIN_SIZE.width, minHeight: MIN_SIZE.height, show: false, backgroundColor: "#111315", webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })`；`loadURL(handle.url)`；`ready-to-show` 后 `show()`；`close` 事件里 `writeWindowState(paths.windowStateFile, win.getBounds())`（本任务先允许真关闭，托盘在 Task 7 接管）。
  7. `app.on("before-quit")` 与 `window-all-closed` 里 `await handle.close()`。
  8. `log` 统一用 `console`（Task 7 换成文件日志）。
- [ ] **Step 2: 打包 main 与脚本** `package.json` 加：
~~~json
"main": "dist-desktop/main.js",
"build:desktop:main": "esbuild desktop/main.ts --bundle --platform=node --format=esm --target=node24 --packages=external --external:electron --outfile=dist-desktop/main.js",
"dev:desktop": "pnpm build:web && pnpm build:desktop:main && electron ."
~~~
  （必须是 **ESM**：`server/db.ts:12` 用 `import.meta.url` 算 ROOT，esbuild 打成 CJS 会把 `import.meta` 清空 → `fileURLToPath(undefined)` 直接抛 TypeError，实测见 2026-10-27 自审记录；`package.json` 已是 `type: module`，Electron >= 28 支持 ESM main。Electron 不能直接跑 TS，所以开发态也先打一次。

  **`--packages=external` 是实测后的结论，不要改成 bundle 内联**：2026-10-27 用 `esbuild … --bundle --format=esm --target=node24`（不加 `--packages=external`）打一个只 import `server/app.js` 的探针，产物 4.1 MB，`node` 一跑就崩 —— `socket.io-client` 的依赖 `xmlhttprequest-ssl` 内部 `require('fs')` 被 esbuild 转成 `__require`，ESM 产物里直接 `Error: Dynamic require of "fs" is not supported`。所以生产依赖必须留在外部，由 electron-builder 把生产依赖的 `node_modules` 打进 asar（Task 9 负责，`electron-updater` 因此必须在 `dependencies` 里，Task 9 Step 3）。）
- [ ] **Step 3: 验证（手动，逐条记录实测值）**：`pnpm dev:desktop` 后窗口直接进便签页、不出现登录页；`%APPDATA%/pinfolio/data/pinboard.db` 被创建；`netstat -ano | findstr LISTEN` 里只多一个 `127.0.0.1` 的随机端口；再启一次只弹出已有窗口（没有第二个监听端口）；关窗后进程消失。
- [ ] **Step 4: 提交** `git commit -m "feat: boot the pinfolio server inside electron"`

## Task 7: 托盘、开机自启、外链拦截、崩溃日志

**Files:**
- Create: `desktop/log.ts`、`desktop/tray.ts`
- Modify: `desktop/main.ts`

**Interfaces:**
- Produces: `export function log(...parts: unknown[]): void`、`export function installCrashHandlers(): void`（`desktop/log.ts`）；`export function createTray(win: BrowserWindow, opts: { onQuit: () => void; onCheckUpdate: () => void; dataDir: string }): Tray`（`desktop/tray.ts`）。
- [ ] **Step 1: 实现 `desktop/log.ts`**：`log()` 追加写 `<userData>/logs/main.log`（时间戳 + 参数），文件超 1 MB 就重命名成 `main.log.1` 覆盖旧的；`installCrashHandlers()` 挂 `uncaughtException` / `unhandledRejection`，写日志并 `dialog.showErrorBox("pinfolio 出错了", "日志：" + 路径)`。
- [ ] **Step 2: 实现 `desktop/tray.ts`**：图标取 `process.resourcesPath` 下的 `icon.ico`，开发态回落 `desktop/assets/icon.ico`；菜单项 = 显示/隐藏、开机自启（checkbox，初值 `app.getLoginItemSettings().openAtLogin`，点击写 `app.setLoginItemSettings({ openAtLogin })`）、检查更新（回调，Task 8 接）、打开数据目录（`shell.openPath(dataDir)`）、退出（置 `__quitting` 后 `app.quit()`）。
- [ ] **Step 3: 改 `desktop/main.ts`**：`close` 事件改成 `if (!__quitting) { e.preventDefault(); win.hide() }`；`window-all-closed` 不 `app.quit()`（Windows 常驻托盘）；`setWindowOpenHandler` 与 `will-navigate` 只放行 `http://127.0.0.1:<port>`，其余 `shell.openExternal(url)` 加 `{ action: "deny" }`；`main.ts` 里所有 `console.log` 换成 `log()`。
- [ ] **Step 4: 验证（手动）**：点关闭 → 窗口消失、托盘图标在、数据目录里的库仍在被写（新建一条便签再检查）；托盘「退出」后进程消失、那个端口释放；观测页点外链 → 系统浏览器打开、应用窗口不动；勾选开机自启 → 任务管理器「启动」页出现 pinfolio。
- [ ] **Step 5: 提交** `git commit -m "feat: add tray, autostart and external link handling"`

## Task 8: 自动更新（electron-updater）

**Files:**
- Create: `desktop/updater.ts`
- Modify: `desktop/main.ts`（打包态启动 30 秒后静默检查一次）、`desktop/tray.ts`（「检查更新」回调）

**Interfaces:**
- Produces: `export function autoCheck(): void`（静默，有新版才提示）、`export function checkForUpdatesInteractive(): Promise<void>`（手动：检查中 / 已是最新 / 找到新版 / 下载中 / 重启安装 / 出错，全部走 `dialog`）。
- [ ] **Step 1: 实现**：`autoUpdater.autoDownload = false`、`autoUpdater.logger = { info: log, warn: log, error: log }`；两个函数开头 `if (!app.isPackaged) { log("未打包，跳过更新检查"); return }`。「找到新版」的弹窗按钮是「下载」/「以后」；下载完成提示「重启安装」，确认后 `autoUpdater.quitAndInstall()`。
- [ ] **Step 2: 验证（手动）**：开发态点检查更新 → 日志出现「未打包，跳过更新检查」，不崩；装 Task 9 的包后点检查更新 → 弹「已是最新」（此时远端还没有更高版本）。
- [ ] **Step 3: 提交** `git commit -m "feat: check for desktop updates via github releases"`
## Task 9: 打包配置与图标

**Files:**
- Create: `electron-builder.yml`、`tools/desktop/make-ico.mjs`、`desktop/assets/icon.ico`（生成物）
- Modify: `package.json`（`build:desktop` 脚本、`version` 升 0.5.0）、`.gitignore`（`release/`、`dist-desktop/`）

**Interfaces:**
- Produces: `node tools/desktop/make-ico.mjs` 读 `web/public/icons/icon-512.png`，写出 `desktop/assets/icon.ico`（单条 PNG 条目，`width`/`height` 字节写 0 表示 256+）；`pnpm build:desktop` 产出 `release/pinfolio-Setup-0.5.0.exe` 与 `release/latest.yml`。
- [ ] **Step 1: 写 `tools/desktop/make-ico.mjs`**：`readFileSync` 那个 PNG → 6 字节 ICO 头（`reserved=0`, `type=1`, `count=1`）+ 16 字节目录项（宽高 0、色数 0、planes 1、bit 24、size、offset 22）+ 原样拼 PNG 数据；打印最终字节数。
- [ ] **Step 2: 写 `electron-builder.yml`**：`appId: com.pinfolio.desktop`、`productName: pinfolio`、`directories: { output: release, buildResources: desktop/assets }`、`asar: true`、`files: ["dist/**", "dist-desktop/**", "package.json"]`（**注意**：`dist-desktop/main.js` 用 `--packages=external` 打包，`hono`/`@hono/node-server`/`imapflow`/`mailparser`/`mysql2`/`pg`/`socket.io-client`/`electron-updater` 运行时都从 asar 里的 `node_modules` 解析 —— electron-builder 会按 `dependencies` 自动带上生产依赖，但**必须实测确认**，见 Step 4）、`extraMetadata: { main: "dist-desktop/main.js" }`、`win: { target: [{ target: nsis, arch: [x64] }], icon: desktop/assets/icon.ico }`、`nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: false }`、`publish: [{ provider: github, owner: 528085390, repo: pinfolio }]`。
- [ ] **Step 3: 脚本与忽略**：`"build:desktop": "pnpm build && pnpm build:desktop:main && electron-builder --win nsis --x64"`；`version` 改 0.5.0；`.gitignore` 加 `release/` 与 `dist-desktop/`。
- [ ] **Step 3b: 把 `electron-updater` 从 `devDependencies` 移到 `dependencies`**（`pnpm remove -D electron-updater && pnpm add electron-updater`）：主进程以 `--packages=external` 打包，它必须作为生产依赖进 asar，否则 Task 8 的自动更新在安装包里 `import` 就失败。副作用：`dependencies` 从 7 个变 8 个（Docker 镜像略大，可接受，Task 12 文档里写一句）。
- [ ] **Step 4: 验证** `pnpm build:desktop` 出安装包；**必须验证 asar 里真的有生产依赖**：`npx asar list release/win-unpacked/resources/app.asar | findstr /i "hono socket.io-client electron-updater"` 要能列到 `node_modules/hono`、`node_modules/@hono/node-server`、`node_modules/socket.io-client`、`node_modules/electron-updater`（pnpm 的 node_modules 是符号链接，若 asar 里没有实体文件，改用 `pnpm deploy --prod --legacy <staging>` 产出实体目录再指向 electron-builder，把做法记进报告）；记录体积（spec 验收第 12 条）；`release/win-unpacked/pinfolio.exe` 能直接启动（Task 10 的冒烟脚本会自动跑，这里先手动确认一次）；安装后从开始菜单启动，功能与 `pnpm dev:desktop` 一致、便签图片能上传；卸载后 `%APPDATA%/pinfolio` 仍在。
- [ ] **Step 5: 提交** `git commit -m "build: package a windows installer with electron-builder"`

## Task 10: 打包产物冒烟脚本

**Files:**
- Create: `tools/desktop/smoke.mjs`
- Modify: `package.json`（`"smoke:desktop": "node tools/desktop/smoke.mjs"`）

**Interfaces:**
- Consumes: Task 9 的 `release/win-unpacked/pinfolio.exe`、Task 6 打的 `[pinfolio] listening on <url>` 日志行；`playwright-core` 已在 devDependencies。
- [ ] **Step 1: 实现**：`spawn(exe, ["--remote-debugging-port=9222"], { stdio: ["ignore", "pipe", "pipe"] })`。
  - **端口来源以日志文件为准**（Task 7 实测结论：打包后的 GUI 进程没有 stdout，`stdio: pipe` 抓不到任何东西）：优先读 `%APPDATA%/pinfolio/logs/main.log`（可用 `PINBOARD_USERDATA` 覆盖，见 Task 9 的 `--user-data-dir` 参数则从命令行传），轮询该文件里最新的 `listening on (http://127.0.0.1:\d+)`；读不到文件时才回退抓子进程 stdout（开发态 `pnpm dev:desktop` 仍有 stdout）。
  - 拿到地址后用 10 秒超时轮询该地址的 `/api/health` 直到 200；再用 `playwright-core` 的 `chromium.connectOverCDP("http://127.0.0.1:9222")` 截图到 `tmp/desktop-smoke.png`，并断言页面标题含 `pinfolio`、URL 路径不是 `/login` 或 `/setup`。
  - **子进程 env 必须处理两件事**：删除 `ELECTRON_RUN_AS_NODE`（否则 exe 以纯 Node 运行、不开窗），补 `SystemDrive=C:`（否则 Chromium 会在 cwd 造一个字面量 `%SystemDrive%` 垃圾目录）。
  - 最后 `taskkill /PID <pid> /T /F`，成功退出码 0、失败 1 并打印日志尾部。
- [ ] **Step 2: 验证** `pnpm smoke:desktop --exe=release/win-unpacked/pinfolio.exe` → 退出码 0，`tmp/desktop-smoke.png` 里是便签页。
- [ ] **Step 3: 提交** `git commit -m "test: add a smoke script for the packaged app"`

## Task 11: 发布工作流

**Files:**
- Create: `.github/workflows/desktop-release.yml`

- [ ] **Step 1: 实现**：`on.push.tags: ["v*"]` + `workflow_dispatch`；`runs-on: windows-latest`；步骤 = checkout → `pnpm/action-setup@v4`（version 12）→ `actions/setup-node@v4`（node 24，cache pnpm）→ `pnpm install --frozen-lockfile` → `pnpm build:desktop` → `npx electron-builder --win nsis --x64 --publish always`（`env: GH_TOKEN: secrets.GITHUB_TOKEN`）→ `actions/upload-artifact@v4` 留 installer。不要改现有 `ci.yml` / `release.yml`。
- [ ] **Step 2: 验证**：GitHub Actions 本地跑不了，先核对 YAML 缩进与 action 版本（可用 `pnpm dlx yaml-lint`），再打一个预发布 tag（如 `v0.5.0-desktop.1`）实跑一次，确认 Release 里出现 `pinfolio-Setup-*.exe` 与 `latest.yml`。
- [ ] **Step 3: 提交** `git commit -m "ci: build and publish the desktop installer on tags"`

## Task 12: 文档与坑位记录

**Files:**
- Create: `docs/desktop.zh.md`（安装 / 数据位置 / 卸载不删数据 / 从 Web 迁移库与 `secret.key` / 更新来源 / SmartScreen 提示）
- Modify: `README.zh.md` 与 `README.md`（各加一节 Desktop app，指向 Releases 与 `docs/desktop.zh.md`）、`docs/architecture.md`（补 `server/app.ts`、`server/desktop-session.ts`、`server/snapshot/target.ts`、`desktop/*`、`tools/desktop/*` 的职责）、`docs/pitfalls.md`（新增：`PINBOARD_DATA` 必须早于 import `server/db.js`；electron 需要写进 `allowBuilds`；`desktopAutoLogin` 只许回环；托盘模式下 `window-all-closed` 不退出；`%APPDATA%` 下库与 `secret.key` 要一起迁移）、`docs/status-history.md`（一条进展）、`AGENTS.md`（内容清单表加 `desktop/` 与 `tools/desktop/`）、`CHANGELOG.md`（0.5.0：桌面端首个版本 + 实测值：安装包体积 / 冷启动到可交互 / 空闲内存）

- [ ] **Step 1: 写文档**（中文；README 双语各加一节，别只改中文那份）
- [ ] **Step 2: 验证** `pnpm test` 全绿；`node tools/i18n-scan.mjs --check` 无新增未包 `t()` 的中文（新增文案都在 `docs/`，不应触发）；`docs/` 里新链接都指向存在的文件。
- [ ] **Step 3: 提交** `git commit -m "docs: document the desktop app"`

## 交付前总验收（对照 spec §10 逐条打勾）

- [ ] Web 形态回归：`pnpm typecheck` / `pnpm test:unit` / `node tests/run.mjs --only=ci` 全绿，`pnpm start` 登录页正常（Task 1–4、12）
- [ ] 桌面端：免密进主界面、数据在 `%APPDATA%/pinfolio`、单实例、托盘常驻、退出释放端口（Task 6–7 手动记录）
- [ ] 干净 Windows 账户安装 → 建便签 → 贴图上传 → 重启数据还在；卸载后数据保留（Task 9 手动记录）
- [ ] 自动更新链路实跑一次（Task 11 的预发布 tag）
- [ ] `pnpm smoke:desktop` 退出码 0（Task 10）
- [ ] 体积 / 冷启动 / 空闲内存实测值写进 CHANGELOG（Task 12）
