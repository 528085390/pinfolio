import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'
import { createRequire } from 'node:module'
import { getQuickNoteDataUrl } from './quick-note-html.js'

/**
 * 惰性加载 electron 主进程模块。
 *
 * 仓库约定：单测是纯模块、不加载 electron。顶层 `import ... from 'electron'` 会在
 * electron 二进制没装好（CI 里 504 下载失败）时把整个测试文件连带炸掉，所以改成运行时按需取：
 * 拿不到就返回 null，由调用方走 deps 注入或降级分支。
 */
const requireCjs = createRequire(import.meta.url)
let cachedElectronMain: any

function loadElectronMain(): any {
  if (cachedElectronMain !== undefined) return cachedElectronMain
  try {
    cachedElectronMain = requireCjs('electron')
  } catch {
    cachedElectronMain = null
  }
  return cachedElectronMain
}

/**
 * 随手记浮窗默认窗口配置。
 *
 * 尺寸 540x260、无边框、不可调整大小、窗口置顶、跳过任务栏、Pinfolio 经典暗底 #111315。
 */
export const DEFAULT_QUICK_NOTE_OPTIONS: BrowserWindowConstructorOptions = {
  width: 540,
  height: 260,
  frame: false,
  resizable: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  backgroundColor: '#111315',
  show: false,
  webPreferences: {
    contextIsolation: true,
    sandbox: true,
  },
}

/**
 * 生成快捷记事窗口参数。
 * 纯函数，可供单测断言几何、背景颜色与沙盒配置。
 */
export function getQuickNoteWindowOptions(
  overrides?: Partial<BrowserWindowConstructorOptions>,
): BrowserWindowConstructorOptions {
  return {
    ...DEFAULT_QUICK_NOTE_OPTIONS,
    ...overrides,
    webPreferences: {
      ...DEFAULT_QUICK_NOTE_OPTIONS.webPreferences,
      ...overrides?.webPreferences,
    },
  }
}

/**
 * 校验全局快捷键组合是否合法。
 * 必须包含修饰键（如 Ctrl / Alt / Shift / Command / CommandOrControl）与至少一个键名。
 */
export function isValidShortcut(shortcut: unknown): boolean {
  if (typeof shortcut !== 'string') return false
  const trimmed = shortcut.trim()
  if (!trimmed) return false

  const parts = trimmed.split('+').map((p) => p.trim())
  if (parts.length < 2) return false

  const validModifiers = new Set([
    'ctrl',
    'control',
    'alt',
    'shift',
    'cmd',
    'command',
    'commandorcontrol',
    'super',
    'meta',
    'option',
  ])

  const modifiers = parts.slice(0, -1)
  const key = parts[parts.length - 1]

  const hasValidModifiers = modifiers.length > 0 && modifiers.every((m) => validModifiers.has(m.toLowerCase()))
  const hasKey = key.length > 0

  return hasValidModifiers && hasKey
}

export interface ShortcutDeps {
  globalShortcut?: {
    register: (accelerator: string, callback: () => void) => boolean
  }
  log?: (msg: string) => void
}

function defaultLog(msg: string): void {
  try {
    process.stdout.write(msg + '\n')
  } catch {}
}

/**
 * 注册随手记全局快捷键。
 * 若快捷键格式非法或被系统/其它软件占用，安全捕获并记录日志，返回 false。
 */
export function registerQuickNoteShortcut(
  shortcut: string,
  onTrigger: () => void,
  deps?: ShortcutDeps,
): boolean {
  const log = deps?.log ?? defaultLog

  if (!isValidShortcut(shortcut)) {
    log(`[quick-note] 无效的全局快捷键格式: ${shortcut}`)
    return false
  }

  const gs = deps?.globalShortcut ?? loadElectronMain()?.globalShortcut
  if (!gs || typeof gs.register !== 'function') {
    log('[quick-note] 当前运行环境不提供 globalShortcut API')
    return false
  }

  try {
    const success = gs.register(shortcut, onTrigger)
    if (!success) {
      log(`[quick-note] 全局快捷键注册失败 (可能被占用): ${shortcut}`)
      return false
    }
    log(`[quick-note] 随手记全局快捷键注册成功: ${shortcut}`)
    return true
  } catch (err) {
    log(`[quick-note] 注册全局快捷键异常: ${err}`)
    return false
  }
}

export interface QuickNoteWindowDeps {
  BrowserWindow?: typeof BrowserWindow
  log?: (msg: string) => void
}

/**
 * 创建随手记浮动窗口。
 * 拦截关闭行为为 hide，失焦时自动隐藏。
 */
export function createQuickNoteWindow(
  targetUrl: string,
  onHide?: () => void,
  deps?: QuickNoteWindowDeps,
): BrowserWindow {
  const log = deps?.log ?? defaultLog
  const BW = deps?.BrowserWindow ?? loadElectronMain()?.BrowserWindow

  if (!BW) {
    throw new Error('[quick-note] 当前环境缺少 BrowserWindow 构造器')
  }

  const options = getQuickNoteWindowOptions()
  const win = new BW(options)

  const baseUrl = targetUrl.endsWith('/') ? targetUrl : targetUrl + '/'
  win.loadURL(getQuickNoteDataUrl(targetUrl), {
    baseURLForDataURL: baseUrl,
  }).catch((err: unknown) => {
    log(`[quick-note] 加载随手记页面失败: ${err}`)
  })

  // 关窗拦截为隐藏
  win.on('close', (event: any) => {
    event.preventDefault()
    win.hide()
    onHide?.()
  })

  // 失焦隐藏
  win.on('blur', () => {
    if (!win.isDestroyed() && win.isVisible()) {
      win.hide()
      onHide?.()
    }
  })

  return win
}
