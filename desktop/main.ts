import { app, BrowserWindow, screen, session } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ServerHandle } from '../server/app.js'
import { desktopPaths } from './paths.js'
import type { DesktopPaths } from './paths.js'
import { MIN_SIZE, clampBounds, readWindowState, writeWindowState } from './window-state.js'
import type { Bounds } from './window-state.js'

/**
 * Electron 主进程：把 pinfolio 后端和窗口在**同一个进程**里起起来
 * （spec 2026-10-27-pinfolio-desktop，Task 6）。
 *
 * 顺序是这个文件里唯一要紧的东西，逐条对应踩过的坑：
 *
 * 1. 单实例锁最先：第二个实例不许再起一个后端（Task 2 的会话是**单条**，
 *    两个实例会抢 settings 里的 desktop_session_id，互相把对方的票作废）。
 * 2. `desktopPaths(app.getPath('userData'))` → 建数据目录 → 设 env。
 *    **必须在下一步的动态 import 之前**：server/db.ts:14（PINBOARD_DATA）、
 *    server/snapshot/write.ts:22（PINBOARD_SNAPSHOT）、server/kuma/links.ts:7 等四个根目录
 *    配置（MONITOR_* / HOST_SERVICES）全是**模块级求值**，import 完再设就没用了。
 *    PINBOARD_SNAPSHOT 必须给**绝对路径**（Task 3 的覆盖语义），父目录由 Task 3 自己 mkdir。
 * 3. 动态 import `../server/app.js`：esbuild 会把它内联进 dist-desktop/main.js，
 *    但**求值时机**仍是这一行（见 package.json 的 build:desktop:main）。
 * 4. startServer 用 PORT=0 让系统分配端口，url 只用 handle.url（别自己拼）。
 * 5. cookie 注入与开窗都必须在 `app.whenReady()` 之后：session.defaultSession 要等 ready 才存在。
 *    免密是「替用户带一张票」，不是拆掉鉴权 —— 注完立刻用不带 cookie 的请求撞一次，必须还是 401。
 * 6. before-quit 里 await handle.close() 要用 quitting 标志防重入，
 *    否则 event.preventDefault() 之后重新 quit 会自己咬自己（无限循环 / 进程挂后台）。
 *
 * 本任务只做「关窗 = 真退出」，托盘接管是 Task 7。
 */

/** 只监听回环：desktopAutoLogin 也要求回环（server/app.ts 的 resolveListenOptions 会校验） */
const HOSTNAME = '127.0.0.1'
/** 登录态 cookie 名，与 server/auth/middleware.ts:7 的 COOKIE_NAME 一致 */
const COOKIE_NAME = 'pb_session'
/** 与 web 的深色底一致，避免首帧白闪 */
const BACKGROUND = '#111315'

/** 后端 4 个「根目录配置」的文件名（它们在模块加载时读 env，见文件头的坑 2） */
const CONFIG_FILES: Array<[string, string]> = [
  ['MONITOR_LINKS', 'monitor-links.json'],
  ['MONITOR_ACTIONS', 'monitor-actions.json'],
  ['MONITOR_QUICK', 'quick-links.json'],
  ['HOST_SERVICES', 'host-services.json'],
]

let handle: ServerHandle | null = null
let mainWindow: BrowserWindow | null = null
/** before-quit 的重入闸：第一趟 preventDefault 去关服务，第二趟才真退 */
let quitting = false

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
  console.log('[pinfolio] auth guard ok: /api/notes without cookie -> 401')
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

  // 关窗时记住几何（本任务允许真关闭；托盘接管是 Task 7）
  created.on('close', () => {
    try {
      writeWindowState(paths.windowStateFile, created.getBounds())
    } catch (err) {
      console.error('[pinfolio] 保存窗口状态失败：', err)
    }
  })
  created.on('closed', () => {
    if (mainWindow === created) mainWindow = null
  })

  created.webContents.on('did-finish-load', () => {
    console.log(
      '[pinfolio] loaded ' + created.webContents.getURL() + ' (title: ' + created.getTitle() + ')',
    )
  })

  created.loadURL(win.url).catch((err: unknown) => {
    console.error('[pinfolio] 加载失败 ' + win.url + '：', err)
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

/** 起后端 → 注 cookie → 开窗。startServer 与 ready 可以并行，但 cookie/窗口只能在 ready 之后 */
async function boot(): Promise<void> {
  const paths = prepareEnv()
  console.log('[pinfolio] userData: ' + app.getPath('userData'))
  console.log('[pinfolio] data dir: ' + paths.dataDir)

  // 动态 import：上一行设的 env 必须在后端模块**求值之前**生效（见文件头的坑 2）
  const { startServer } = await import('../server/app.js')
  handle = await startServer({ port: 0, hostname: HOSTNAME, desktopAutoLogin: true })
  // Task 10 的冒烟脚本按这一行正则解析端口，别改格式、别自己拼 URL
  console.log('[pinfolio] listening on ' + handle.url)
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

  mainWindow = await createMainWindow(handle)
}

if (!app.requestSingleInstanceLock()) {
  // 第二个实例：不要起第二个后端，直接退出（窗口焦点由第一个实例的 second-instance 处理）
  app.quit()
} else {
  app.on('second-instance', () => focusMainWindow())

  // 本任务允许真退出（托盘接管是 Task 7）
  app.on('window-all-closed', () => app.quit())

  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    // 不能同步 await：先挡住这次退出，等服务真的关干净再重新 quit
    event.preventDefault()
    void (async () => {
      const current = handle
      handle = null
      if (current) {
        try {
          await current.close()
          console.log('[pinfolio] server closed')
        } catch (err) {
          console.error('[pinfolio] 关闭服务失败：', err)
        }
      }
      // 第二趟 before-quit 会直接放行（quitting 已为真），不会自己咬自己
      app.quit()
    })()
  })

  boot().catch((err: unknown) => {
    console.error('[pinfolio] 启动失败：', err)
    process.exitCode = 1
    app.quit()
  })
}
