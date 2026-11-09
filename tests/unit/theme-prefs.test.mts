import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_REFRACT,
  DEFAULT_STYLE,
  DEFAULT_WALLPAPER,
  REFRACT_KEY,
  STYLE_KEY,
  THEME_KEY,
  WALLPAPER_KEY,
  applyBootPrefs,
  applyPref,
  applyWallpaperVar,
  readStoredRefract,
  readStoredStyle,
  readStoredTheme,
  readStoredWallpaper,
  resolveTheme,
  wallpaperCss,
} from '../../web/lib/theme-prefs.js'

// theme-prefs 的常驻单测：缺省值、脏值回落、localStorage 不可用、首帧三属性、
// 运行时写入的 rvT / 无 rvT / reduced-motion 三条路径，以及「快速连切丢写」那条回归。
// 不需要真浏览器：document / localStorage / matchMedia 全部用小桩。

/* ---------- 桩 ---------- */

/** 只实现被测代码真正用到的那一个方法（getItem） */
function store(init: Record<string, string> = {}) {
  const map = new Map(Object.entries(init))
  return {
    map,
    getItem: (k: string): string | null => (map.has(k) ? (map.get(k) as string) : null),
  }
}

/** 隐私模式：连读都抛 */
function throwingStore() {
  return {
    getItem(): string | null {
      throw new Error('SecurityError: localStorage 被禁用')
    },
  }
}

interface StubDoc {
  documentElement: { dataset: Record<string, string> }
  startViewTransition?: (cb: () => void) => unknown
}

interface Dom {
  root: { dataset: Record<string, string> }
  doc: StubDoc
  /** 装上 startViewTransition（回调用调用者给的行为，比如排队到后面再跑） */
  setRvT(fn: (cb: () => void) => unknown): void
  dropRvT(): void
  setReduced(v: boolean): void
  restore(): void
}

/** 把全局 document / window 换成桩，返回操作手柄 */
function installDom(): Dom {
  const g = globalThis as any
  const root = { dataset: {} as Record<string, string> }
  const doc: StubDoc = { documentElement: root }
  const prevDoc = g.document
  const prevWin = g.window
  g.document = doc
  g.window = { matchMedia: (q: string) => ({ matches: false, media: q }) }
  return {
    root,
    doc,
    setRvT(fn) {
      doc.startViewTransition = fn
    },
    dropRvT() {
      delete doc.startViewTransition
    },
    setReduced(v) {
      g.window = { matchMedia: (q: string) => ({ matches: v && q.includes('reduced-motion'), media: q }) }
    },
    restore() {
      g.document = prevDoc
      g.window = prevWin
    },
  }
}

/* ---------- 三个 reader ---------- */

test('readers：没存过时是 system / glass / off', () => {
  assert.equal(readStoredTheme(store()), 'system')
  assert.equal(readStoredStyle(store()), DEFAULT_STYLE)
  assert.equal(readStoredStyle(store()), 'glass')
  assert.equal(readStoredRefract(store()), DEFAULT_REFRACT)
  // 折射默认关：Chrome 156 的 backdrop-filter 读不到位移贴图（spec §3.6）
  assert.equal(readStoredRefract(store()), 'off')
})

test('readers：显式值原样读回', () => {
  const s = store({ [THEME_KEY]: 'dark', [STYLE_KEY]: 'paper', [REFRACT_KEY]: 'off' })
  assert.equal(readStoredTheme(s), 'dark')
  assert.equal(readStoredStyle(s), 'paper')
  assert.equal(readStoredRefract(s), 'off')
  assert.equal(readStoredTheme(store({ [THEME_KEY]: 'light' })), 'light')
})

test('readers：脏值一律回落缺省', () => {
  const s = store({ [THEME_KEY]: 'neon', [STYLE_KEY]: 'glass2', [REFRACT_KEY]: 'yes' })
  assert.equal(readStoredTheme(s), 'system')
  assert.equal(readStoredStyle(s), 'glass')
  assert.equal(readStoredRefract(s), 'off')
})

test('readers：localStorage 抛异常时当「没存过」', () => {
  const bad = throwingStore()
  assert.equal(readStoredTheme(bad), 'system')
  assert.equal(readStoredStyle(bad), 'glass')
  assert.equal(readStoredRefract(bad), 'off')
})

test('readers：不传参时读全局 localStorage，Node 里没有也不炸', () => {
  const g = globalThis as any
  const had = 'localStorage' in g
  const prev = g.localStorage
  delete g.localStorage
  try {
    assert.equal(readStoredTheme(), 'system')
    assert.equal(readStoredStyle(), 'glass')
    assert.equal(readStoredRefract(), 'off')
  } finally {
    if (had) g.localStorage = prev
  }
})

/* ---------- resolveTheme ---------- */

test('resolveTheme：明暗偏好 × 系统深色 的四种组合', () => {
  assert.equal(resolveTheme('light', false), 'light')
  assert.equal(resolveTheme('light', true), 'light')
  assert.equal(resolveTheme('dark', false), 'dark')
  assert.equal(resolveTheme('system', false), 'light')
  assert.equal(resolveTheme('system', true), 'dark')
})

/* ---------- applyBootPrefs ---------- */

/** 首帧用的 window 桩：document / localStorage / matchMedia 全在这一个对象上 */
function bootWin(opts: { data?: Record<string, string>; dark?: boolean; noStorage?: boolean } = {}) {
  const ds: Record<string, string> = {}
  const win: any = {
    document: { documentElement: { dataset: ds } },
    matchMedia: (q: string) => ({ matches: opts.dark === true && q.includes('dark'), media: q }),
  }
  if (!opts.noStorage) win.localStorage = store(opts.data)
  return { ds, win }
}

test('applyBootPrefs：四个属性都写下去，paper 也显式写', () => {
  const { ds, win } = bootWin({ data: { [THEME_KEY]: 'dark', [STYLE_KEY]: 'paper', [REFRACT_KEY]: 'off' } })
  applyBootPrefs(win)
  // 壁纸没存过 → 走缺省壁纸（on）：开箱就有东西可透，玻璃才看得出来
  assert.deepEqual({ ...ds }, { theme: 'dark', style: 'paper', glassRefract: 'off', wallpaper: 'on' })
})

test('applyBootPrefs：空存储 = light / glass / off / 缺省壁纸，且跟随系统深色', () => {
  const a = bootWin()
  applyBootPrefs(a.win)
  assert.deepEqual({ ...a.ds }, { theme: 'light', style: 'glass', glassRefract: 'off', wallpaper: 'on' })
  const b = bootWin({ dark: true })
  applyBootPrefs(b.win)
  assert.equal(b.ds.theme, 'dark', 'theme=system + 系统深色 → dark')
})

test('applyBootPrefs：没有 localStorage / matchMedia 也不炸，走缺省', () => {
  const { ds, win } = bootWin({ noStorage: true })
  delete win.matchMedia
  applyBootPrefs(win)
  assert.deepEqual({ ...ds }, { theme: 'light', style: 'glass', glassRefract: 'off', wallpaper: 'on' })
})

/* ---------- applyPref ---------- */

// 排期表是模块级状态（就是 Minor 1 修的东西），用例之间会互相看见。
// 所以每次「归位」都连写两次：先写另一个值、再写目标值 ——
// 不论进来时排期表里是什么，两步之后 DOM 与排期表都一定等于目标值。
function arrange(d: Dom, attr: 'theme' | 'style' | 'glassRefract', value: string, other: string) {
  d.dropRvT()
  if (attr === 'theme') {
    applyPref('theme', other as 'light' | 'dark')
    applyPref('theme', value as 'light' | 'dark')
  } else if (attr === 'style') {
    applyPref('style', other as 'paper' | 'glass')
    applyPref('style', value as 'paper' | 'glass')
  } else {
    applyPref('glassRefract', other as 'on' | 'off')
    applyPref('glassRefract', value as 'on' | 'off')
  }
}

test('applyPref：没有 startViewTransition 时同步瞬写', () => {
  const d = installDom()
  try {
    arrange(d, 'style', 'paper', 'glass')
    assert.equal(d.root.dataset.style, 'paper')
  } finally {
    d.restore()
  }
})

test('applyPref：有 startViewTransition 时包住写入', () => {
  const d = installDom()
  try {
    arrange(d, 'style', 'paper', 'glass')
    let calls = 0
    d.setRvT((cb) => {
      calls++
      cb()
      return {}
    })
    applyPref('style', 'glass')
    assert.equal(calls, 1, 'style 切换应走一次 startViewTransition')
    assert.equal(d.root.dataset.style, 'glass')
  } finally {
    d.restore()
  }
})

test('applyPref：prefers-reduced-motion 下瞬切不包过渡', () => {
  const d = installDom()
  try {
    arrange(d, 'theme', 'light', 'dark')
    let calls = 0
    d.setRvT((cb) => {
      calls++
      cb()
      return {}
    })
    d.setReduced(true)
    applyPref('theme', 'dark')
    assert.equal(calls, 0, 'reduced-motion 不应触发过渡')
    assert.equal(d.root.dataset.theme, 'dark')
  } finally {
    d.restore()
  }
})

test('applyPref：值未变不重复过渡', () => {
  const d = installDom()
  try {
    arrange(d, 'style', 'glass', 'paper')
    let calls = 0
    d.setRvT((cb) => {
      calls++
      cb()
      return {}
    })
    applyPref('style', 'glass')
    assert.equal(calls, 0)
    assert.equal(d.root.dataset.style, 'glass')
  } finally {
    d.restore()
  }
})

// Minor 1 回归：rvT 的写入回调要等旧快照捕获（≈下一帧）才跑，这一帧内 DOM 还是旧值。
// 旧实现拿 DOM 做短路判据 → 第二次切换被误判成「值没变」直接 return，
// 挂起的回调反而把上一次的值写下去（state 新、<html> 旧）。
test('applyPref：连续切换不丢写，最终 dataset 等于最后一次入参', () => {
  const d = installDom()
  try {
    arrange(d, 'glassRefract', 'off', 'on')
    const queued: Array<() => void> = []
    d.setRvT((cb) => {
      queued.push(cb)
      return {}
    })
    // 连续两次切换：回调都还没跑，DOM 里仍是 'off'
    applyPref('glassRefract', 'on')
    applyPref('glassRefract', 'off')
    assert.equal(queued.length, 2, '两次切换都必须排期（被短路掉正是丢写的入口）')
    // 先跑挂起的那一次：它也不能把上一次的值（on）写下去
    queued[0]()
    assert.equal(d.root.dataset.glassRefract, 'off', '挂起的回调必须写最新排期值')
    queued[1]()
    assert.equal(d.root.dataset.glassRefract, 'off', '最终 dataset 应与最后一次入参一致')
  } finally {
    d.restore()
  }
})

test('applyPref：连切三次（on/off/on）最终落在最后一次入参', () => {
  const d = installDom()
  try {
    arrange(d, 'glassRefract', 'off', 'on')
    const queued: Array<() => void> = []
    d.setRvT((cb) => {
      queued.push(cb)
      return {}
    })
    applyPref('glassRefract', 'on')
    applyPref('glassRefract', 'off')
    applyPref('glassRefract', 'on')
    assert.equal(queued.length, 3)
    for (const cb of queued) cb()
    assert.equal(d.root.dataset.glassRefract, 'on')
  } finally {
    d.restore()
  }
})

/* ---------- 壁纸（背景图） ---------- */

test('readStoredWallpaper：没存过走缺省壁纸，存过空串 = 关，其余原样', () => {
  assert.equal(readStoredWallpaper(store()), DEFAULT_WALLPAPER, '没存过 → 缺省壁纸')
  assert.equal(readStoredWallpaper(store({ [WALLPAPER_KEY]: '' })), '', '空串是「用户主动关掉」，不能回落到缺省')
  assert.equal(readStoredWallpaper(store({ [WALLPAPER_KEY]: '   ' })), '', '只有空白也当关掉')
  assert.equal(readStoredWallpaper(store({ [WALLPAPER_KEY]: '  https://x.test/a.jpg  ' })), 'https://x.test/a.jpg')
  assert.equal(readStoredWallpaper(throwingStore()), DEFAULT_WALLPAPER, '隐私模式读不到 → 缺省')
})

test('wallpaperCss：空地址关闭、绝对地址原样、相对地址按 base 解析', () => {
  assert.equal(wallpaperCss(''), '')
  assert.equal(wallpaperCss('   '), '')
  // 带协议的、以 / 开头的一律原样，别又拼一次 base
  assert.equal(wallpaperCss('https://x.test/a.jpg', 'https://pin.test/pinfolio/notes'), 'url("https://x.test/a.jpg")')
  assert.equal(wallpaperCss('/a.jpg', 'https://pin.test/pinfolio/'), 'url("/a.jpg")')
  // 相对地址：反代挂子路径时 baseURI 带前缀，解析结果自然跟着走
  assert.equal(
    wallpaperCss('wallpapers/street.jpg', 'https://pin.test/pinfolio/notes'),
    'url("https://pin.test/pinfolio/wallpapers/street.jpg")',
  )
  assert.equal(
    wallpaperCss('wallpapers/street.jpg', 'https://pin.test/notes'),
    'url("https://pin.test/wallpapers/street.jpg")',
  )
  // 没有 base（测试桩 / 非浏览器场景）就原样留着，不猜
  assert.equal(wallpaperCss('wallpapers/street.jpg'), 'url("wallpapers/street.jpg")')
})

/** 带 style 与 baseURI 的首帧桩：壁纸变量写到这张 Map 上 */
function bootWinWithStyle(data: Record<string, string> = {}, baseURI = 'http://pin.test/') {
  const ds: Record<string, string> = {}
  const props = new Map<string, string>([['--wallpaper-url', 'url("旧的")']])
  const win: any = {
    document: {
      baseURI,
      documentElement: {
        dataset: ds,
        style: {
          setProperty: (k: string, v: string) => void props.set(k, v),
          removeProperty: (k: string) => void props.delete(k),
        },
      },
    },
    localStorage: store(data),
    matchMedia: (q: string) => ({ matches: false, media: q }),
  }
  return { ds, props, win }
}

test('applyBootPrefs：壁纸地址写进 --wallpaper-url，关掉时移除变量', () => {
  const a = bootWinWithStyle({ [WALLPAPER_KEY]: 'wallpapers/street.jpg' })
  applyBootPrefs(a.win)
  assert.equal(a.ds.wallpaper, 'on')
  assert.equal(a.props.get('--wallpaper-url'), 'url("http://pin.test/wallpapers/street.jpg")', '相对地址按 baseURI 解析')

  const b = bootWinWithStyle({ [WALLPAPER_KEY]: '' })
  applyBootPrefs(b.win)
  assert.equal(b.ds.wallpaper, 'off')
  assert.equal(b.props.has('--wallpaper-url'), false, '关掉壁纸必须移除变量，否则 CSS 还留着上一张')
})

test('applyWallpaperVar：没有 style 的桩不炸（首帧老桩 / 非 DOM 环境）', () => {
  assert.doesNotThrow(() => applyWallpaperVar({ documentElement: { dataset: {} as DOMStringMap } }, 'wallpapers/street.jpg'))
})

test('applyPref：壁纸开关只写自己的 data-wallpaper', () => {
  const d = installDom()
  try {
    d.dropRvT()
    applyPref('wallpaper', 'off')
    applyPref('wallpaper', 'on')
    assert.equal(d.root.dataset.wallpaper, 'on')
    assert.equal(d.root.dataset.style, undefined, '切壁纸不该顺带改风格')
  } finally {
    d.restore()
  }
})
