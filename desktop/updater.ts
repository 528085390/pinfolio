import { app, dialog } from 'electron'
import type { BrowserWindow, MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import { log } from './log.js'

/**
 * 桌面端自动更新（Task 8，electron-updater + GitHub Releases）。
 *
 * 只有两个对外出口（都由 main.ts 接线）：
 * - `autoCheck()`：打包态启动 30 秒后**静默**检查一次，只有真的发现新版本才弹框；
 * - `checkForUpdatesInteractive()`：托盘「检查更新」走这里，每个结果都告诉用户。
 *
 * 五条踩过 / 预判过的线：
 *
 * 1. **electron-updater 必须懒加载**（本文件最要紧的一条）：开发态（`electron .`）根本没有
 *    `<resources>/app-update.yml`，顶层 `import { autoUpdater } from 'electron-updater'` 会在启动那一刻
 *    就去初始化 updater，日志里刷一堆 error（严重时抛错），而开发态压根不该走更新。所以两个出口的
 *    第一句都是 `if (!app.isPackaged) { log('未打包，跳过更新检查'); return }`，动态 import
 *    `await import('electron-updater')` **只出现在这个判断之后**的 loadUpdater() 里。
 *    连类型都不在顶层 import（用 `typeof import('electron-updater')` 这种只在类型位置出现的写法，
 *    编译后完全擦除），免得「顶层出现 electron-updater」这条规矩有一丝歧义。
 * 2. **不许静默安装**：`autoDownload = false`（下载要用户点），`autoInstallOnAppQuit = false`
 *    （它默认是 true —— 只要下载过，用户下次正常退出就会**未经确认**装掉）。真正安装只有一条路：
 *    用户在「重启安装」弹框里点确认 → `quitAndInstall()`。
 * 3. **更新失败绝不打崩主进程**：网络不通、代理拦了 GitHub、Release 里没有 latest.yml、
 *    app-update.yml 缺失……都是正常可能发生的事。整段包在 try/catch 里，出错只留日志
 *    （手动检查再补一个错误框）。这是「网络不好就连应用都开不了」的经典事故点。
 * 4. **弹框优先带主窗口当 parent**：`dialog.showMessageBox(win, opts)` 是模态的、居中在窗口上；
 *    没有窗口（已销毁 / 还没建好）时退回 `dialog.showMessageBox(opts)`。弹框本身失败也只留日志。
 * 5. 「检查中」「下载中」这两个**中间态不用模态框**：Windows 的原生消息框没有 API 能由代码关闭，
 *    弹出来就只能等用户点，反而把「正在检查」变成卡死的对话框。改成任务栏进度条：
 *    检查中 = 不确定进度（2），下载中 = 百分比（0~1），结束一律 `setProgressBar(-1)` 复位。
 *
 * 退出语义不在这里：安装前要「置退出标志 + 关后端服务」这件事由 main.ts 注入（beforeInstall），
 * 因为只有 main.ts 知道 handle 与 before-quit 那套防重入逻辑。updater 反向 import main.ts 会成环。
 */

/** 打包态启动后多久做第一次静默检查（main.ts 用同一个值：30 秒足够让窗口与服务先就绪） */
export const AUTO_CHECK_DELAY_MS = 30_000

/**
 * electron-updater 的类型：`typeof import(...)` 只出现在**类型位置**，编译产物里没有任何 runtime import。
 * （实体按约束 1 必须在函数内部动态 import，见 loadUpdater。）
 */
type Updater = (typeof import('electron-updater'))['autoUpdater']

/** main.ts 注入的两件事：弹框的 parent 窗口、以及「安装前收尾」（置 quitRequested + 关服务） */
export type UpdaterHooks = {
  /** 当前主窗口（没有 / 已销毁就返回 null）：弹框拿它当 parent */
  getWindow: () => BrowserWindow | null
  /**
   * `quitAndInstall()` **之前**调用：置 quitRequested 并把后端服务正常关掉。
   * 由 main.ts 提供 —— 它才知道 ServerHandle 在哪、以及 before-quit 的防重入怎么走。
   */
  beforeInstall: () => Promise<void>
}

let getParentWindow: () => BrowserWindow | null = () => null
let beforeInstall: () => Promise<void> = async () => {}

/** 接线（main.ts 在 boot 里调用一次；不调用也能跑，只是没有 parent 窗口、安装前不做收尾） */
export function configureUpdater(hooks: UpdaterHooks): void {
  getParentWindow = hooks.getWindow
  beforeInstall = hooks.beforeInstall
}

/** 上一次记过日志的下载百分比（每 1% 只留一行，别让进度条把 1 MB 的日志刷爆） */
let loggedPercent = -1

/** 一次性的 updater 实例：懒加载 + 只配置一次 */
let updaterPromise: Promise<Updater> | null = null

/**
 * **唯一的懒加载点**：只有走到这里才会 `import('electron-updater')`。
 * 失败（安装包里没带上 electron-updater、asar 里解析不到）不缓存失败结果，下次点「检查更新」还能再试。
 */
async function loadUpdater(): Promise<Updater> {
  if (updaterPromise === null) {
    updaterPromise = initUpdater().catch((err: unknown) => {
      updaterPromise = null
      throw err
    })
  }
  return updaterPromise
}

/** 首次加载时的配置：不自动下载、不自动安装、logger 接到 log()、事件全接上 */
async function initUpdater(): Promise<Updater> {
  const { autoUpdater } = await import('electron-updater')

  // 必须由用户点「下载」：autoDownload 默认 true，会一发现新版本就闷头下几百 MB
  autoUpdater.autoDownload = false
  // 必须由用户点「重启安装」：默认 true 会在用户下次正常退出时**静默装掉**
  autoUpdater.autoInstallOnAppQuit = false

  // electron-updater 的 Logger 是 (message?: any) => void，会把 Error / 对象直接塞进来：
  // 统一转成字符串再交给 log()，日志里每一行都才可核对
  autoUpdater.logger = {
    info: (message?: unknown) => log('[updater:info] ' + asText(message)),
    warn: (message?: unknown) => log('[updater:warn] ' + asText(message)),
    error: (message?: unknown) => log('[updater:error] ' + asText(message)),
    debug: (message?: unknown) => log('[updater:debug] ' + asText(message)),
  }

  wireEvents(autoUpdater)
  log('[updater] electron-updater 已加载（当前版本 ' + app.getVersion() + '）')
  return autoUpdater
}

/** 六个事件全部接到日志（可核对的行），下载进度顺手驱动任务栏进度条 */
function wireEvents(updater: Updater): void {
  updater.on('checking-for-update', () => {
    log('[updater] checking-for-update')
  })

  updater.on('update-available', (info) => {
    log('[updater] update-available: ' + info.version)
  })

  updater.on('update-not-available', (info) => {
    log('[updater] update-not-available: 本地 ' + app.getVersion() + '，远端 ' + info.version)
  })

  updater.on('error', (err) => {
    // 事件里的错误只负责留痕；谁来兜底看调用方（手动检查会弹框）。这里绝不 throw
    log('[updater] error: ' + asText(err))
  })

  updater.on('download-progress', (progress) => {
    const percent = Math.round(progress.percent)
    if (percent !== loggedPercent) {
      loggedPercent = percent
      log(
        '[updater] download-progress: ' +
          percent +
          '% (' +
          Math.round(progress.transferred / 1024) +
          '/' +
          Math.round(progress.total / 1024) +
          ' KB, ' +
          Math.round(progress.bytesPerSecond / 1024) +
          ' KB/s)',
      )
    }
    setProgressBar(progress.percent / 100)
  })

  updater.on('update-downloaded', (event) => {
    log('[updater] update-downloaded: ' + event.version + ' -> ' + event.downloadedFile)
    setProgressBar(-1)
  })
}

/**
 * 打包态启动 30 秒后的**静默**检查：成功不提示（只在日志留 update-not-available / update-available），
 * 失败也只在日志里（绝不弹框、绝不抛），只有**真的发现新版本**才弹「下载 / 以后」。
 */
export function autoCheck(): void {
  // 开发态没有 app-update.yml：先挡在动态 import **之前**，保证这条路径上 electron-updater 没被加载
  if (!app.isPackaged) {
    log('未打包，跳过更新检查')
    return
  }
  void (async () => {
    try {
      const updater = await loadUpdater()
      log('[updater] 启动静默检查更新')
      const result = await updater.checkForUpdates()
      if (result === null || !result.isUpdateAvailable) return
      await offerDownload(updater, result.updateInfo.version)
    } catch (err) {
      log('[updater] 静默检查更新失败（不影响继续使用）：', err)
    }
  })()
}

/** 托盘「检查更新」：每个结果都给用户一个交代（检查中 / 已是最新 / 找到新版 / 下载中 / 重启安装 / 出错） */
export async function checkForUpdatesInteractive(): Promise<void> {
  if (!app.isPackaged) {
    log('未打包，跳过更新检查')
    return
  }
  // 「检查中」：不确定进度（见文件头第 5 条，不用会卡住的模态框）
  setProgressBar(2)
  try {
    const updater = await loadUpdater()
    log('[updater] 手动检查更新')
    const result = await updater.checkForUpdates()

    if (result === null) {
      // updater 自己判定不可用：多半是安装包里缺 app-update.yml
      log('[updater] updater 未启用（缺 app-update.yml？）')
      await showBox({
        type: 'warning',
        title: '检查更新',
        message: '当前安装不支持自动更新',
        detail: '找不到更新配置（app-update.yml）。请到 Releases 页面手动下载安装包。',
        buttons: ['好'],
        noLink: true,
      })
      return
    }

    if (!result.isUpdateAvailable) {
      await showBox({
        type: 'info',
        title: '检查更新',
        message: '已是最新版本',
        detail: '当前版本 ' + app.getVersion() + ' 已是最新。',
        buttons: ['好'],
        noLink: true,
      })
      return
    }

    await offerDownload(updater, result.updateInfo.version)
  } catch (err) {
    log('[updater] 检查更新失败：', err)
    await showBox({
      type: 'error',
      title: '检查更新',
      message: '检查更新失败',
      detail: asText(err) + '\n\n可以稍后再试；网络不通不影响继续使用 pinfolio。',
      buttons: ['好'],
      noLink: true,
    })
  } finally {
    setProgressBar(-1)
  }
}

/** 「找到新版」：用户点「下载」才真的下载，下载完再问「重启安装」 */
async function offerDownload(updater: Updater, version: string): Promise<void> {
  const { response } = await showBox({
    type: 'info',
    title: '发现新版本',
    message: '发现新版本 ' + version,
    detail:
      '当前版本 ' +
      app.getVersion() +
      ' → 新版本 ' +
      version +
      '。\n\n下载在后台进行，完成后会问你要不要立刻重启安装。',
    buttons: ['下载', '以后'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })
  if (response !== 0) {
    log('[updater] 用户选择「以后」（version ' + version + '）')
    return
  }
  await downloadAndOfferInstall(updater, version)
}

/** 下载（进度走任务栏 + 每 1% 一行日志），下完问「重启安装 / 以后」 */
async function downloadAndOfferInstall(updater: Updater, version: string): Promise<void> {
  log('[updater] 用户确认下载 version ' + version)
  loggedPercent = -1
  try {
    await updater.downloadUpdate()
  } catch (err) {
    log('[updater] 下载失败：', err)
    await showBox({
      type: 'error',
      title: '更新下载失败',
      message: '下载新版本失败',
      detail: asText(err) + '\n\n网络恢复后可以再点一次「检查更新」。',
      buttons: ['好'],
      noLink: true,
    })
    return
  } finally {
    setProgressBar(-1)
  }

  const { response } = await showBox({
    type: 'info',
    title: '更新已就绪',
    message: '新版本 ' + version + ' 已下载完成',
    detail: '点「重启安装」会关闭 pinfolio、安装新版本并重新打开。',
    buttons: ['重启安装', '以后'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })
  if (response !== 0) {
    // 注意 autoInstallOnAppQuit = false：这里选「以后」，下次正常退出也**不会**偷偷装
    log('[updater] 用户选择稍后安装（version ' + version + '，退出时不会自动安装）')
    return
  }
  await installUpdate(updater, version)
}

/**
 * 真正安装：**先**做安装前收尾（置 quitRequested + 把后端服务关干净），**再** quitAndInstall()。
 *
 * electron-updater 的 quitAndInstall 是同步的：它先把安装器 spawn 起来，然后在 setImmediate 里
 * `app.quit()`。而这个应用「退出前要先 await handle.close()」（before-quit 会 preventDefault
 * 再异步关服务）—— 如果等到那一刻才关，安装器已经在等进程退出了，两边容易抢时序。
 * 所以先自己把服务关掉（复用 main.ts 里同一段收尾，见 prepareUpdateInstall），
 * 之后 before-quit 那一趟只剩「handle 已经是 null」的空跑，不会打架。
 */
async function installUpdate(updater: Updater, version: string): Promise<void> {
  log('[updater] 用户确认重启安装 version ' + version)
  try {
    await beforeInstall()
  } catch (err) {
    // 收尾失败也继续：用户已经明确点了「重启安装」，让它装
    log('[updater] 安装前收尾失败（继续安装）：', err)
  }
  try {
    updater.quitAndInstall()
    log('[updater] quitAndInstall 已调用')
  } catch (err) {
    log('[updater] quitAndInstall 失败：', err)
    await showBox({
      type: 'error',
      title: '安装更新失败',
      message: '无法启动安装程序',
      // 走到这里时服务已经关了（beforeInstall 跑过），所以要让用户知道直接重开一次
      detail: asText(err) + '\n\n请重新打开 pinfolio，然后到 Releases 页面手动下载安装包。',
      buttons: ['好'],
      noLink: true,
    })
  }
}

/**
 * 统一的弹框出口：有主窗口就带 parent（模态、居中在窗口上），没有就退回不带 parent 的版本。
 * **永不抛**：弹框自己失败（无 GUI 会话 / 窗口正在销毁）只留日志，并当作「用户点了取消」返回，
 * 让调用方据此不做任何危险动作（下载 / 安装）。
 */
async function showBox(options: MessageBoxOptions): Promise<MessageBoxReturnValue> {
  const win = getParentWindow()
  if (win !== null && !win.isDestroyed()) {
    try {
      return await dialog.showMessageBox(win, options)
    } catch (err) {
      log('[updater] 带窗口的弹框失败，回退到无 parent：', err)
    }
  }
  try {
    return await dialog.showMessageBox(options)
  } catch (err) {
    log('[updater] 弹框失败：', err)
    return { response: options.cancelId ?? 1, checkboxChecked: false }
  }
}

/** 任务栏进度条（中间态的唯一可视反馈，见文件头第 5 条）：失败也不能反过来影响更新流程 */
function setProgressBar(value: number): void {
  try {
    const win = getParentWindow()
    if (win !== null && !win.isDestroyed()) win.setProgressBar(value)
  } catch (err) {
    log('[updater] 设置任务栏进度失败：', err)
  }
}

/** electron-updater 的 logger 会把 Error / 对象塞进来：统一转成字符串（log() 自己也会兜，但这里更可控） */
function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack ?? value.name + ': ' + value.message
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value)
    } catch {
      try {
        return String(value)
      } catch {
        return '[unloggable]'
      }
    }
  }
  try {
    return String(value)
  } catch {
    return '[unloggable]'
  }
}
