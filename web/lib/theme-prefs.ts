// 主题 / 风格 / 折射三个偏好的读取与首帧落地。
//
// 为什么单独成文件：useShell（运行时切换）与 main.tsx（首帧之前）读的是同一批键、
// 同一套缺省值。键名与缺省值只在这里写一次，免得两处各写一份、改动时漏掉一处。
// 除了两个直接写 <html> 的函数（首帧 applyBootPrefs、运行时 applyPref），全是纯函数，不依赖 React。

export const THEME_KEY = 'pinboard-theme'
export const STYLE_KEY = 'pinboard-style'
export const REFRACT_KEY = 'pinboard-glass-refract'

/** 风格维度（与 <html data-style> 同值）：暖纸 / 玻璃 */
export type StylePref = 'paper' | 'glass'
/** 折射开关（与 <html data-glass-refract> 同值）：真折射只在 Chromium 上真能画出来 */
export type RefractPref = 'on' | 'off'

export const DEFAULT_STYLE: StylePref = 'glass'
export const DEFAULT_REFRACT: RefractPref = 'on'

/** <html> 上的三个偏好属性（dataset 里的名字） */
export type PrefAttr = 'theme' | 'style' | 'glassRefract'

// localStorage 在隐私模式 / 被策略禁用时会抛，一律当作「没存过」，走缺省值
function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** 主题偏好：'light' | 'dark' | 'system'（缺省跟随系统，与改动前一致） */
export function readStoredTheme(): string {
  return readPref(THEME_KEY) || 'system'
}

/** 只认显式的 'paper'，其余（空 / 脏值 / 清过 localStorage）一律按缺省玻璃 */
export function readStoredStyle(): StylePref {
  return readPref(STYLE_KEY) === 'paper' ? 'paper' : DEFAULT_STYLE
}

/** 只认显式的 'off'，其余一律按缺省开启 */
export function readStoredRefract(): RefractPref {
  return readPref(REFRACT_KEY) === 'off' ? 'off' : DEFAULT_REFRACT
}

/**
 * 运行时切换：把某一维偏好写到 <html>，并在支持 View Transition 的浏览器上
 * 用 rvT 包住那次写入（切换是 600ms 柔光交叉，见 spec §4.6）。
 *
 * 两条纪律：
 * 1. 只包 DOM 写入，不包 setState —— 把 setState 塞进回调会把 React 渲染也拖进过渡里；
 * 2. 值没变就直接返回，免得挂载时（首帧已由 applyBootPrefs 写好）白跑一次过渡。
 */
export function applyPref(attr: PrefAttr, value: string): void {
  const root = document.documentElement
  if (root.dataset[attr] === value) return
  const write = () => {
    root.dataset[attr] = value
  }
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  const reduced =
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced || typeof doc.startViewTransition !== 'function') {
    write()
    return
  }
  doc.startViewTransition(write)
}

/**
 * 首帧之前把 data-theme / data-style / data-glass-refract 打到 <html>。
 * 不这么做的话，刷新会先按纸色画一帧再跳到玻璃/暗色（白闪）。
 * 在 createRoot 之前调用，见 web/main.tsx。
 */
export function applyBootPrefs(doc: Document): void {
  const theme = readStoredTheme()
  const dark =
    theme === 'dark' ||
    (theme === 'system' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches)
  doc.documentElement.dataset.theme = dark ? 'dark' : 'light'
  // paper 也显式写上：CSS 靠 [data-style='glass'] 前缀区分，但显式值便于调试和断言
  doc.documentElement.dataset.style = readStoredStyle()
  doc.documentElement.dataset.glassRefract = readStoredRefract()
}
