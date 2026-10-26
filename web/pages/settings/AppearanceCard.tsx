import { Monitor, Moon, Sun } from 'lucide-react'
import { getLocale, setLocale, t, type Locale } from '../../lib/i18n'

// label 用 getter：常量里存中文原文，渲染时才过 t()——放模块常量里翻译会被 import 时机冻住。
const THEMES = [
  { v: 'light', get label() { return t('浅色') }, icon: <Sun size={14} /> },
  { v: 'dark', get label() { return t('深色') }, icon: <Moon size={14} /> },
  { v: 'system', get label() { return t('跟随系统') }, icon: <Monitor size={14} /> },
]

const LOCALES: { v: Locale; label: string }[] = [
  { v: 'zh', get label() { return t('中文') } },
  { v: 'en', get label() { return t('English') } },
]

export function AppearanceCard({ theme, setTheme }: { theme: string; setTheme: (t: string) => void }) {
  const locale = getLocale()
  return (
    <div className="card">
      <div className="section-title" style={{ marginTop: 0 }}>{t('外观')}</div>

      <div className="row" style={{ gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 34 }}>{t('主题')}</span>
        {THEMES.map((o) => (
          <button key={o.v} className={'chip' + (theme === o.v ? ' active' : '')} onClick={() => setTheme(o.v)}>
            {o.icon} {o.label}
          </button>
        ))}
      </div>

      <div className="row" style={{ gap: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 34 }}>{t('语言')}</span>
        {LOCALES.map((o) => (
          <button key={o.v} className={'chip' + (locale === o.v ? ' active' : '')} onClick={() => setLocale(o.v)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
