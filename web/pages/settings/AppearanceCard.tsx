import { Monitor, Moon, Sun } from 'lucide-react'

const THEMES = [
  { v: 'light', label: '浅色', icon: <Sun size={14} /> },
  { v: 'dark', label: '深色', icon: <Moon size={14} /> },
  { v: 'system', label: '跟随系统', icon: <Monitor size={14} /> },
]

export function AppearanceCard({ theme, setTheme }: { theme: string; setTheme: (t: string) => void }) {
  return (
    <div className="card">
      <div className="section-title" style={{ marginTop: 0 }}>外观</div>
      <div className="row" style={{ gap: 6 }}>
        {THEMES.map((o) => (
          <button key={o.v} className={'chip' + (theme === o.v ? ' active' : '')} onClick={() => setTheme(o.v)}>
            {o.icon} {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
