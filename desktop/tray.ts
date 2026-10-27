import { app, Menu, Tray, nativeImage, shell } from 'electron'
import type { BrowserWindow, MenuItemConstructorOptions, NativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { log } from './log.js'

/**
 * 系统托盘（Task 7）：关窗不再退出，窗口藏到托盘，托盘菜单负责「回来 / 开机自启 / 检查更新 /
 * 打开数据目录 / 真退出」。
 *
 * 两条踩过的线：
 * 1. **图标可以不存在**：ICO 是 Task 9（`tools/desktop/make-ico.mjs`）的产物，现在两个候选路径
 *    都是缺的，所以这里必须优雅降级 —— 内置一张 16×16 的 base64 PNG 兜底，绝不因为缺图标
 *    抛异常或者让应用起不来。
 * 2. **托盘对象必须被主进程持住**（返回值交给 main.ts 的模块级变量），否则会被 GC 掉，
 *    图标过一会儿自己消失。
 *
 * 退出语义不在本文件：`onQuit` 由 main.ts 提供（置 `quitRequested` 后 `app.quit()`），
 * 托盘只负责「用户点了退出」这一个事实。
 */

/**
 * 兜底图标：16×16 的圆点（#d97757）+ 两道白线，运行时生成的固定 base64。
 * 不依赖任何构建产物，缺 ICO 时托盘至少是个能点的可见图标。
 */
const FALLBACK_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAPklEQVR42mNgoAW4WR7+HxumSDNRhhDSjNcQYjVjNYRUzRiGoEvgAkQbQLELhqAXKI5GqiQkqiRlqmQmUgEA6YmtQOrQe5oAAAAASUVORK5CYII='

export type TrayOptions = {
  /** 用户点了「退出」：main.ts 里置退出标志 + app.quit() */
  onQuit: () => void
  /**
   * 用户点了「检查更新」：main.ts 接到 desktop/updater.ts 的 checkForUpdatesInteractive()。
   * 托盘只负责「用户点了一下」这个事实，检查 / 弹框 / 安装全在 updater.ts 里
   */
  onCheckUpdate: () => void
  /** 「打开数据目录」要打开的绝对路径（main.ts 传 desktopPaths().dataDir） */
  dataDir: string
}

/** 当前是否已登记开机自启（拿不到状态时按 false 处理，别让托盘建不起来） */
export function isAutoStartEnabled(): boolean {
  try {
    return app.getLoginItemSettings().openAtLogin === true
  } catch (err) {
    log('[tray] 读开机自启状态失败', err)
    return false
  }
}

/**
 * 写开机自启开关，返回**写完之后的真实状态**（不是我们想设的值）。
 * menu 的 checkbox 和自证都看返回值：写入失败时用户能看到勾选状态弹回去。
 *
 * 打包态差别（实测，别照抄旧说法）：开发态（electron .）登记的是 node_modules 里那个
 * electron.exe，**launchItems[0].args = []** —— 没带任何应用路径，真开机起的是 Electron 空壳
 * 而不是 pinfolio（Task 7 报告「开机自启」一节的实测）。所以开发态只能以
 * getLoginItemSettings() 自证；装好的 pinfolio.exe（Task 9）登记的才是指向安装目录真实 exe 的项
 * （值名也会从 electron.app.Electron 变成 pinfolio），**打包后必须复测**这一条。
 */
export function setAutoStart(enabled: boolean): boolean {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled })
  } catch (err) {
    log('[tray] 写开机自启失败：' + enabled, err)
  }
  const actual = isAutoStartEnabled()
  log('[tray] 开机自启 set=' + enabled + ' actual=' + actual)
  return actual
}

/** 图标：先打包态 resources、再开发态 desktop/assets，都没有就用内置兜底 */
function resolveIcon(): { image: NativeImage; from: string } {
  const candidates = [
    join(process.resourcesPath, 'icon.ico'),
    join(app.getAppPath(), 'desktop', 'assets', 'icon.ico'),
  ]
  for (const file of candidates) {
    try {
      if (!existsSync(file)) continue
      const image = nativeImage.createFromPath(file)
      if (image.isEmpty()) {
        log('[tray] 图标文件存在但读不出像素，跳过：' + file)
        continue
      }
      return { image, from: file }
    } catch (err) {
      log('[tray] 读图标失败：' + file, err)
    }
  }
  // Task 9 之前两个候选都不存在，走到这里是**正常路径**，不是错误
  log('[tray] icon missing, tray created without icon')
  return { image: nativeImage.createFromDataURL(FALLBACK_ICON), from: '内置兜底 PNG' }
}

/** 显示 / 隐藏主窗口（托盘左键与菜单第一项共用） */
function toggleWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (win.isVisible()) {
    win.hide()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** 打开数据目录；openPath 用返回的空串表示成功，非空就是错误说明 */
async function openDataDir(dir: string): Promise<void> {
  try {
    const err = await shell.openPath(dir)
    if (err === '') log('[tray] 已打开数据目录：' + dir)
    else log('[tray] 打开数据目录失败：' + dir + ' -> ' + err)
  } catch (e) {
    log('[tray] 打开数据目录抛错：' + dir, e)
  }
}

/** 把菜单建出来（窗口显示状态与自启状态都会变，所以每次状态变化重建一次） */
function buildMenu(win: BrowserWindow, opts: TrayOptions, refresh: () => void): Menu {
  const visible = !win.isDestroyed() && win.isVisible()

  const template: MenuItemConstructorOptions[] = [
    {
      label: visible ? '隐藏主窗口' : '显示主窗口',
      click: () => toggleWindow(win),
    },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: isAutoStartEnabled(),
      click: (item) => {
        // item.checked 是点击后的新状态（Electron 已经替我们翻了）
        setAutoStart(item.checked)
        refresh() // 写入失败时把勾选状态刷回真实值
      },
    },
    {
      label: '检查更新',
      click: () => {
        try {
          opts.onCheckUpdate()
        } catch (err) {
          // 更新链路的任何失败都不许把主进程带崩（回调内部的 Promise 由 updater.ts 自己接）
          log('[tray] 检查更新回调抛错', err)
        }
      },
    },
    {
      label: '打开数据目录',
      click: () => {
        void openDataDir(opts.dataDir)
      },
    },
    { type: 'separator' },
    {
      label: '退出 pinfolio',
      click: () => {
        log('[tray] 用户点了「退出」')
        opts.onQuit()
      },
    },
  ]

  return Menu.buildFromTemplate(template)
}

/**
 * 建托盘并把菜单接上。**可能抛异常**（极端情况下 Tray 构造失败），
 * 所以 main.ts 那边用 try/catch 兜住：托盘建不起来时退化成「关窗即退出」，不留下点不回来的窗口。
 */
export function createTray(win: BrowserWindow, opts: TrayOptions): Tray {
  const { image, from } = resolveIcon()
  const tray = new Tray(image)
  tray.setToolTip('pinfolio')

  const refresh = (): void => {
    tray.setContextMenu(buildMenu(win, opts, refresh))
  }
  refresh()

  // 左键点图标 = 显示/隐藏（Windows 上双击/右键走菜单）
  tray.on('click', () => toggleWindow(win))
  // 窗口显示状态变了，菜单第一项的文字要跟着变
  win.on('show', refresh)
  win.on('hide', refresh)

  log('[tray] 托盘已创建（图标：' + from + '）')
  return tray
}
