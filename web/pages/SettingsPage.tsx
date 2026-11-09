import type { FieldDef, Stats, Tag } from '../lib/api'
import type { RefractPref, StylePref, ThemePref } from '../lib/theme-prefs'
import { AppearanceCard } from './settings/AppearanceCard'
import { DataCard } from './settings/DataCard'
import { OutboundCard } from './settings/OutboundCard'
import { SecurityCard } from './settings/SecurityCard'
import { TunnelCard } from './settings/TunnelCard'
import { FieldsCard } from './settings/FieldsCard'
import { TagsCard } from './settings/TagsCard'
import { useSettings } from './settings/useSettings'

// 组合层：四张卡片各自独立，状态与动作都在 useSettings 里。
export function SettingsPage({ tags, fields, stats, refreshMeta, theme, setTheme, style, setStyle, refract, setRefract, wallpaper, setWallpaper }: {
  tags: Tag[]
  fields: FieldDef[]
  stats: Stats | null
  refreshMeta: () => void
  theme: ThemePref
  setTheme: (t: ThemePref) => void
  style: StylePref
  setStyle: (v: StylePref) => void
  refract: RefractPref
  setRefract: (v: RefractPref) => void
  /** 壁纸地址（空串 = 关） */
  wallpaper: string
  setWallpaper: (v: string) => void
}) {
  const s = useSettings({ refreshMeta })
  const empty = !stats || (stats.notes === 0 && stats.assets === 0)

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      {s.msg ? <div className="alert" style={{ marginBottom: 14 }}>{s.msg}</div> : null}
      <AppearanceCard
        theme={theme}
        setTheme={setTheme}
        style={style}
        setStyle={setStyle}
        refract={refract}
        setRefract={setRefract}
        wallpaper={wallpaper}
        setWallpaper={setWallpaper}
      />
      <FieldsCard s={s} fields={fields} />
      <TagsCard s={s} tags={tags} />
      <DataCard s={s} empty={empty} />
      <SecurityCard />
      <OutboundCard />
      <TunnelCard />
    </div>
  )
}
