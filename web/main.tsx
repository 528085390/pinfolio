import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AuthGate } from './app/AuthGate'
import { applyLocale } from './lib/i18n'
import './styles/index.css'

// 语言在建模块时已定（localStorage → 浏览器），这里只把 <html lang> 对齐
applyLocale()

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </React.StrictMode>,
)
