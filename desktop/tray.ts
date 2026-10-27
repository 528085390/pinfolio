import { app, Menu, Tray, nativeImage, shell } from 'electron'
import type { BrowserWindow, MenuItemConstructorOptions, NativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { log } from './log.js'

/**
 * 系统托盘：关窗不再退出，窗口藏到托盘，托盘菜单负责「显示/隐藏 / 刷新 / 开机自启 / 检查更新 / 浏览器打开 / 退出」。
 */

const FALLBACK_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAPklEQVR42mNgoAW4WR7+HxumSDNRhhDSjNcQYjVjNYRUzRiGoEvgAkQbQLELhqAXKI5GqiQkqiRlqmQmUgEA6YmtQOrQe5oAAAAASUVORK5CYII='

export type TrayOptions = {
  /** 用户点了「退出」：main.ts 里置退出标志 + app.quit() */
  onQuit: () => void
  /** 用户点了「检查更新」：调用 updater 的检查逻辑 */
  onCheckUpdate: () => void
  /** 目标网页端地址（如 http://127.0.0.1:7788），用于在浏览器中打开 */
  webUrl?: string
  /** 兼容历史传参：数据目录 */
  dataDir?: string
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

/** 写开机自启开关，返回写完之后的真实状态 */
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

/** 把菜单建出来 */
function buildMenu(win: BrowserWindow, opts: TrayOptions, refresh: () => void): Menu {
  const visible = !win.isDestroyed() && win.isVisible()

  const template: MenuItemConstructorOptions[] = [
    {
      label: visible ? '隐藏主窗口' : '显示主窗口',
      click: () => toggleWindow(win),
    },
    {
      label: '刷新页面',
      click: () => {
        if (!win.isDestroyed()) win.webContents.reload()
      },
    },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: isAutoStartEnabled(),
      click: (item) => {
        setAutoStart(item.checked)
        refresh()
      },
    },
    {
      label: '检查更新',
      click: () => {
        try {
          opts.onCheckUpdate()
        } catch (err) {
          log('[tray] 检查更新回调抛错', err)
        }
      },
    },
    ...(opts.webUrl ? [{
      label: '在浏览器中打开网页端',
      click: () => {
        void shell.openExternal(opts.webUrl!)
      },
    }] : []),
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

/** 建托盘并把菜单接上 */
export function createTray(win: BrowserWindow, opts: TrayOptions): Tray {
  const { image, from } = resolveIcon()
  const tray = new Tray(image)
  tray.setToolTip('pinfolio')

  const refresh = (): void => {
    tray.setContextMenu(buildMenu(win, opts, refresh))
  }
  refresh()

  // 左键点图标 = 显示/隐藏
  tray.on('click', () => toggleWindow(win))
  win.on('show', refresh)
  win.on('hide', refresh)

  log('[tray] 托盘已创建（图标：' + from + '）')
  return tray
}
