import type { FieldDef, Stats, Tag } from '../lib/api'
import { AppearanceCard } from './settings/AppearanceCard'
import { DataCard } from './settings/DataCard'
import { FieldsCard } from './settings/FieldsCard'
import { TagsCard } from './settings/TagsCard'
import { useSettings } from './settings/useSettings'

// 组合层：四张卡片各自独立，状态与动作都在 useSettings 里。
export function SettingsPage({ tags, fields, stats, refreshMeta, theme, setTheme }: {
  tags: Tag[]
  fields: FieldDef[]
  stats: Stats | null
  refreshMeta: () => void
  theme: string
  setTheme: (t: string) => void
}) {
  const s = useSettings({ refreshMeta })
  const empty = !stats || (stats.notes === 0 && stats.assets === 0)

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      {s.msg ? <div className="alert" style={{ marginBottom: 14 }}>{s.msg}</div> : null}
      <AppearanceCard theme={theme} setTheme={setTheme} />
      <FieldsCard s={s} fields={fields} />
      <TagsCard s={s} tags={tags} />
      <DataCard s={s} empty={empty} />
    </div>
  )
}
