import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_QUICK_NOTE_OPTIONS,
  createQuickNoteWindow,
  getQuickNoteWindowOptions,
  isValidShortcut,
  registerQuickNoteShortcut,
} from '../../desktop/quick-note.js'
import {
  getQuickNoteHtml,
  getQuickNoteDataUrl,
} from '../../desktop/quick-note-html.js'

test('DEFAULT_QUICK_NOTE_OPTIONS：窗口几何与无边框深色配置', () => {
  assert.equal(DEFAULT_QUICK_NOTE_OPTIONS.width, 540)
  assert.equal(DEFAULT_QUICK_NOTE_OPTIONS.height, 260)
  assert.equal(DEFAULT_QUICK_NOTE_OPTIONS.frame, false)
  assert.equal(DEFAULT_QUICK_NOTE_OPTIONS.resizable, false)
  assert.equal(DEFAULT_QUICK_NOTE_OPTIONS.alwaysOnTop, true)
  assert.equal(DEFAULT_QUICK_NOTE_OPTIONS.skipTaskbar, true)
  assert.equal(DEFAULT_QUICK_NOTE_OPTIONS.backgroundColor, '#111315')
  assert.equal(DEFAULT_QUICK_NOTE_OPTIONS.show, false)
  assert.deepEqual(DEFAULT_QUICK_NOTE_OPTIONS.webPreferences, {
    contextIsolation: true,
    sandbox: true,
  })
})

test('getQuickNoteWindowOptions：支持覆盖参数并保留基础配置', () => {
  const custom = getQuickNoteWindowOptions({ width: 600, show: true })
  assert.equal(custom.width, 600)
  assert.equal(custom.height, 260)
  assert.equal(custom.show, true)
  assert.equal(custom.frame, false)
  assert.equal(custom.backgroundColor, '#111315')
})

test('isValidShortcut：快捷键格式校验', () => {
  assert.equal(isValidShortcut('CommandOrControl+Alt+N'), true)
  assert.equal(isValidShortcut('Ctrl+Alt+N'), true)
  assert.equal(isValidShortcut('Alt+Shift+N'), true)
  assert.equal(isValidShortcut('CommandOrControl+Shift+D'), true)

  assert.equal(isValidShortcut(''), false)
  assert.equal(isValidShortcut('   '), false)
  assert.equal(isValidShortcut(null as any), false)
  assert.equal(isValidShortcut(undefined as any), false)
  assert.equal(isValidShortcut('N'), false)
  assert.equal(isValidShortcut('Enter'), false)
})

test('registerQuickNoteShortcut：成功注册并处理回调', () => {
  let registeredShortcut = ''
  let handlerCalled = false
  let storedCallback: (() => void) | null = null

  const mockDeps = {
    globalShortcut: {
      register: (shortcut: string, callback: () => void) => {
        registeredShortcut = shortcut
        storedCallback = callback
        return true
      },
    },
    log: () => {},
  }

  const success = registerQuickNoteShortcut('CommandOrControl+Alt+N', () => {
    handlerCalled = true
  }, mockDeps)

  assert.equal(success, true)
  assert.equal(registeredShortcut, 'CommandOrControl+Alt+N')
  assert.ok(storedCallback)

  ;(storedCallback as any)()
  assert.equal(handlerCalled, true)
})

test('registerQuickNoteShortcut：非法快捷键直接返回 false 并不调注册', () => {
  let called = false
  const mockDeps = {
    globalShortcut: {
      register: () => {
        called = true
        return true
      },
    },
    log: () => {},
  }

  const res = registerQuickNoteShortcut('invalid', () => {}, mockDeps)
  assert.equal(res, false)
  assert.equal(called, false)
})

test('registerQuickNoteShortcut：系统注册失败时安全捕获并返回 false', () => {
  let loggedMsg = ''
  const mockDeps = {
    globalShortcut: {
      register: () => false,
    },
    log: (msg: string) => {
      loggedMsg = msg
    },
  }

  const res = registerQuickNoteShortcut('CommandOrControl+Alt+N', () => {}, mockDeps)
  assert.equal(res, false)
  assert.ok(loggedMsg.includes('快捷键注册失败') || loggedMsg.includes('CommandOrControl+Alt+N'))
})

test('registerQuickNoteShortcut：注册抛出异常时不崩溃并返回 false', () => {
  const mockDeps = {
    globalShortcut: {
      register: () => {
        throw new Error('OS shortcut conflict')
      },
    },
    log: () => {},
  }

  const res = registerQuickNoteShortcut('CommandOrControl+Alt+N', () => {}, mockDeps)
  assert.equal(res, false)
})

test('getQuickNoteHtml：深色主题与随手记关键元素', () => {
  const html = getQuickNoteHtml('http://127.0.0.1:7788')
  assert.ok(html.includes('#111315'), '背景必须为 Pinfolio 经典深色 #111315')
  assert.ok(html.includes('随手记便签'), '标题应包含随手记便签')
  assert.ok(html.includes('Ctrl+Enter'), '包含 Ctrl+Enter 快捷键提示')
  assert.ok(html.includes('Esc'), '包含 Esc 关闭提示')
  assert.ok(html.includes('placeholder="随时记一笔... 支持 #标签"'), '多行输入框占位符')
  assert.ok(html.includes('id="noteInput"'), '输入框具备 ID')
  assert.ok(html.includes('id="tagPreview"'), '具备实时标签提取预览条')
  assert.ok(html.includes('id="pinnedCheckbox"'), '具备置顶复选框')
  assert.ok(html.includes('id="saveBtn"'), '具备保存按钮')
  assert.ok(html.includes('保存便签'), '保存按钮文字')
})

test('getQuickNoteHtml：包含提交与关闭事件处理逻辑及重新聚焦', () => {
  const html = getQuickNoteHtml('http://127.0.0.1:7788')
  assert.ok(html.includes('/api/notes'), '必须调用 /api/notes 接口')
  assert.ok(html.includes("credentials: 'include'"), '必须携带 Session Cookie 凭据')
  assert.ok(html.includes('window.close()'), '支持 window.close() 关闭/隐藏浮窗')
  assert.ok(html.includes('便签已保存'), '保存成功绿勾反馈')
  assert.ok(html.includes('extractTags'), '包含标签提取函数')
  assert.ok(html.includes("window.addEventListener('focus'"), '包含窗口聚焦时自动定位输入框')
})

test('getQuickNoteHtml：安全转义 targetUrl 特殊字符', () => {
  const html = getQuickNoteHtml('http://127.0.0.1:7788/?name="<test>"')
  assert.ok(!html.includes('http://127.0.0.1:7788/?name="<test>"'), '不应裸露未转义引号')
})

test('getQuickNoteDataUrl：返回合法的 data:text/html 地址', () => {
  const dataUrl = getQuickNoteDataUrl('http://127.0.0.1:7788')
  assert.ok(dataUrl.startsWith('data:text/html;charset=utf-8,'))
  assert.ok(dataUrl.includes(encodeURIComponent('随手记便签')))
})

test('createQuickNoteWindow：创建窗口、加载页面并挂载事件（含 baseURLForDataURL 跨域修复）', () => {
  const events: Record<string, Function> = {}
  let loadedUrl = ''
  let loadedOptions: any = null
  let hideCount = 0
  let onHideCalled = false

  class MockBrowserWindow {
    constructor(public options: any) {}
    loadURL(url: string, options?: any) {
      loadedUrl = url
      loadedOptions = options
      return Promise.resolve()
    }
    on(event: string, handler: Function) {
      events[event] = handler
    }
    hide() {
      hideCount++
    }
    isVisible() {
      return true
    }
    isDestroyed() {
      return false
    }
  }

  const mockDeps = {
    BrowserWindow: MockBrowserWindow as any,
    log: () => {},
  }

  const win = createQuickNoteWindow('http://127.0.0.1:7788', () => {
    onHideCalled = true
  }, mockDeps)

  assert.ok(win)
  assert.ok(loadedUrl.startsWith('data:text/html;charset=utf-8,'))
  assert.equal(loadedOptions?.baseURLForDataURL, 'http://127.0.0.1:7788/')
  assert.equal(typeof events['close'], 'function')
  assert.equal(typeof events['blur'], 'function')

  // 测试 close 事件拦截为 hide
  let defaultPrevented = false
  events['close']({
    preventDefault: () => {
      defaultPrevented = true
    },
  })
  assert.equal(defaultPrevented, true)
  assert.equal(hideCount, 1)
  assert.equal(onHideCalled, true)

  // 测试 blur 事件触发 hide
  onHideCalled = false
  events['blur']()
  assert.equal(hideCount, 2)
  assert.equal(onHideCalled, true)

  // 测试末尾已有斜杠的 URL 规整
  createQuickNoteWindow('http://127.0.0.1:7788/', undefined, mockDeps)
  assert.equal(loadedOptions?.baseURLForDataURL, 'http://127.0.0.1:7788/')
})
