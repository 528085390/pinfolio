import { app, BrowserWindow, screen, shell } from 'electron'
import type { Tray, WebContents } from 'electron'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { desktopPaths } from './paths.js'
import { installCrashHandlers, log } from './log.js'
import { isInternalUrl } from './nav.js'
import { getOfflineDataUrl } from './offline-page.js'
import { createTray } from './tray.js'
import { AUTO_CHECK_DELAY_MS, autoCheck, checkForUpdatesInteractive, configureUpdater } from './updater.js'
import { MIN_SIZE, clampBounds, readWindowState, writeWindowState } from './window-state.js'
import type { Bounds } from './window-state.js'

/**
 * pinfolio 桌面客户端主进程（原生客户端套壳）。
 *
 * 核心逻辑：
 * 1. 核心永远是网页端服务（默认 http://127.0.0.1:7788/，支持 PINBOARD_WEB_URL 覆盖）。
 * 2. 桌面端本身不启动后端、不自建数据库，直接连接网页端服务，两端数据完全统一。
 * 3. 若网页端未启动，窗口展示优雅的深色等待与自动重连提示页。
 * 4. 具备完整的桌面原生能力：单实例运行、托盘常驻/关窗最小化、外链安全拦截、窗口尺寸记忆、自动更新。
 */

/** 与 web 的深色底一致，避免首帧白闪 */
const BACKGROUND = '#111315'

/** 启动最早处装崩溃日志 */
installCrashHandlers()

let mainWindow: BrowserWindow | null = null
/** 托盘对象必须持住，否则被 GC 掉、图标自己消失 */
let tray: Tray | null = null
/** 用户要求退出（托盘「退出」/ 系统关机）：close 事件据此决定「真关」还是「藏起来」 */
let quitRequested = false

/**
 * 解析目标网页端 URL。
 * 优先级：环境变量 PINBOARD_WEB_URL > PINBOARD_URL > client-config.json > 默认 127.0.0.1:7788
 */
export function resolveTargetUrl(userDataDir?: string): string {
  if (process.env.PINBOARD_WEB_URL) return process.env.PINBOARD_WEB_URL.trim()
  if (process.env.PINBOARD_URL) return process.env.PINBOARD_URL.trim()
  if (userDataDir) {
    try {
      const cfgFile = join(userDataDir, 'client-config.json')
      if (existsSync(cfgFile)) {
        const parsed = JSON.parse(readFileSync(cfgFile, 'utf8'))
        if (typeof parsed?.url === 'string' && parsed.url.trim()) {
          return parsed.url.trim()
        }
      }
    } catch {}
  }
  return 'http://127.0.0.1:7788'
}

/**
 * 外链拦截：应用窗口只许留在本站，其余一律丢给系统浏览器。
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
  if (process.env.PINBOARD_NO_OPEN_EXTERNAL === '1' || process.argv.includes('--no-open-external')) {
    log('[nav] 测试模式：跳过实际调用系统浏览器打开 ' + url)
    return
  }
  log('[nav] 外链交给系统浏览器：' + url)
  void shell.openExternal(url).catch((err: unknown) => {
    log('[nav] shell.openExternal 失败：' + url, err)
  })
}

/** 给一个 webContents 装上两道闸：新窗口（window.open / target=_blank）与同窗口跳转 */
function wireNavigation(contents: WebContents, targetUrl: string): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (isInternalUrl(url, targetUrl)) {
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
    if (isInternalUrl(url, targetUrl)) return
    event.preventDefault()
    openExternal(url)
  })

  // 子窗口递归装闸
  contents.on('did-create-window', (child) => {
    wireNavigation(child.webContents, targetUrl)
  })
}

/**
 * 开主窗口。
 * 几何取上次保存的值，clampBounds 收进当前屏幕工作区。
 */
export async function createMainWindow(targetUrl: string): Promise<BrowserWindow> {
  const paths = desktopPaths(app.getPath('userData'))
  const saved = readWindowState(paths.windowStateFile)
  const bounds: Bounds = clampBounds(saved, screen.getPrimaryDisplay().workArea, MIN_SIZE)

  const created = new BrowserWindow({
    ...bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    backgroundColor: BACKGROUND,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  created.once('ready-to-show', () => created.show())

  // 外链拦截：两道闸（新窗口 / 同窗口跳转）
  wireNavigation(created.webContents, targetUrl)

  // 关窗 = 藏到托盘（保存窗口几何）
  created.on('close', (event) => {
    try {
      writeWindowState(paths.windowStateFile, created.getBounds())
    } catch (err) {
      log('[pinfolio] 保存窗口状态失败：', err)
    }
    if (quitRequested || tray === null) return
    event.preventDefault()
    created.hide()
    log('[pinfolio] 关窗 -> 藏到托盘（客户端继续常驻）')
  })
  created.on('closed', () => {
    if (mainWindow === created) mainWindow = null
  })

  created.webContents.on('did-finish-load', () => {
    const loadedUrl = created.webContents.getURL()
    const displayUrl = loadedUrl.startsWith('data:') ? 'offline waiting page' : loadedUrl
    log('[pinfolio] loaded ' + displayUrl + ' (title: ' + created.getTitle() + ')')
  })

  // 当网页端尚未启动或连接失败时，加载离线等待提示页
  created.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    log('[pinfolio] 加载失败 ' + validatedURL + ' (' + errorCode + ': ' + errorDescription + ')')
    if (isInternalUrl(validatedURL, targetUrl) && !validatedURL.startsWith('data:')) {
      created.loadURL(getOfflineDataUrl(targetUrl)).catch((e: unknown) => {
        log('[pinfolio] 加载等待重试提示页失败：', e)
      })
    }
  })

  created.loadURL(targetUrl).catch((err: unknown) => {
    log('[pinfolio] 初始 loadURL 失败 ' + targetUrl + '：', err)
  })

  return created
}

/** 已开着的窗口：还原 + 聚焦 */
function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
}

/** 真退出：置 quitRequested 后 app.quit() */
function requestQuit(): void {
  quitRequested = true
  app.quit()
}

/** 重启新实例（更新安装异常时的兜底） */
function restartForUpdateFallback(): void {
  log('[pinfolio] 安装没有完成，重启新实例')
  quitRequested = true
  try {
    app.relaunch()
  } catch (err) {
    log('[pinfolio] app.relaunch() 失败：', err)
  }
  app.quit()
}

/** 启动桌面客户端套壳 */
async function boot(): Promise<void> {
  const paths = desktopPaths(app.getPath('userData'))
  mkdirSync(join(app.getPath('userData'), 'logs'), { recursive: true })

  const targetUrl = resolveTargetUrl(app.getPath('userData'))
  log('[pinfolio] userData: ' + app.getPath('userData'))
  log('[pinfolio] target url: ' + targetUrl)
  // 保持 listening on 行，供冒烟脚本提取端口与地址
  log('[pinfolio] listening on ' + targetUrl)

  await app.whenReady()

  mainWindow = await createMainWindow(targetUrl)

  // 创建托盘
  try {
    tray = createTray(mainWindow, {
      onQuit: requestQuit,
      onCheckUpdate: () => {
        void checkForUpdatesInteractive()
      },
      webUrl: targetUrl,
      dataDir: paths.dataDir,
    })
  } catch (err) {
    tray = null
    log('[tray] 托盘创建失败，本次运行退化为「关窗即退出」：', err)
  }

  // 配置自动更新模块
  configureUpdater({
    getWindow: () => (mainWindow !== null && !mainWindow.isDestroyed() ? mainWindow : null),
    beforeInstall: async () => {
      quitRequested = true
    },
    onInstallFailed: restartForUpdateFallback,
  })

  // 打包态启动 30 秒后静默检查更新
  setTimeout(() => autoCheck(), AUTO_CHECK_DELAY_MS).unref()
}

if (!app.requestSingleInstanceLock()) {
  // 第二个实例直接退出，唤醒已有窗口
  app.quit()
} else {
  app.on('second-instance', () => focusMainWindow())

  app.on('window-all-closed', () => {
    if (quitRequested) return
    if (tray === null) {
      quitRequested = true
      app.quit()
      return
    }
    log('[pinfolio] 所有窗口已关闭，托盘还在，进程继续跑')
  })

  app.on('before-quit', () => {
    quitRequested = true
  })

  boot().catch((err: unknown) => {
    log('[pinfolio] 启动失败：', err)
    process.exitCode = 1
    app.quit()
  })
}
