import { app, BrowserWindow, screen, session, shell } from 'electron'
import type { Tray, WebContents } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import type { ServerHandle } from '../server/app.js'
import { desktopPaths } from './paths.js'
import type { DesktopPaths } from './paths.js'
import { probeWithRetry } from './auth-probe.js'
import { installCrashHandlers, log } from './log.js'
import { isInternalUrl } from './nav.js'
import { createTray } from './tray.js'
import { AUTO_CHECK_DELAY_MS, autoCheck, checkForUpdatesInteractive, configureUpdater } from './updater.js'
import { MIN_SIZE, clampBounds, readWindowState, writeWindowState } from './window-state.js'
import type { Bounds } from './window-state.js'

/**
 * Electron 主进程：把 pinfolio 后端和窗口在**同一个进程**里起起来
 * （spec 2026-10-27-pinfolio-desktop，Task 6；托盘 / 开机自启 / 外链拦截 / 崩溃日志是 Task 7）。
 *
 * 顺序是这个文件里唯一要紧的东西，逐条对应踩过的坑：
 *
 * 1. 崩溃处理器最先装（Task 7）：单实例锁、建库、起服务、开窗任何一步炸掉都要在
 *    <userData>/logs/main.log 里留下栈，而不是让窗口默默消失。
 * 2. 单实例锁：第二个实例不许再起一个后端（Task 2 的会话是**单条**，
 *    两个实例会抢 settings 里的 desktop_session_id，互相把对方的票作废）。
 * 3. `desktopPaths(app.getPath('userData'))` → 建数据目录 → 设 env。
 *    **必须在下一步的动态 import 之前**：server/db.ts:14（PINBOARD_DATA）、
 *    server/snapshot/write.ts:22（PINBOARD_SNAPSHOT）、server/kuma/links.ts:7 等四个根目录
 *    配置（MONITOR_* / HOST_SERVICES）全是**模块级求值**，import 完再设就没用了。
 *    PINBOARD_SNAPSHOT 必须给**绝对路径**（Task 3 的覆盖语义），父目录由 Task 3 自己 mkdir。
 * 4. 动态 import `../server/app.js`：esbuild 会把它内联进 dist-desktop/main.js，
 *    但**求值时机**仍是这一行（见 package.json 的 build:desktop:main）。
 * 5. startServer 用 PORT=0 让系统分配端口，url 只用 handle.url（别自己拼）。
 * 6. cookie 注入与开窗都必须在 `app.whenReady()` 之后：session.defaultSession 要等 ready 才存在。
 *    免密是「替用户带一张票」，不是拆掉鉴权 —— 注完立刻用不带 cookie 的请求撞一次，必须还是 401。
 *    撞的那一下交给 desktop/auth-probe.ts 做有界重试（10 次 × 300ms，每次请求 2s 超时）：
 *    **只有连接层失败（fetch 自己抛错）才重试**；一旦拿到响应而状态码不是 401，仍然立刻硬失败 ——
 *    那是鉴权被削弱，宁可启动失败也不能拖 3 秒后开一个裸奔窗口。
 * 7. before-quit 里 await handle.close() 要用 quitting 标志防重入，
 *    否则 event.preventDefault() 之后重新 quit 会自己咬自己（无限循环 / 进程挂后台）。
 *
 * 8. 票会被用户主动删掉（设置页「退出登录」/「退出其他设备」），而桌面端没有密码可登，
 *    窗口会卡在登录页死锁到下次重启 —— 所以起一个 30 秒的看门狗（见 ensureSessionAlive）。
 *
 * 9. **关窗 ≠ 退出**（Task 7）：close 事件在「不是真退出」时 preventDefault + hide，
 *    window-all-closed 也不 quit（Windows 常驻托盘）。真退出只有两条路：托盘「退出」与
 *    系统关机（before-quit），两者都把 `quitRequested` 置位，然后走同一个关服务流程。
 *    **唯一例外**是托盘没建起来（tray === null）：关窗即真关，window-all-closed 直接 quit ——
 *    没窗口又没图标，再常驻就是个占着端口和数据库的僵尸进程。
 *
 * 10. 自动更新（Task 8）只做**接线**，逻辑全在 desktop/updater.ts（懒加载 electron-updater）：
 *    打包态启动 30 秒后静默检查一次（定时器 unref，绝不挡住退出），托盘「检查更新」走手动流程。
 *    「重启安装」之前的收尾复用这里同一段 closeServerOnce()，所以不会和 before-quit 抢着关服务。
 */

/** 只监听回环：desktopAutoLogin 也要求回环（server/app.ts 的 resolveListenOptions 会校验） */
const HOSTNAME = '127.0.0.1'
/** 登录态 cookie 名，与 server/auth/middleware.ts:7 的 COOKIE_NAME 一致 */
const COOKIE_NAME = 'pb_session'
/** 与 web 的深色底一致，避免首帧白闪 */
const BACKGROUND = '#111315'
/** 看门狗间隔：每 30 秒带票探一次 /api/auth/state */
const WATCHDOG_MS = 30_000

/** 后端 4 个「根目录配置」的文件名（它们在模块加载时读 env，见文件头的坑 3） */
const CONFIG_FILES: Array<[string, string]> = [
  ['MONITOR_LINKS', 'monitor-links.json'],
  ['MONITOR_ACTIONS', 'monitor-actions.json'],
  ['MONITOR_QUICK', 'quick-links.json'],
  ['HOST_SERVICES', 'host-services.json'],
]

// 启动最早处装崩溃日志：后面每一步都可能炸（见文件头第 1 条）
installCrashHandlers()

let handle: ServerHandle | null = null
let mainWindow: BrowserWindow | null = null
/** 托盘对象必须持住，否则被 GC 掉、图标自己消失（Task 7） */
let tray: Tray | null = null
/**
 * 用户要求退出（托盘「退出」/ 系统关机 / before-quit 一旦开始关服务）：
 * close 事件据此决定「真关」还是「藏起来」，两处共用这一个标志。
 */
let quitRequested = false
/** before-quit 的重入闸（Task 6 原样保留）：第一趟 preventDefault 去关服务，第二趟才真退 */
let quitting = false
/** 票失效自愈的定时器（退出时必须清掉，否则吊着进程不放） */
let watchdog: ReturnType<typeof setInterval> | null = null

/**
 * 设 env 并返回路径。**必须在 import 后端模块之前调用**。
 *
 * 那 4 个配置文件不存在是正常情况（桌面端默认没有这些个人配置），
 * 对应的 loader 自己 try/catch 成空数组，所以这里只指路、不造文件。
 */
function prepareEnv(): DesktopPaths {
  const paths = desktopPaths(app.getPath('userData'))
  mkdirSync(paths.dataDir, { recursive: true })

  process.env.PINBOARD_DATA = paths.dataDir
  process.env.PINBOARD_SNAPSHOT = paths.snapshotPath
  // 系统分配端口：不跟本机 7788 那个正式实例抢
  process.env.PORT = '0'
  // 桌面端没有反代，必须关掉 X-Forwarded-* 信任（只有 '1' 才生效）
  process.env.TRUST_PROXY = '0'
  for (const [key, file] of CONFIG_FILES) process.env[key] = join(paths.dataDir, file)

  return paths
}

/**
 * 免密的边界自检：**不带 cookie** 请求一个受保护的接口，必须还是 401。
 * 不是 401 就说明鉴权被削弱了，宁可启动失败也不要开一个裸奔的窗口。
 *
 * 这里只做接线：重试 / 每次请求超时 / 失败诊断都在 desktop/auth-probe.ts（纯模块，单测直接覆盖）。
 * 那边保证「连接层失败才重试」（冷启动被 Defender 扫时会抖），其余情况一律立刻炸。
 */
async function assertAuthStillOn(url: string): Promise<void> {
  await probeWithRetry(url, {
    // 全局 fetch 原样传进去（不包一层闭包，测试里能断言的注入点都在 auth-probe.ts）
    fetch,
    // node:timers/promises 的 setTimeout(ms) 就是一个 Promise，不用自己写 sleep
    sleep,
    log: (m) => log('[pinfolio]', m),
  })
}

/**
 * 票失效自愈（看门狗）：桌面端没有密码可登，票一旦被删窗口就只会停在登录页，
 * 而且**没有自救路径**——所以这里每 30 秒带票探一次 /api/auth/state：
 *
 * - `authed: true` → 什么都不做；
 * - `authed: false` → 票被设置页的「退出登录」/「退出其他设备」删了，重新签发一张、
 *   盖掉 cookie、刷新页面，用户看到的就是「回到便签页」而不是登录页；
 * - 探不通（服务正在关 / 端口没接上）→ 这一轮不算失效，下一轮再说，绝不因为一次网络错误就换票。
 *
 * 重新签发用的是**同一个 db 实例**（esbuild 只打包一次，import 回来的是同一个模块单例），
 * 绝不能另开一个 DatabaseSync —— 两个连接抢 BEGIN IMMEDIATE 会互相锁死。
 */
async function ensureSessionAlive(): Promise<void> {
  const current = handle
  if (!current || !current.desktopSession || quitting) return

  try {
    const res = await fetch(current.url + '/api/auth/state', {
      headers: { cookie: COOKIE_NAME + '=' + current.desktopSession.token },
    })
    const body = (await res.json()) as { authed?: boolean }
    if (body.authed === true) return
  } catch {
    return
  }

  // 走到这里说明票真的失效了：重新签发（ensureDesktopSession 幂等，永远只剩一条记录）
  const { db } = await import('../server/db.js')
  const { ensureDesktopSession } = await import('../server/desktop-session.js')
  const fresh = ensureDesktopSession(db, { ip: HOSTNAME })
  current.desktopSession = fresh
  await session.defaultSession.cookies.set({
    url: current.url,
    name: COOKIE_NAME,
    value: fresh.token,
    httpOnly: true,
    sameSite: 'lax',
  })
  log('[pinfolio] desktop session was revoked -> re-issued, reloading')
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload()
}

/**
 * 外链拦截（Task 7）：应用窗口只许留在本站，其余一律丢给系统浏览器。
 *
 * 为什么要拦：
 * - 监测页 / 资产页 / 快捷入口卡里的链接都是 `target="_blank"`，不拦的话 Electron 会开一堆
 *   裸的 BrowserWindow（没有托盘、没有关窗规矩，等于开了个没有地址栏的浏览器）；
 * - 渲染进程里的任意一段 HTML 都能 `window.open(...)`，不拦就等于让页面决定主进程去开什么。
 *
 * 判据只有 `isInternalUrl`（纯函数，tests/unit/nav.test.mts 钉着）：
 * 只认 http://127.0.0.1:<port> 与 http://localhost:<port>。
 * **只把 http/https 递给 shell.openExternal**：file: / javascript: / data: 交出去等于
 * 让页面里的链接去启动本机程序（Windows 上 file:///.../x.exe 真的会跑）。
 */
function openExternal(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    log('[nav] 丢弃无法解析的外链：' + url)
    return
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    log('[nav] 拦下非 http(s) 的外链：' + url)
    return
  }
  log('[nav] 外链交给系统浏览器：' + url)
  void shell.openExternal(url).catch((err: unknown) => {
    log('[nav] shell.openExternal 失败：' + url, err)
  })
}

/** 给一个 webContents 装上两道闸：新窗口（window.open / target=_blank）与同窗口跳转 */
function wireNavigation(contents: WebContents, port: number): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (isInternalUrl(url, port)) {
      // 站内新窗口照开，但显式重申安全配置，别继承任何意外放宽默认值
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          backgroundColor: BACKGROUND,
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      }
    }
    openExternal(url)
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    if (isInternalUrl(url, port)) return
    event.preventDefault()
    openExternal(url)
  })

  // 上面两道闸只覆盖**这个** webContents。setWindowOpenHandler 放行的子窗口（站内 target=_blank、
  // 以及 isInternalUrl 单独放行的 window.open('about:blank')）有它自己的 webContents，页面拿到
  // 句柄后一句 `w.location.href = 'https://…'` 就能在本进程里加载外部页面 —— 实测（修复前）：
  // 进程内多出一个 https://example.com/ 的 page target，没有地址栏、没有 [nav] 日志、
  // 也没交给系统浏览器。所以每个新建出来的窗口都递归装同一套闸。
  contents.on('did-create-window', (child) => {
    wireNavigation(child.webContents, port)
  })
}

/**
 * 开主窗口（Task 7 也复用这里）。
 * 几何取上次保存的值，clampBounds 收进当前屏幕工作区（换显示器 / 拔副屏都不会开到看不见的地方）。
 */
export async function createMainWindow(win: { url: string; port: number }): Promise<BrowserWindow> {
  const paths = desktopPaths(app.getPath('userData'))
  const saved = readWindowState(paths.windowStateFile)
  const bounds: Bounds = clampBounds(saved, screen.getPrimaryDisplay().workArea, MIN_SIZE)

  const created = new BrowserWindow({
    ...bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    // 先不显示：等 ready-to-show，避免用户看到一帧空白
    show: false,
    backgroundColor: BACKGROUND,
    webPreferences: {
      // 渲染进程只当浏览器用：渲染后端页面不需要任何 node 能力
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  created.once('ready-to-show', () => created.show())

  // 外链拦截：两道闸（新窗口 / 同窗口跳转），规则见 wireNavigation
  wireNavigation(created.webContents, win.port)

  // 关窗 = 藏到托盘（Task 7）。这里**同时**记几何：藏起来之后再退出也不会丢位置。
  // 两个例外才真关：quitRequested（托盘「退出」/ 系统关机），以及托盘压根没建起来
  // （tray === null 时藏起来就再也叫不回来了，宁可关掉重开）。
  created.on('close', (event) => {
    try {
      writeWindowState(paths.windowStateFile, created.getBounds())
    } catch (err) {
      log('[pinfolio] 保存窗口状态失败：', err)
    }
    if (quitRequested || tray === null) return
    event.preventDefault()
    created.hide()
    log('[pinfolio] 关窗 -> 藏到托盘（进程与服务都还在）')
  })
  created.on('closed', () => {
    if (mainWindow === created) mainWindow = null
  })

  created.webContents.on('did-finish-load', () => {
    log(
      '[pinfolio] loaded ' + created.webContents.getURL() + ' (title: ' + created.getTitle() + ')',
    )
  })

  created.loadURL(win.url).catch((err: unknown) => {
    log('[pinfolio] 加载失败 ' + win.url + '：', err)
  })

  return created
}

/** 已开着的窗口：还原（最小化 / 隐藏）+ 聚焦（second-instance 用） */
function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
}

/**
 * 真退出：置 `quitRequested` 后 app.quit()。
 * 托盘「退出」走这里；before-quit 里也会把同一个标志置位（系统关机 / 别处调 app.quit()）。
 * 服务和定时器的收尾全在 before-quit 里做（Task 6 的防重入逻辑原样保留）。
 */
function requestQuit(): void {
  quitRequested = true
  app.quit()
}

/**
 * 关后端（**幂等**）：before-quit 与更新模块的「重启安装」共用这一份。
 * 先把 handle 摘下来再 await，谁先来谁关，后到的拿到 null 直接跳过 —— 两个入口竞争时不会关两次。
 */
async function closeServerOnce(): Promise<void> {
  const current = handle
  handle = null
  if (!current) return
  try {
    await current.close()
    log('[pinfolio] server closed')
  } catch (err) {
    log('[pinfolio] 关闭服务失败：', err)
  }
}

/**
 * 更新安装前的收尾（Task 8 注入给 desktop/updater.ts）：置 `quitRequested`（关窗不再拦，
 * 与托盘「退出」同一条语义）→ 停看门狗 → 关后端 → 交回 updater 去 quitAndInstall()。
 *
 * 为什么要在这里做完再交给 quitAndInstall：它 spawn 完安装器就 setImmediate 里 app.quit()，
 * 如果后端还开着，before-quit 会 preventDefault 去异步关服务，安装器那边已经在等进程退出了。
 * 提前关干净之后，before-quit 那一趟只剩空跑（handle 已是 null），两边不打架。
 */
async function prepareUpdateInstall(): Promise<void> {
  log('[pinfolio] 准备重启安装更新：先关服务再退出')
  quitRequested = true
  if (watchdog) {
    clearInterval(watchdog)
    watchdog = null
  }
  await closeServerOnce()
}

/**
 * 安装没完成的兜底（修复轮 I2）：`quitAndInstall()` 之后 3 秒进程还在（安装器没接管）时被调用。
 *
 * 这时候后端已经关掉了，留在原地就是「窗口还在但页面全废、quitRequested 已置所以关窗即真关、
 * window-all-closed 也不退出」的死局，唯一出路是托盘「退出」。所以直接 relaunch：
 * 新实例会重新起服务、注票、开窗 —— 用户看到的是「更新没装上，但应用还能用」。
 */
function restartForUpdateFallback(): void {
  log('[pinfolio] 安装没有完成，重启一个新的实例')
  quitRequested = true
  try {
    app.relaunch()
  } catch (err) {
    log('[pinfolio] app.relaunch() 失败：', err)
  }
  app.quit()
}

/** 起后端 → 注 cookie → 开窗 → 建托盘。startServer 与 ready 可以并行，但 cookie/窗口只能在 ready 之后 */
async function boot(): Promise<void> {
  const paths = prepareEnv()
  log('[pinfolio] userData: ' + app.getPath('userData'))
  log('[pinfolio] data dir: ' + paths.dataDir)

  // 动态 import：上一行设的 env 必须在后端模块**求值之前**生效（见文件头的坑 3）
  const { startServer } = await import('../server/app.js')
  handle = await startServer({ port: 0, hostname: HOSTNAME, desktopAutoLogin: true })
  // Task 10 的冒烟脚本按这一行正则解析端口，别改格式、别自己拼 URL
  log('[pinfolio] listening on ' + handle.url)
  if (handle.desktopSession === undefined) {
    throw new Error('startServer 没返回 desktopSession（desktopAutoLogin 没生效？）')
  }

  await app.whenReady()

  const token = handle.desktopSession.token
  await session.defaultSession.cookies.set({
    url: handle.url,
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    // 不设 secure：这里是 http 回环，secure cookie 根本不会发出去
  })

  await assertAuthStillOn(handle.url)

  const current = handle
  mainWindow = await createMainWindow(current)

  // 托盘必须在窗口之后建：菜单要读 win.isVisible()，左键要能显示回来
  try {
    tray = createTray(mainWindow, {
      onQuit: requestQuit,
      // Task 8：手动检查更新（未打包时 updater 自己只留一行「未打包，跳过更新检查」）。
      // 返回的 Promise 不 await —— 弹框流程可能开着很久，绝不能挡住主进程
      onCheckUpdate: () => {
        void checkForUpdatesInteractive()
      },
      dataDir: paths.dataDir,
    })
  } catch (err) {
    // 托盘建不起来不算致命（窗口还能用），但关窗即退出的语义要跟着退回去，
    // 否则用户点了 X 之后进程还在、又没有图标能叫回来（见 createMainWindow 的 close）
    tray = null
    log('[tray] 托盘创建失败，本次运行退化为「关窗即退出」：', err)
  }

  // 看门狗的定时器 unref：绝不因为它挡住进程退出（退出时还会再 clearInterval 一次）
  watchdog = setInterval(() => {
    void ensureSessionAlive().catch((err: unknown) => {
      log('[pinfolio] 检查桌面会话失败：', err)
    })
  }, WATCHDOG_MS)
  watchdog.unref()

  // Task 8：更新模块需要「主窗口当弹框 parent」与「安装前收尾」两件事。用注入而不是让
  // updater.ts 反向 import 本文件（会成环），mainWindow 是活变量，所以给的是一个闭包
  configureUpdater({
    getWindow: () => (mainWindow !== null && !mainWindow.isDestroyed() ? mainWindow : null),
    beforeInstall: prepareUpdateInstall,
    onInstallFailed: restartForUpdateFallback,
  })

  // 打包态启动 30 秒后静默检查一次更新：unref 保证这个定时器绝不挡住进程退出。
  // 开发态（未打包）autoCheck 只写一行「未打包，跳过更新检查」，不会碰 electron-updater
  setTimeout(() => autoCheck(), AUTO_CHECK_DELAY_MS).unref()
}

if (!app.requestSingleInstanceLock()) {
  // 第二个实例：不要起第二个后端，直接退出（窗口焦点由第一个实例的 second-instance 处理）
  app.quit()
} else {
  app.on('second-instance', () => focusMainWindow())

  // Windows 上关掉最后一个窗口默认就退出；托盘常驻要求这里**不退出**（Task 7）。
  // 例外是托盘没建起来（tray === null）：createMainWindow 的 close 那边已经放行真关，
  // 这里必须跟着退出 —— 否则留下一个没窗口、没图标、却还占着端口与 SQLite 的进程，
  // 用户只能去任务管理器杀（与「关窗即退出」的降级承诺相反）。
  app.on('window-all-closed', () => {
    if (quitRequested) return
    if (tray === null) {
      quitRequested = true
      app.quit()
      return
    }
    log('[pinfolio] 所有窗口已关闭，托盘还在，进程继续跑')
  })

  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    // 关服务期间窗口会被真关掉（不能再 preventDefault 藏起来）
    quitRequested = true
    if (watchdog) {
      clearInterval(watchdog)
      watchdog = null
    }
    // 不能同步 await：先挡住这次退出，等服务真的关干净再重新 quit
    event.preventDefault()
    void (async () => {
      // 关服务只有这一份实现（Task 8 的「重启安装」也用它，见 closeServerOnce）
      await closeServerOnce()
      // 第二趟 before-quit 会直接放行（quitting 已为真），不会自己咬自己
      app.quit()
    })()
  })

  boot().catch((err: unknown) => {
    log('[pinfolio] 启动失败：', err)
    process.exitCode = 1
    app.quit()
  })
}
