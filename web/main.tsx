import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AuthGate } from './app/AuthGate'
import { applyLocale } from './lib/i18n'
import { applyBootPrefs } from './lib/theme-prefs'
import './styles/index.css'

// 语言在建模块时已定（localStorage → 浏览器），这里只把 <html lang> 对齐
applyLocale()

// 首帧之前就把 data-theme / data-style / data-glass-refract 写到 <html>：
// 否则刷新会先按纸色画一帧，再跳到玻璃/暗色（白闪）
// 传 window：document / localStorage / matchMedia 全从这一个对象取（见 lib/theme-prefs）
applyBootPrefs(window)

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </React.StrictMode>,
)
