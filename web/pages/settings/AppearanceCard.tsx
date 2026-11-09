import type { ReactElement } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { getLocale, setLocale, t, type Locale } from '../../lib/i18n'
import type { RefractPref, StylePref, ThemePref } from '../../lib/theme-prefs'

// label 用 getter：常量里存中文原文，渲染时才过 t()——放模块常量里翻译会被 import 时机冻住。
const THEMES: { v: ThemePref; get label(): string; icon: ReactElement }[] = [
  { v: 'light', get label() { return t('浅色') }, icon: <Sun size={14} /> },
  { v: 'dark', get label() { return t('深色') }, icon: <Moon size={14} /> },
  { v: 'system', get label() { return t('跟随系统') }, icon: <Monitor size={14} /> },
]

const STYLES: { v: StylePref; get label(): string }[] = [
  { v: 'paper', get label() { return t('暖纸') } },
  { v: 'glass', get label() { return t('玻璃') } },
]

const REFRACTS: { v: RefractPref; get label(): string }[] = [
  { v: 'off', get label() { return t('标准') } },
  { v: 'on', get label() { return t('折射') } },
]

const LOCALES: { v: Locale; label: string }[] = [
  { v: 'zh', get label() { return t('中文') } },
  { v: 'en', get label() { return t('English') } },
]

// 真折射只有 Chromium 能画（backdrop-filter: url(#filter) 在 WebKit / Gecko 是静默不绘制，
// 会退化成「没模糊的透明块」），所以开关只在 Chromium 上出现——与 glass.css 的
// @supports (-webkit-app-region: none) 用同一个判据
function canRefract(): boolean {
  return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('-webkit-app-region', 'none')
}

export function AppearanceCard({ theme, setTheme, style, setStyle, refract, setRefract }: {
  theme: ThemePref
  setTheme: (t: ThemePref) => void
  style: StylePref
  setStyle: (v: StylePref) => void
  refract: RefractPref
  setRefract: (v: RefractPref) => void
}) {
  const locale = getLocale()
  return (
    <div className="card">
      <div className="section-title" style={{ marginTop: 0 }}>{t('外观')}</div>

      <div className="row" style={{ gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 34 }}>{t('风格')}</span>
        {STYLES.map((o) => (
          <button key={o.v} className={'chip' + (style === o.v ? ' active' : '')} onClick={() => setStyle(o.v)}>
            {o.label}
          </button>
        ))}
      </div>

      {/* 折射只是玻璃的次级开关：暖纸下没有玻璃层可折射，非 Chromium 上也画不出来 */}
      {style === 'glass' && canRefract() ? (
        <>
          <div className="row" style={{ gap: 6, marginBottom: refract === 'on' ? 4 : 10 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 34 }}>{t('折射')}</span>
            {REFRACTS.map((o) => (
              <button key={o.v} className={'chip' + (refract === o.v ? ' active' : '')} onClick={() => setRefract(o.v)}>
                {o.label}
              </button>
            ))}
          </div>
          {/* 折射要靠 backdrop-filter: url(#…) 画位移贴图，只有 Chromium / 桌面端（Electron）认；
              而且当前 Chrome 156 的 backdrop-filter 链路上位移贴图读不到（背景会整体错位约 12px），
              所以默认关闭。开启就如实说清现状，别让人以为是调错了。 */}
          {refract === 'on' ? (
            <div className="field-hint" style={{ marginBottom: 10, paddingLeft: 40 }}>{t('实验特性：Chromium 尚未修好 backdrop-filter 的位移贴图，翻开会有约 12px 整体错位')}</div>
          ) : null}
        </>
      ) : null}

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
