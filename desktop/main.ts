import { app, BrowserWindow, screen, session, shell } from 'electron'
import type { Tray, WebContents } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ServerHandle } from '../server/app.js'
import { desktopPaths } from './paths.js'
import type { DesktopPaths } from './paths.js'
import { installCrashHandlers, log } from './log.js'
import { isInternalUrl } from './nav.js'
import { createTray } from './tray.js'
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
 * 7. before-quit 里 await handle.close() 要用 quitting 标志防重入，
 *    否则 event.preventDefault() 之后重新 quit 会自己咬自己（无限循环 / 进程挂后台）。
 *
 * 8. 票会被用户主动删掉（设置页「退出登录」/「退出其他设备」），而桌面端没有密码可登，
 *    窗口会卡在登录页死锁到下次重启 —— 所以起一个 30 秒的看门狗（见 ensureSessionAlive）。
 *
 * 9. **关窗 ≠ 退出**（Task 7）：close 事件在「不是真退出」时 preventDefault + hide，
 *    window-all-closed 也不 quit（Windows 常驻托盘）。真退出只有两条路：托盘「退出」与
 *    系统关机（before-quit），两者都把 `quitRequested` 置位，然后走同一个关服务流程。
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
 */
async function assertAuthStillOn(url: string): Promise<void> {
  const res = await fetch(url + '/api/notes')
  if (res.status !== 401) {
    throw new Error('免密注入后不带 cookie 的 /api/notes 应返回 401，实际 ' + res.status)
  }
  log('[pinfolio] auth guard ok: /api/notes without cookie -> 401')
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
      // Task 8 接真实实现，这里只是桩：不许抛错，只留一行日志
      onCheckUpdate: () => {
        log('[tray] update check not wired yet')
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
}

if (!app.requestSingleInstanceLock()) {
  // 第二个实例：不要起第二个后端，直接退出（窗口焦点由第一个实例的 second-instance 处理）
  app.quit()
} else {
  app.on('second-instance', () => focusMainWindow())

  // Windows 上关掉最后一个窗口默认就退出；托盘常驻要求这里**什么也不做**（Task 7）
  app.on('window-all-closed', () => {
    if (quitRequested) return
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
      const current = handle
      handle = null
      if (current) {
        try {
          await current.close()
          log('[pinfolio] server closed')
        } catch (err) {
          log('[pinfolio] 关闭服务失败：', err)
        }
      }
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
