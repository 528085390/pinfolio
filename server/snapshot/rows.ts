import { all, get } from '../db.js'

/**
 * 生成 SNAPSHOT.md 用到的四类行。查询都在这里，渲染在 ./markdown.ts（纯函数、可单测）。
 */

export interface AssetRow {
  id: number
  name: string
  kind: string
  status: string
  location: string
  vendor: string
  serial: string
  price: number | null
  currency: string
  purchased_at: string | null
  expires_at: string | null
  url: string
  notes: string
  custom: string
  updated_at: string
  tags?: string
}

export interface NoteRow {
  id: number
  content: string
  pinned: number
  archived: number
  done: number
  asset_id: number | null
  created_at: string
  updated_at: string
  tags?: string
}

export interface TagRow {
  name: string
  notes: number
  assets: number
}

export interface FieldRow {
  key: string
  label: string
  type: string
  options: string
}

/** 资产：在用的排前面，再按类型、名称（不区分大小写） */
export function loadAssets(): AssetRow[] {
  return all<AssetRow>(
    [
      'SELECT a.*,',
      " (SELECT group_concat(t.name, '、') FROM asset_tags at JOIN tags t ON t.id = at.tag_id WHERE at.asset_id = a.id) AS tags",
      'FROM assets a',
      "ORDER BY a.status = 'active' DESC, a.kind, a.name COLLATE NOCASE",
    ].join('\n'),
  )
}

/** 便签：按创建时间倒序 */
export function loadNotes(): NoteRow[] {
  return all<NoteRow>(
    [
      'SELECT n.*,',
      " (SELECT group_concat(t.name, '、') FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = n.id) AS tags",
      'FROM notes n',
      'ORDER BY n.created_at DESC',
    ].join('\n'),
  )
}

/** 标签：按「便签数 + 资产数」倒序，同数按名称 */
export function loadTags(): TagRow[] {
  return all<TagRow>(
    [
      'SELECT t.name,',
      ' (SELECT COUNT(*) FROM note_tags WHERE tag_id = t.id) AS notes,',
      ' (SELECT COUNT(*) FROM asset_tags WHERE tag_id = t.id) AS assets',
      'FROM tags t ORDER BY (notes + assets) DESC, t.name COLLATE NOCASE',
    ].join('\n'),
  )
}

/** 自定义字段定义：按 sort、id 排 */
export function loadFields(): FieldRow[] {
  return all<FieldRow>('SELECT key, label, type, options FROM field_defs ORDER BY sort ASC, id ASC')
}

/** 资产与便签里最晚的一次 updated_at；空库回 null */
export function loadLastChange(): string | null {
  const row = get<{ t: string | null }>(
    'SELECT MAX(t) AS t FROM (SELECT MAX(updated_at) AS t FROM assets UNION ALL SELECT MAX(updated_at) AS t FROM notes)',
  )
  return row?.t ?? null
}
