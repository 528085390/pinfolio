# pinfolio 桌面端（Electron）设计 spec

> 状态：待审阅 · 2026-10-27 · 分支 feat/desktop（worktree .worktrees/desktop）
> 来源：2026-10-27 会话定案 —— 一份代码，Web 形态能用（本地起服务 + 浏览器 / Docker 部署），Electron 桌面端也能用；开源分发给别人；只出 Windows；桌面端本机免密。
> 参照物：本机 DSH 自身的做法（Electron 44.7 + electron-builder NSIS + app-update.yml 自动更新 + resources/runtime 旁挂运行时）。

## 1. 目标

1. 一份源码三形态：Web（node dist/server.js，含 Docker / start.cmd）、Electron 桌面端、开发模式 pnpm dev，共用同一份 server/ 与 web/。
2. 桌面端是完整功能，不是壳：SQLite 本地库、邮件、观测、上传、备份全部可用，断网也能用本地功能。
3. 可分发：GitHub Releases 出 Windows x64 NSIS 安装包，双击安装即可用，带自动更新。
4. 不破坏现有链路：Docker / docs/deploy.zh.md / start.cmd / nginx + frp 公网映射 / e2e 全部照旧。

## 2. 非目标（v1 明确不做）

- macOS / Linux 产物（架构上不排除，只是 v1 不出包）。
- 代码签名证书（Windows SmartScreen 警告在 README 里教用户点「更多信息 → 仍要运行」）。
- server/ 与 web/ 拆成 pnpm workspace 多包（见 §12 待确认）。
- 桌面端多用户 / 多实例 / 作为远端服务器客户端（桌面端只服务本机）。
- 引入第二套运行时（不引 Rust/Tauri，不塞第二个 Node）。

## 3. 已定决策

| # | 决策 | 取值 | 理由 |
|---|---|---|---|
| D1 | 外壳 | Electron（>=40，带 Node 24） | 后端重度依赖 node:sqlite / node:crypto / imapflow / socket.io-client / 手写 tar，Rust 或 Go 重写不现实；Electron 内建 Node 可直接复用 |
| D2 | 渲染方式 | http://127.0.0.1:<动态端口>，不是 file:// | cookie 会话、CSRF（要求 JSON Content-Type）、/api/attachments 图片、PINBOARD_BASE 全部零改动 |
| D3 | 端口 | port: 0 由系统分配，只绑 127.0.0.1 | 避开 7788 被 Web 形态占用；不对外暴露 |
| D4 | 免密 | 启动时服务端建一个 pb_session 会话，main 进程把它注入 Electron 的 cookie jar | 前端零改动；比改前端塞 Bearer token 小得多 |
| D5 | 数据目录 | app.getPath(userData) 即 %APPDATA%/pinfolio，数据在 .../data | 安装目录（Program Files）只读，不能放库 / 上传 / 备份 |
| D6 | 工程结构 | 轻量：新增 desktop/，不拆 monorepo | 拆包对「能分发」无收益，代价是 Docker 构建、--packages=external、7 份文档全改 |
| D7 | 进程模型 | v1 后端跑在 Electron main 进程内（startServer 同进程） | 能直接 createSession()、无 IPC 握手、启动快；startServer 独立成模块，后续换 utilityProcess 只改一个调用点 |
| D8 | 打包 | electron-builder nsis x64，files 只带 dist/ 与生产依赖 | 与 Docker 一样的瘦身思路 |
| D9 | 更新 | electron-updater + provider github（owner 528085390，repo pinfolio） | 开源项目的标准做法，不用自建 feed |

## 4. 架构

~~~
Electron main (desktop/main.ts)
  ├─ app.requestSingleInstanceLock()                第二实例只聚焦已有窗口
  ├─ process.env.PINBOARD_DATA = userData/data      必须在 import server 之前
  ├─ process.env.PINBOARD_SNAPSHOT = userData/SNAPSHOT.md
  ├─ await import(../server/app.js).startServer({ port: 0, hostname: 127.0.0.1, desktopAutoLogin: true })
  │     └─ Hono + node:sqlite + IMAP + 备份/快照/指标定时器（与 Web 形态同一份代码）
  ├─ session.cookies.set({ url, name: pb_session, value: handle.desktopSession.token })
  └─ BrowserWindow.loadURL(handle.url) -> React SPA

Web / Docker / start.cmd
  └─ server/index.ts -> startServer({ port: PORT || 7788, hostname: HOST || 127.0.0.1 })   薄启动器
~~~

新增与改动文件清单：

| 文件 | 动作 | 职责 |
|---|---|---|
| server/app.ts | 新增 | startServer(opts)：组装 Hono、挂静态托管、起定时器、返回 { app, url, port, close, desktopSession } |
| server/index.ts | 改造 | 只剩 CLI 参数（--reset-password / --new-token / --backup）+ 调 startServer + 信号处理 |
| server/desktop-session.ts | 新增 | 桌面免密会话的建立与清理（复用 auth/store.createSession 与 settings 表） |
| server/snapshot/write.ts | 改造 | SNAPSHOT_PATH 支持 PINBOARD_SNAPSHOT 覆盖，并据此判定是否正式实例 |
| server/backup/collect.ts | 改造 | 根配置文件（monitor-links.json 等）优先从 DATA_DIR 找，回落 process.cwd() |
| desktop/main.ts | 新增 | 主进程：单实例、服务启动、cookie 注入、窗口、托盘、自启、外链拦截、更新 |
| desktop/paths.ts | 新增 | 纯函数：数据目录 / 快照路径 / 日志路径推导（可单测） |
| desktop/window-state.ts | 新增 | 纯函数：窗口尺寸位置的读取与收敛（可单测） |
| desktop/updater.ts | 新增 | electron-updater 封装（检查 / 下载 / 提示） |
| desktop/assets/icon.ico | 新增 | 安装包与托盘图标 |
| tools/desktop/make-ico.mjs | 新增 | PNG 转 ICO（无依赖，ICO 允许内嵌 PNG） |
| tools/desktop/smoke.mjs | 新增 | 打包产物冒烟：启动 exe → 轮询 /api/health → 截图 → 退出 |
| electron-builder.yml | 新增 | 打包配置 |
| .github/workflows/desktop-release.yml | 新增 | tag 触发 → windows-latest 构建 → GitHub Release |

## 5. 接口契约

~~~ts
// server/app.ts
export type StartServerOptions = {
  hostname?: string           // 默认 127.0.0.1
  port?: number               // 默认 Number(process.env.PORT || 7788)；桌面端传 0
  desktopAutoLogin?: boolean  // 只允许回环地址，否则抛错
}
export type DesktopSession = { id: string; token: string }
export type ServerHandle = {
  url: string                 // http://127.0.0.1:<实际端口>
  port: number                // 实际监听端口（port 为 0 时由系统分配）
  desktopSession?: DesktopSession
  close(): Promise<void>      // 停监听 + 关 IMAP + 清定时器，可重复调用
}
export async function startServer(opts?: StartServerOptions): Promise<ServerHandle>
~~~

四条硬约束（写进代码注释，别让后来人踩）：

1. PINBOARD_DATA 必须在 import server/* 之前设好 —— server/db.ts 是模块级单例（export const db = new DatabaseSync(DB_PATH)），import 时就打开库。桌面端因此必须用动态 import()，而 startServer 不接受 dataDir 参数（避免「传了但没生效」的假象），只读 env。
2. 免密只在本机：desktopAutoLogin 且 hostname 属于 127.0.0.1 / ::1 / localhost，否则 throw new Error(desktopAutoLogin 只允许回环地址)。
3. 一个 desktop 会话只留一个：会话 id 存 settings 表的 desktop_session_id，启动时先按它删旧的再建新的（否则 sessions 表每次启动加一条，设置页的已登录设备列表会被自己刷屏）。
4. close() 必须可重复调用，且调用后进程能自然退出（定时器 unref 或显式 clear）。

## 6. 路径与数据

| 内容 | Web / Docker | 桌面端 |
|---|---|---|
| 数据目录 | PINBOARD_DATA 或 <项目>/data | %APPDATA%/pinfolio/data |
| SQLite | <data>/pinboard.db | 同左 |
| 主密钥 | <data>/secret.key（0600） | 同左（首次启动生成，换机要一起搬） |
| 便签图片 | <data>/uploads/ | 同左 |
| 备份包 | <data>/backups/、<data>/audit/ | 同左 |
| SNAPSHOT.md | <项目>/SNAPSHOT.md | %APPDATA%/pinfolio/SNAPSHOT.md（新 env PINBOARD_SNAPSHOT） |
| 运行日志 | logs/pinboard.log（start.cmd 重定向） | %APPDATA%/pinfolio/logs/main.log（Electron 自己写） |
| 根配置文件（monitor-links.json 等） | <项目>/ | <data>/，找不到再回落 cwd |

卸载策略：NSIS 卸载只删程序目录，%APPDATA%/pinfolio 一律保留（那是用户数据），README 写清楚手动清理方式。

## 7. 桌面端行为清单

- 单实例：requestSingleInstanceLock，第二实例唤醒并聚焦第一实例窗口。
- 窗口：1280x860 默认，记忆上一轮尺寸与位置（userData/window-state.json），最小 960x640。
- 关窗行为：默认最小化到托盘（可在托盘菜单切「退出时直接关闭」）；托盘菜单含 显示/隐藏、开机自启（勾选）、检查更新、打开数据目录、退出。
- 开机自启：app.setLoginItemSettings()，状态取自系统，与托盘勾选同步。
- 外链：setWindowOpenHandler 与 will-navigate 只放行 http://127.0.0.1:<port>，其余交给 shell.openExternal（观测项、邮件里的链接都走这条）。
- 安全：contextIsolation true、nodeIntegration false、sandbox true，v1 不需要 preload（没有要暴露给页面的原生能力）。
- 崩溃：uncaughtException 与 unhandledRejection 落 main.log 并弹原生对话框（写明日志路径），不静默白屏。
- 首次启动：库里没有密码也能直接进主界面（免密会话已建）；设置页仍可给 Web / 远程访问另设密码。

## 8. 安全边界

1. 服务只绑回环，桌面端不提供 HOST=0.0.0.0 的入口。
2. 免密会话是进程内创建、注入到 Electron 自己的 cookie jar，不经网络传输，也不落盘明文。
3. pb_session cookie 仍是 HttpOnly + SameSite=Lax；窗口只能访问 127.0.0.1:<port>，导航被拦截。
4. 自动更新只走 GitHub Releases（HTTPS，校验 latest.yml 里的 sha512），不引入第三方 feed。
5. 静态加密（secret.key / AES-GCM）行为不变，桌面端不降低任何现有安全假设。

## 9. 构建与分发

- 脚本：pnpm build:desktop = pnpm build + esbuild 打 desktop/main.ts 成 dist-desktop/main.cjs + electron-builder --win nsis --x64。
- 配置：electron-builder.yml，appId com.pinfolio.desktop、productName pinfolio、asar true、files 只带 dist/ 与 dist-desktop/、extraMetadata.main 指向 dist-desktop/main.cjs（main 打成 CJS 单文件，避开 ESM + asar 的坑）。
- 产物：release/pinfolio-Setup-<version>.exe 与 latest.yml。
- CI：.github/workflows/desktop-release.yml，on.push.tags v*，windows-latest，pnpm i --frozen-lockfile → pnpm build:desktop → electron-builder --publish always（用内置 GITHUB_TOKEN）。
- 版本：跟随 package.json 的 version；发桌面版就打 v* tag，CHANGELOG 记一条。
- 已知成本：不签名 → SmartScreen 警告；README 给 SHA256 与「更多信息 → 仍要运行」的指引。

## 10. 验收标准（逐条可验）

1. pnpm dev 与 node dist/server.js 行为与今天完全一致（7788、登录页、e2e 全绿）。
2. pnpm test:unit 全绿，新增单测覆盖：动态端口、close() 可重复调用、desktopAutoLogin 在非回环地址抛错、PINBOARD_SNAPSHOT 生效、desktop_session_id 只留一个。
3. 桌面端首次启动：直接进主界面，不出现登录页，/api/health 返回 200。
4. 桌面端数据落在 %APPDATA%/pinfolio/data/pinboard.db，安装目录内无写入（看文件时间戳）。
5. 起第二次桌面端只聚焦已有窗口，不再起第二份服务（只有一个监听端口）。
6. 关窗后托盘常驻，后台任务（备份 / 指标 / 邮件轮询）继续；托盘退出后进程完全退出、端口释放。
7. 干净 Windows 账户（另开本地用户）里双击安装 → 启动 → 建便签 → 贴图上传 → 重启数据还在。
8. 卸载后 %APPDATA%/pinfolio 仍在，重装自动识别旧数据。
9. 托盘检查更新：无新版时提示已是最新；有新版（用 pre-release tag 验）能下载并提示重启。
10. Web 形态回归：Docker 镜像构建成功、start.cmd 启动正常、公网 https://47.93.5.235/pinfolio/ 无变化。
11. tools/desktop/smoke.mjs 对打包产物跑通：起 exe → 200 → 截图 → 退出码 0。
12. 记录实测值进 CHANGELOG：安装包体积（预期 90-160 MB）、空闲内存、冷启动到可交互耗时。

## 11. 风险与回退

| 风险 | 触发信号 | 回退 |
|---|---|---|
| Electron 内置 Node 没有 node:sqlite | require(node:sqlite) 抛 ERR_UNKNOWN_BUILTIN_MODULE 或 DatabaseSync 未定义 | server/db.ts 换 better-sqlite3 + @electron/rebuild（唯一封装点；Web 形态可继续用 node:sqlite，按运行时分支） |
| asar 里读 dist/web 失败 | 白屏或静态资源 404 | asarUnpack 放 dist/web，或 WEB_DIR 改用 app.getAppPath() |
| imapflow / pg / mysql2 打包后缺失 | 邮件页或备份报 500 | 它们都是懒加载，确认留在 dependencies 且没被 files 排除 |
| 杀软误报 NSIS 安装包 | 用户反馈安装被拦 | README 给 SHA256 与说明；不签名是已知取舍 |
| 端口 0 触发防火墙提示 | 首次启动弹 Windows 防火墙 | 只绑回环理论上不触发；若触发在文档写明「取消即可」 |

## 12. 待你确认

1. D6 轻量方案（加 desktop/，不拆 monorepo）—— 这条你没明确回答，我按「不拆」写计划；要拆现在说。
2. 关窗默认行为我按「最小化到托盘」写，若你想默认直接退出，改一行即可。
3. 桌面端默认免密，设置页仍保留「给 Web / 远程访问设密码」，这条我按「保留」写。