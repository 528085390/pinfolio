import { app, dialog } from 'electron'
import type { BrowserWindow, MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import { log } from './log.js'
import { decideInstall, pickAutoUpdater } from './updater-interop.js'

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
 *    第一句都是 `if (!app.isPackaged) { log('[updater] 未打包，跳过更新检查'); return }`，动态 import
 *    **只出现在这个判断之后**的 loadUpdater() 里。
 *    连类型都不在顶层 import（用 `typeof import('electron-updater')` 这种只在类型位置出现的写法，
 *    编译后完全擦除），免得「顶层出现 electron-updater」这条规矩有一丝歧义。
 *    动态 import 的目标是 **'./updater-vendor.cjs'**（Task 9 / 方案 A），不是 'electron-updater'：
 *    electron-updater 在 devDependencies 里，electron-builder 只打 production dependencies，
 *    装出来的包里根本没有它。vendor 包（desktop/updater-vendor.cts）由 build:desktop:vendor 用
 *    esbuild `--bundle`（**不带** --packages=external）把 electron-updater 整块内联进
 *    dist-desktop/updater-vendor.cjs，于是 asar 里自带更新代码，依赖图一行不用改。
 *    开发态没有这个文件时也没有问题：`app.isPackaged` 守卫在前面，这条路径根本走不到。
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
 * 6. **取 autoUpdater 必须过 interop 兜底**（修复轮 C1）：electron-updater 的 `autoUpdater` 是
 *    `Object.defineProperty(exports, 'autoUpdater', { get })` 暴露的，Node 的 cjs-module-lexer 静态分析
 *    识别不到 → `(await import('electron-updater')).autoUpdater` 是 **undefined**（类型声明里却有，tsc 不报错）。
 *    所以统一走 updater-interop.ts 的 pickAutoUpdater()，它按「具名 → default → module.exports」取。
 * 7. **安装失败不许把应用变砖**（修复轮 I2），也**不许反过来让更新通道静默失效**（修复轮 2 / N1）：
 *    `quitAndInstall()` 整条链**不抛异常**（BaseUpdater 里是 dispatchError + return false），所以不能靠 catch 兜底。
 *    顺序是：先查 installerPath → 收尾关服务 → quitAndInstall() → 3 秒看门狗。
 *    预检查是 **fail-open** 的（判定本身在 updater-interop.ts 的 decideInstall 里）：
 *    只有「属性**存在**且值为 null / 空串 / 非字符串」才**不关服务**、直接给可执行的错误提示；
 *    属性**根本不存在**（`'installerPath' in updater` 为假，多半是 electron-updater 改了这个 protected getter 的名字）
 *    时照常往下装 —— 否则一次上游改名就会让更新通道静默永久失效（不变砖，但再也装不上任何更新）。
 *    看门狗只判「quitAndInstall 之后 3 秒进程还在」→ onInstallFailed() 让 main.ts relaunch 一个可用实例。
 * 8. **同一个失败只记一条**（收尾轮 P6）：electron-updater 的 checkForUpdates() 失败时**既发 'error' 事件
 *    又 reject**，而它自己在构造函数里挂的监听器还会把同一份错误再交给 autoUpdater.logger.error ——
 *    三个出口各写一次，main.log 里一次失败就是三条同样 ~3 KB 的堆栈（实测：5 次失败 = 5+5+5 条）。
 *    现在所有失败只走 logFailure()：按「错误对象 + 归一化文本」认重复，一次流程（一次检查 / 一次下载，
 *    见 resetFailureLog）里只写第一条。为了让写下的那条信息最全，我们的 'error' 监听器改用
 *    **prependListener** 注册 —— 排在 electron-updater 内部那个只做 logger.error 的监听器前面，
 *    于是先落盘的是**带 statusCode / url** 的那条，后面两条被去重掉。
 *    去重只影响**写日志**：错误照旧 reject、手动检查照旧弹「检查更新失败」，用户可见行为一个字没改。
 *
 * 退出语义不在这里：安装前要「置退出标志 + 关后端服务」这件事由 main.ts 注入（beforeInstall），
 * 因为只有 main.ts 知道 handle 与 before-quit 那套防重入逻辑。updater 反向 import main.ts 会成环。
 */

/** 打包态启动后多久做第一次静默检查（main.ts 用同一个值：30 秒足够让窗口与服务先就绪） */
export const AUTO_CHECK_DELAY_MS = 30_000

/** quitAndInstall() 之后等多久判断「安装器有没有接管」（3 秒足够 NSIS 把进程接管过去） */
const INSTALL_WATCHDOG_MS = 3000

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
  /**
   * `quitAndInstall()` 之后 3 秒看门狗触发时调用：安装器没接管、进程还活着时，
   * main.ts 负责 `app.relaunch()` + `quitRequested = true` + `app.quit()`，
   * 把用户送回一个**能用的实例**，而不是一个后端已停、页面全废、又退不掉的窗口。
   */
  onInstallFailed: () => void
}

let getParentWindow: () => BrowserWindow | null = () => null
let beforeInstall: () => Promise<void> = async () => {}
let onInstallFailed: () => void = () => {}

/** 接线（main.ts 在 boot 里调用一次；不调用也能跑，只是没有 parent 窗口、安装前不做收尾） */
export function configureUpdater(hooks: UpdaterHooks): void {
  getParentWindow = hooks.getWindow
  beforeInstall = hooks.beforeInstall
  onInstallFailed = hooks.onInstallFailed
}

/** 上一次记过日志的下载百分比（每 1% 只留一行，别让进度条把 1 MB 的日志刷爆） */
let loggedPercent = -1

/** 正在跑的那一次检查（M3）：autoCheck 与手动检查撞上时共用同一个 Promise，绝不并发问两遍 GitHub */
let pendingCheck: Promise<Awaited<ReturnType<Updater['checkForUpdates']>>> | null = null
/** 下载 / 安装流程执行中（M3）：挡住连点「重启安装」，不重复下载、不重复安装 */
let busy = false

/**
 * 已经记过日志的失败（P6，见文件头第 8 条）：WeakSet 认「同一个错误对象」（'error' 事件与 reject
 * 拿到的是同一个实例），文本 Set 认「同一段消息 / 栈」—— electron-updater 内部那个监听器只把拼好的
 * 字符串交给 logger.error，没有对象可比。每次流程开始前清空（resetFailureLog），所以去重范围只到
 * 「这一次检查 / 这一次下载」：过一会儿再点一次，同样的 404 还会照样记一条（不是永久闭嘴）。
 */
let loggedFailures = new WeakSet<object>()
let loggedFailureTexts = new Set<string>()

/** 清空去重记录：一次检查 / 一次下载开始前调用 */
function resetFailureLog(): void {
  loggedFailures = new WeakSet()
  loggedFailureTexts = new Set()
}

/** 归一化后的比对文本：logger 收到的是 `Error: <stack>`，而 reject 给的是 Error 对象，去掉前缀才对得上 */
function failureText(value: unknown): string {
  let text = asText(value)
  while (text.startsWith('Error: ')) text = text.slice('Error: '.length)
  return text.trim()
}

/** 值得单独抄出来的字段（electron-updater 的 HttpError 只有 statusCode；url 只在栈里） */
function errorFacts(err: unknown): string {
  if (typeof err !== 'object' || err === null) return ''
  const record = err as Record<string, unknown>
  const parts: string[] = []
  for (const key of ['code', 'statusCode', 'url']) {
    const value = record[key]
    if (typeof value === 'string' || typeof value === 'number') parts.push(key + '=' + value)
  }
  return parts.length > 0 ? '[' + parts.join(' ') + ']' : ''
}

/**
 * **唯一**的失败日志出口（P6，见文件头第 8 条）：同一个失败第二次走进来时一个字都不写。
 * 只影响日志 —— 错误照旧往上抛，调用方照旧弹框、照旧 return，用户可见行为不变。
 */
function logFailure(prefix: string, err: unknown): void {
  const text = failureText(err)
  const seen =
    (typeof err === 'object' && err !== null && loggedFailures.has(err)) ||
    (text !== '' && loggedFailureTexts.has(text))
  if (typeof err === 'object' && err !== null) loggedFailures.add(err)
  if (text !== '') loggedFailureTexts.add(text)
  if (seen) return
  const facts = errorFacts(err)
  log(prefix + (facts === '' ? '' : facts + ' ') + asText(err))
}

/**
 * 去重后的 checkForUpdates()：
 * 30 秒静默检查与用户手点「检查更新」可能撞在一起 —— 两个都去问一遍既浪费，
 * 也会让 electron-updater 内部的 updateInfoAndProvider 状态互相覆盖。共用结果即可。
 * 注意这里**只去重检查**：手动流程拿到同一份结果后照样弹自己的框，用户不会点了没反应。
 */
function checkOnce(updater: Updater): Promise<Awaited<ReturnType<Updater['checkForUpdates']>>> {
  if (pendingCheck !== null) {
    log('[updater] 已有检查在进行，复用这一次的结果')
    return pendingCheck
  }
  // 新的一次检查：失败去重记录从零开始（复用上面那次的不清，否则会把正在跑的那次抹掉）
  resetFailureLog()
  pendingCheck = updater.checkForUpdates().finally(() => {
    pendingCheck = null
  })
  return pendingCheck
}

/** 一次性的 updater 实例：懒加载 + 只配置一次 */
let updaterPromise: Promise<Updater> | null = null

/**
 * **唯一的懒加载点**：只有走到这里才会 `import('./updater-vendor.cjs')`（内联了 electron-updater，见文件头第 1 条）。
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
  // C1：electron-updater 的 `autoUpdater` 由 `Object.defineProperty(exports, "autoUpdater", { get })`
  // 暴露，cjs-module-lexer 静态分析识别不到 → 解构出来是 undefined。必须走 pickAutoUpdater，见 updater-interop.ts
  const autoUpdater = pickAutoUpdater(await import('./updater-vendor.cjs'))

  // 必须由用户点「下载」：autoDownload 默认 true，会一发现新版本就闷头下几百 MB
  autoUpdater.autoDownload = false
  // 必须由用户点「重启安装」：默认 true 会在用户下次正常退出时**静默装掉**
  autoUpdater.autoInstallOnAppQuit = false

  // electron-updater 的 Logger 是 (message?: any) => void，会把 Error / 对象直接塞进来：
  // 统一转成字符串再交给 log()，日志里每一行都才可核对
  autoUpdater.logger = {
    info: (message?: unknown) => log('[updater:info] ' + asText(message)),
    warn: (message?: unknown) => log('[updater:warn] ' + asText(message)),
    // P6：内部监听器把同一个失败也交给这里，走 logFailure 才不会被记第二遍
    error: (message?: unknown) => logFailure('[updater:error] ', message),
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

  // P6：必须用 prependListener —— electron-updater 在构造函数里就挂了一个「转交 logger.error」的内部
  // 监听器，它比我们早注册。排到它前面，先落盘的就是这条带 statusCode / url 的记录（见文件头第 8 条）
  updater.prependListener('error', (err) => {
    // 事件里的错误只负责留痕；谁来兜底看调用方（手动检查会弹框）。这里绝不 throw
    logFailure('[updater] error: ', err)
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
    log('[updater] 未打包，跳过更新检查')
    return
  }
  void (async () => {
    try {
      const updater = await loadUpdater()
      log('[updater] 启动静默检查更新')
      const result = await checkOnce(updater)
      if (result === null || !result.isUpdateAvailable) return
      await offerDownload(updater, result.updateInfo.version)
    } catch (err) {
      logFailure('[updater] 静默检查更新失败（不影响继续使用）： ', err)
    }
  })()
}

/** 托盘「检查更新」：每个结果都给用户一个交代（检查中 / 已是最新 / 找到新版 / 下载中 / 重启安装 / 出错） */
export async function checkForUpdatesInteractive(): Promise<void> {
  if (!app.isPackaged) {
    log('[updater] 未打包，跳过更新检查')
    return
  }
  // 「检查中」：不确定进度（见文件头第 5 条，不用会卡住的模态框）
  setProgressBar(2)
  try {
    const updater = await loadUpdater()
    log('[updater] 手动检查更新')
    const result = await checkOnce(updater)

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
    logFailure('[updater] 检查更新失败： ', err)
    await showBox({
      type: 'error',
      title: '检查更新',
      message: '检查更新失败',
      detail: asText(err) + '\n\n可以稍后再试；网络不通不影响继续使用 pinfolio。',
      buttons: ['好'],
      noLink: true,
    })
  } finally {
    // N3：busy 说明这次检查在 offerDownload 里就被忽略了，进度条归正在跑的那次流程管 ——
    // 这里清空会让下载中的进度条瞬间归零（下一个 download-progress 才自愈）
    if (!busy) setProgressBar(-1)
  }
}

/** 「找到新版」：用户点「下载」才真的下载，下载完再问「重启安装」 */
async function offerDownload(updater: Updater, version: string): Promise<void> {
  // M3：下载 / 安装流程只允许跑一份，连点「检查更新」不会把同一份包下两遍
  if (busy) {
    log('[updater] 更新流程已在执行中，忽略这次请求')
    return
  }
  busy = true
  try {
    await offerDownloadInner(updater, version)
  } finally {
    busy = false
  }
}

/** 「找到新版 → 下载 / 以后」的实际流程（busy 守卫在 offerDownload 里） */
async function offerDownloadInner(updater: Updater, version: string): Promise<void> {
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
  // 新的一次下载：失败去重记录从零开始
  resetFailureLog()
  try {
    await updater.downloadUpdate()
  } catch (err) {
    logFailure('[updater] 下载失败： ', err)
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
 * 运行时探已下载的安装包路径：BaseUpdater 的 **protected getter**，类型上取不到，只能这样硬探。
 * 这里**只负责取值**、一律原样返回（可能是 undefined / null / 非字符串），判定交给
 * updater-interop.ts 的 decideInstall（纯函数、可单测）。注意别在这里把 undefined 折成 null ——
 * 「属性不存在」和「属性存在但为 undefined」必须由 `'installerPath' in updater` 分开。
 */
function readInstallerPath(updater: Updater): unknown {
  return (updater as unknown as { installerPath?: unknown }).installerPath
}

/**
 * 真正安装。顺序是**先验后关**（修复轮 I2）：
 *
 * 1. **先查 installerPath**：`quitAndInstall()` 这条链根本不会抛异常（BaseUpdater.install 里
 *    `installerPath == null` 时只是 dispatchError + return false），所以「没有下载包」这种最常见的
 *    失败只能在这里挡住 —— 一旦先把服务关了再发现装不了，用户拿到的是后端已停、页面全废、
 *    `quitRequested` 已置（关窗即真关）又退不掉的窗口。
 *    但这一层是 **fail-open** 的（decideInstall）：属性**不存在**是另一回事（上游改名），照常装，
 *    否则一次改名就把更新通道静默封死。
 * 2. 收尾：置 quitRequested + 把后端关干净（复用 main.ts 的 prepareUpdateInstall），再 quitAndInstall()：
 *    它 spawn 完安装器就在 setImmediate 里 `app.quit()`，服务提前关掉才不会跟 before-quit 的
 *    异步关服务抢时序。
 * 3. `quitAndInstall()` 正常返回**不代表**装上了：起 3 秒看门狗，**判据只有一条**——3 秒后本进程仍在
 *    （实测正常路径 0.4 秒就退了，约 7 倍余量），就交给 main.ts 的 onInstallFailed() 去 relaunch
 *    一个可用实例。别把这条判据写成「安装器没有接管」，那只是推断。
 */
async function installUpdate(updater: Updater, version: string): Promise<void> {
  // ① 先验后关（fail-open，见文件头第 7 条与 decideInstall 的注释）：
  //    只有「属性存在且为空」才拒绝；属性根本不存在（上游改名了）照常装，由 ④ 的看门狗兜底
  const hasInstallerPath = 'installerPath' in updater
  const installerPath = readInstallerPath(updater)
  if (decideInstall(hasInstallerPath, installerPath) === 'abort') {
    log('[updater] installerPath 存在但为空（' + asText(installerPath) + '），拒绝安装（不关服务，应用继续可用）')
    await showBox({
      type: 'error',
      title: '更新文件不完整',
      message: '更新文件不完整，无法安装',
      detail:
        '请再点一次「检查更新」，把安装包重新下载完整；' +
        'pinfolio 现在仍在正常运行，可以继续使用。',
      buttons: ['好'],
      noLink: true,
    })
    return
  }
  if (!hasInstallerPath) {
    // electron-updater 把这个 protected getter 改名了：探不到不等于没下载，照常装（看门狗兜底）
    log('[updater] 未探到 installerPath（electron-updater 可能改了这个字段名）→ 照常安装')
  }
  log(
    '[updater] 用户确认重启安装 version ' +
      version +
      '（安装包：' +
      (hasInstallerPath ? asText(installerPath) : '未探到 installerPath') +
      '）',
  )

  // ② 收尾：置 quitRequested、停看门狗、关后端
  try {
    await beforeInstall()
  } catch (err) {
    // 收尾失败也继续：用户已经明确点了「重启安装」，让它装
    log('[updater] 安装前收尾失败（继续安装）：', err)
  }

  // ③ 装
  try {
    updater.quitAndInstall()
    log('[updater] quitAndInstall 已调用')
  } catch (err) {
    // 真实安装链不抛；真抛了说明安装器压根没起来，服务已关，只能重启兜底
    log('[updater] quitAndInstall 抛错（安装器没起来）：', err)
    onInstallFailed()
    return
  }

  // ④ 3 秒看门狗：装上了进程应该已经退出；还在就 relaunch 一个可用实例
  setTimeout(() => {
    // N2：判据只是「quitAndInstall() 返回后本进程 3 秒还没退」，别写「安装器没有接管」（那是推断，不是实测）
    log(
      '[updater] quitAndInstall 之后 ' +
        INSTALL_WATCHDOG_MS / 1000 +
        ' 秒进程仍在（判据仅此一条：进程没退）→ 重启一个可用实例',
    )
    try {
      onInstallFailed()
    } catch (err) {
      log('[updater] 重启兜底失败：', err)
    }
  }, INSTALL_WATCHDOG_MS).unref()
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
