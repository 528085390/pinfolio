// 主题 / 风格 / 折射 / 壁纸四个偏好的读取与首帧落地。
//
// 为什么单独成文件：useShell（运行时切换）与 main.tsx（首帧之前）读的是同一批键、
// 同一套缺省值。键名与缺省值只在这里写一次，免得两处各写一份、改动时漏掉一处。
// 除了两个直接写 <html> 的函数（首帧 applyBootPrefs、运行时 applyPref），全是纯函数，不依赖 React。

export const THEME_KEY = 'pinboard-theme'
export const STYLE_KEY = 'pinboard-style'
export const REFRACT_KEY = 'pinboard-glass-refract'
export const WALLPAPER_KEY = 'pinboard-wallpaper'

/** 明暗偏好（localStorage 里存的值）：亮 / 暗 / 跟随系统 */
export type ThemePref = 'light' | 'dark' | 'system'
/** 风格维度（与 <html data-style> 同值）：暖纸 / 玻璃 */
export type StylePref = 'paper' | 'glass'
/** 折射开关（与 <html data-glass-refract> 同值）：真折射只在 Chromium 上真能画出来 */
export type RefractPref = 'on' | 'off'
/** 壁纸开关（与 <html data-wallpaper> 同值）：只在玻璃风格下命中，暖纸下不生效 */
export type WallpaperPref = 'on' | 'off'

export const DEFAULT_STYLE: StylePref = 'glass'
/**
 * 默认 'off'：折射（backdrop-filter: url(#pb-glass-refract)）在 Chrome 156 上画不对 ——
 * 位移贴图的 feImage 结果喂不进 feDisplacementMap（R=B=0），整块背景会被恒定平移 ~12.5px
 * 而不是做透镜压缩，面板边缘可见接缝。代码与开关都留着，等 Chromium 修好或 Electron 实测
 * 确认后把这里改回 'on' 即可一键启用（spec §3.6 有完整证据）。
 */
export const DEFAULT_REFRACT: RefractPref = 'off'

/**
 * 缺省壁纸（相对地址，运行时按 document.baseURI 解析，挂子路径也对）。
 * 仓库不带这张图——用户自备的壁纸有版权，公开仓库收不了；把文件放到
 * web/public/wallpapers/street.jpg 即可（该目录在 .gitignore 里）。文件缺失时
 * background-image 拉不到，body 退回 --paper 实底，不出现破图。
 */
export const DEFAULT_WALLPAPER = 'wallpapers/street.jpg'

/** 演示站可覆盖的三个维度（漏掉的那项就走上面的 DEFAULT_*） */
export interface DemoBootPrefs {
  style?: StylePref
  refract?: RefractPref
  wallpaper?: string
}

/**
 * 演示站（`PINBOARD_DEMO=1`）的缺省外观：`server/static.ts` 渲染 index.html 时把
 * `window.__PINBOARD_DEMO_PREFS__` 注入进去（值来自 `server/demo.ts` 的 `demoBootPrefs()`）。
 *
 * 为什么不构建期写死：同一份构建既服务自用实例也服务公开演示站，而两者缺省外观故意不同——
 * 自用实例折射默认关（Chrome 156 画不准，见上），演示站要开箱就是折射玻璃。普通实例注入
 * `null`，这里读不到就完全按常量走，行为与改动前一致。**存过的偏好永远优先**：访客在
 * 设置页改过，就以他的为准。
 */
export function demoOverride(): DemoBootPrefs {
  let injected: unknown
  try {
    injected = (globalThis as { __PINBOARD_DEMO_PREFS__?: unknown }).__PINBOARD_DEMO_PREFS__
  } catch {
    return {}
  }
  if (!injected || typeof injected !== 'object') return {}
  const o = injected as Record<string, unknown>
  const out: DemoBootPrefs = {}
  if (o.style === 'paper' || o.style === 'glass') out.style = o.style
  if (o.refract === 'on' || o.refract === 'off') out.refract = o.refract
  if (typeof o.wallpaper === 'string') out.wallpaper = o.wallpaper
  return out
}

/**
 * <html> 上三个偏好属性的「attr → 合法取值」表。
 * 写成映射类型而不是 (attr: string, value: string)：脏值（'neon' / 'yes' / 'darkish'）
 * 编译期就过不去，不用等到样式静默不生效才发现。
 */
export interface PrefValues {
  theme: 'light' | 'dark'
  style: StylePref
  glassRefract: RefractPref
  wallpaper: WallpaperPref
}
export type PrefAttr = keyof PrefValues

/** 只用到 getItem 的最小 Storage 形状：真 localStorage 与测试桩都满足 */
export interface PrefStorage {
  getItem(key: string): string | null
}

// 隐私模式 / 被策略禁用时，连访问 localStorage 本身都会抛，一律当作「没存过」，走缺省值
function defaultStorage(): PrefStorage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function readPref(storage: PrefStorage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

/** 明暗偏好：只认 light / dark，其余（没存过 / 脏值）一律跟随系统，与改动前一致 */
export function readStoredTheme(storage: PrefStorage | null = defaultStorage()): ThemePref {
  const v = readPref(storage, THEME_KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

/** 风格：只认 'paper' / 'glass'，其余（没存过 / 脏值 / 清过 localStorage）走缺省值 */
export function readStoredStyle(storage: PrefStorage | null = defaultStorage()): StylePref {
  const v = readPref(storage, STYLE_KEY)
  if (v === 'paper' || v === 'glass') return v
  return demoOverride().style ?? DEFAULT_STYLE
}

/**
 * 折射：只认 'on' / 'off'，其余走缺省值。
 * **这里曾经写反**（只认 'off'、其余一律回 DEFAULT_REFRACT）：缺省是 'off' 时，存进去的
 * 'on' 会被读回 'off' —— 设置页刚打开的折射，刷新一下自己灭了。别改回那个形状。
 */
export function readStoredRefract(storage: PrefStorage | null = defaultStorage()): RefractPref {
  const v = readPref(storage, REFRACT_KEY)
  if (v === 'on' || v === 'off') return v
  return demoOverride().refract ?? DEFAULT_REFRACT
}

/**
 * 壁纸地址：**没存过**走缺省壁纸（开箱就有东西可透，玻璃才看得出来）；
 * 存过空串 = 用户主动关掉，返回 ''。其余原样返回（相对路径 / 绝对路径 / http(s) 链接都行）。
 */
export function readStoredWallpaper(storage: PrefStorage | null = defaultStorage()): string {
  const v = readPref(storage, WALLPAPER_KEY)
  if (v === null) return demoOverride().wallpaper ?? DEFAULT_WALLPAPER
  return v.trim()
}

/**
 * 壁纸地址 → CSS background-image 的值（`url("…")`）；空地址返回 ''（= 关掉壁纸）。
 * 相对地址一律按 base 解析：反代挂 /pinfolio/ 时 baseURI 就是 /pinfolio/x，解析结果自然跟着走。
 * 已经带协议 / 以 // 或 / 开头的一律原样返回，避免把用户的绝对地址又拼坏一次。
 */
export function wallpaperCss(raw: string, base?: string): string {
  const v = raw.trim()
  if (!v) return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('//') || v.startsWith('/')) return `url("${v}")`
  if (!base) return `url("${v}")`
  try {
    return `url("${new URL(v, base).href}")`
  } catch {
    return ''
  }
}

/** 把壁纸地址写到 <html> 的 --wallpaper-url（空地址 = 移除变量，CSS 回落到暖纸底）。 */
export function applyWallpaperVar(doc: BootDocument, raw: string): void {
  const style = doc.documentElement.style
  if (!style) return
  const value = wallpaperCss(raw, doc.baseURI)
  if (value) style.setProperty('--wallpaper-url', value)
  else style.removeProperty('--wallpaper-url')
}

/**
 * 「明暗偏好 + 系统当前是否深色」→ 真正写进 data-theme 的值。
 * useShell（在 matchMedia 变化时重算）与 applyBootPrefs（首帧）各写过一遍同样的表达式，
 * 抽到这里只写一次，免得一边改了另一边忘。
 */
export function resolveTheme(theme: ThemePref, matchesDark: boolean): 'light' | 'dark' {
  return theme === 'dark' || (theme === 'system' && matchesDark) ? 'dark' : 'light'
}

/**
 * 每个 attr 最近一次「已排期」的值，仅作短路判据用 —— 故意不读 DOM：
 * startViewTransition 的写入回调要等旧快照捕获（≈下一帧）才跑，那一帧里 DOM 还是旧值。
 * 若拿 DOM 比较，快速连切（键盘按住 Enter / Space 连发）时第二次会被误判成「值没变」
 * 直接 return，于是挂起的回调把上一次的值写下去 —— state 与 localStorage 是新值、
 * <html> 是旧值，得等下次切换才自愈。用排期表就没有这个时间窗。
 */
const scheduled: Partial<Record<PrefAttr, string>> = {}

/**
 * 运行时切换：把某一维偏好写到 <html>，并在支持 View Transition 的浏览器上
 * 用 rvT 包住那次写入（切换是 600ms 柔光交叉，见 spec §4.6）。
 *
 * 两条纪律：
 * 1. 只包 DOM 写入，不包 setState —— 把 setState 塞进回调会把 React 渲染也拖进过渡里；
 * 2. 与排期表里最近一次的值相同就返回，免得挂载时（首帧已由 applyBootPrefs 写好）白跑一次过渡。
 */
export function applyPref<K extends PrefAttr>(attr: K, value: PrefValues[K]): void {
  if (scheduled[attr] === value) return
  scheduled[attr] = value
  // 回调写排期表里的最新值（而不是闭包里的 value）：连切两次时，先挂起的那次
  // 可能晚于第二次切换才跑，绝不能让它把自己的旧值写下去
  const write = () => {
    const latest = scheduled[attr]
    if (latest !== undefined) document.documentElement.dataset[attr] = latest
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
 * applyBootPrefs 需要的全部外部依赖：document / localStorage / matchMedia 都从这一个
 * 对象取。只注入一半（传 doc 却读全局 localStorage / matchMedia）的话，这条首帧路径
 * 在 Node 里根本测不了 —— 与不注入没区别。
 */
export interface BootDocument {
  /** 相对壁纸地址的基准；浏览器里就是 document.baseURI */
  baseURI?: string
  documentElement: {
    dataset: DOMStringMap
    /** 写 --wallpaper-url 用；测试桩可以不给（不给就只写 dataset） */
    style?: {
      setProperty(name: string, value: string): void
      removeProperty(name: string): void
    }
  }
}

export interface BootWindow {
  document: BootDocument
  localStorage?: PrefStorage
  matchMedia?: (query: string) => { matches: boolean }
}

/**
 * 首帧之前把 data-theme / data-style / data-glass-refract / data-wallpaper 打到 <html>。
 * 不这么做的话，刷新会先按纸色画一帧再跳到玻璃/暗色（白闪）。
 * 在 createRoot 之前调用，见 web/main.tsx。
 */
export function applyBootPrefs(win: BootWindow): void {
  let storage: PrefStorage | null = null
  try {
    storage = win.localStorage ?? null
  } catch {
    // 隐私模式下连访问都会抛：当作没存过，走缺省值
    storage = null
  }
  const matchesDark = win.matchMedia?.('(prefers-color-scheme: dark)')?.matches === true
  const root = win.document.documentElement
  root.dataset.theme = resolveTheme(readStoredTheme(storage), matchesDark)
  // paper 也显式写上：CSS 靠 [data-style='glass'] 前缀区分，但显式值便于调试和断言
  root.dataset.style = readStoredStyle(storage)
  root.dataset.glassRefract = readStoredRefract(storage)
  // 壁纸：data-wallpaper 给 CSS 判断用，图片地址走 CSS 变量（CSS 里 background-image: var(--wallpaper-url)）
  const wallpaper = readStoredWallpaper(storage)
  root.dataset.wallpaper = wallpaper ? 'on' : 'off'
  applyWallpaperVar(win.document, wallpaper)
  // 首帧写下的也是一次「已应用」：挂载时四条 effect 读到同样的值，不该再白跑一次过渡
  scheduled.theme = root.dataset.theme
  scheduled.style = root.dataset.style
  scheduled.glassRefract = root.dataset.glassRefract
  scheduled.wallpaper = root.dataset.wallpaper
}
