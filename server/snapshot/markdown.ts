import type { AssetRow, FieldRow, NoteRow, TagRow } from './rows.js'

/**
 * SNAPSHOT.md 的渲染：纯函数，只吃行数据、只吐字符串（不碰数据库、不写文件），所以能直接单测。
 * 取数在 ./rows.ts，写文件与防抖在 ./write.ts。
 */

export const KIND_LABEL: Record<string, string> = { device: '设备', server: '服务器', account: '账号', domain: '域名', other: '其他' }
export const STATUS_LABEL: Record<string, string> = { active: '在用', idle: '闲置', retired: '退役', lost: '丢失' }

export const pad = (n: number) => (n < 10 ? '0' + n : String(n))

/** ISO 时间 -> 本地 'YYYY-MM-DD HH:mm'；空值给 —，解析不了就原样回 */
export function fmt(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return String(iso)
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/** 表格单元格：去换行、转义竖线、空值给 — */
export function cell(v: any): string {
  if (v === null || v === undefined || v === '') return '—'
  return String(v).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
}

/** 多行文本按 2 空格缩进，塞进列表项下面 */
export function indent(text: string, prefix = '  '): string {
  return text.split(/\r?\n/).map((l) => (l ? prefix + l : '')).join('\n')
}

export function parseCustom(raw: string): Record<string, any> {
  try {
    const o = JSON.parse(raw || '{}')
    return o && typeof o === 'object' ? o : {}
  } catch {
    return {}
  }
}

/** 按某个字段归类计数，拼成「在用 3 / 闲置 1」这种 */
export function countBy<T>(rows: T[], pick: (r: T) => string): string {
  const m = new Map<string, number>()
  for (const r of rows) m.set(pick(r), (m.get(pick(r)) || 0) + 1)
  return [...m.entries()].map(([k, v]) => k + ' ' + v).join(' / ')
}

export type SnapshotData = {
  assets: AssetRow[]
  notes: NoteRow[]
  tags: TagRow[]
  fields: FieldRow[]
  /** 资产与便签里最晚的 updated_at，没有就 null */
  lastChange: string | null
  /** 生成时间（ISO）；不传就取当前时间。传进来是为了单测能固定输出 */
  now?: string
}

export function renderSnapshot(data: SnapshotData): string {
  const { assets, notes, tags, fields, lastChange } = data
  const now = data.now ?? new Date().toISOString()
  const pendingNotes = notes.filter((n) => !n.archived && !n.done)

  const L: string[] = []
  L.push('# 便签夹快照（pinboard）')
  L.push('')
  L.push('> 本文件由 `server/snapshot.ts` 自动生成，**不要手改**——每次增删改后约 1.5 秒会被整份重写。')
  L.push('> 用途：新会话先读这一份就能看到全部资产、便签、标签与自定义字段，不必查库。')
  L.push('>')
  L.push('> 生成时间：' + fmt(now) + '　｜　数据最后变更：' + fmt(lastChange ?? null))
  L.push('> 手动重生成：`pnpm snapshot`　｜　实时页面：http://127.0.0.1:7788/　｜　库：`data/pinboard.db`')
  L.push('')
  L.push('## 概览')
  L.push('')
  L.push(
    '- 资产 **' + assets.length + '** 条：' + countBy(assets, (a) => STATUS_LABEL[a.status] || a.status) +
      '（按类型：' + countBy(assets, (a) => KIND_LABEL[a.kind] || a.kind) + '）',
  )
  L.push(
    '- 便签 **' + notes.length + '** 条：未完成 ' + pendingNotes.length +
      ' / 已完成 ' + notes.filter((n) => n.done && !n.archived).length +
      ' / 置顶 ' + notes.filter((n) => n.pinned && !n.archived).length +
      ' / 归档 ' + notes.filter((n) => n.archived).length,
  )
  L.push('- 标签 ' + tags.length + ' 个　｜　自定义字段 ' + fields.length + ' 个')
  L.push('')

  L.push('## 资产总表')
  L.push('')
  if (assets.length === 0) {
    L.push('（暂无资产）')
  } else {
    L.push('| id | 名称 | 类型 | 状态 | 位置 | IP / 地址 | 到期 | 标签 |')
    L.push('|---:|---|---|---|---|---|---|---|')
    for (const a of assets) {
      const custom = parseCustom(a.custom)
      L.push(
        '| ' + a.id + ' | ' + cell(a.name) + ' | ' + cell(KIND_LABEL[a.kind] || a.kind) + ' | ' + cell(STATUS_LABEL[a.status] || a.status) +
          ' | ' + cell(a.location) + ' | ' + cell(custom.ip) + ' | ' + cell(a.expires_at) + ' | ' + cell(a.tags) + ' |',
      )
    }
  }
  L.push('')

  L.push('## 资产详情')
  L.push('')
  if (assets.length === 0) L.push('（暂无资产）')
  for (const a of assets) {
    const custom = parseCustom(a.custom)
    const customKeys = Object.keys(custom).filter((k) => custom[k] !== null && custom[k] !== '' && custom[k] !== undefined)
    const priceText = a.price === null || a.price === undefined ? '—' : a.currency + ' ' + a.price
    L.push('### ' + a.id + '. ' + a.name)
    L.push('')
    L.push('- 类型 / 状态：' + (KIND_LABEL[a.kind] || a.kind) + ' / ' + (STATUS_LABEL[a.status] || a.status))
    L.push('- 位置：' + (a.location || '—') + '　｜　厂商：' + (a.vendor || '—') + '　｜　序列号：' + (a.serial || '—'))
    L.push('- 价格：' + priceText + '　｜　购买：' + (a.purchased_at || '—') + '　｜　到期：' + (a.expires_at || '—'))
    if (a.url) L.push('- URL：' + a.url)
    L.push('- 标签：' + (a.tags || '—'))
    if (customKeys.length) {
      L.push('- 自定义字段：')
      for (const k of customKeys) {
        const def = fields.find((f) => f.key === k)
        const v = typeof custom[k] === 'object' ? JSON.stringify(custom[k]) : String(custom[k])
        L.push('  - ' + (def ? def.label + '（' + k + '）' : k) + '：' + v.replace(/\r?\n/g, ' '))
      }
    }
    if (a.notes && a.notes.trim()) {
      L.push('- 备注：')
      L.push('')
      L.push(indent(a.notes.trim()))
      L.push('')
    } else {
      L.push('- 备注：—')
    }
    L.push('- 最后更新：' + fmt(a.updated_at))
    L.push('')
  }

  L.push('## 便签（按创建时间倒序）')
  L.push('')
  if (notes.length === 0) L.push('（暂无便签）')
  for (const n of notes) {
    const flags: string[] = []
    if (n.pinned) flags.push('置顶')
    if (n.archived) flags.push('归档')
    flags.push(n.done ? '已完成' : '未完成')
    if (n.asset_id) flags.push('关联资产 #' + n.asset_id)
    L.push('### #' + n.id + '　' + flags.join('　') + '　' + fmt(n.created_at))
    L.push('')
    L.push(indent(n.content.trim()))
    L.push('')
    if (n.tags) L.push('- 标签：' + n.tags)
    L.push('')
  }

  L.push('## 标签总览')
  L.push('')
  if (tags.length === 0) {
    L.push('（暂无标签）')
  } else {
    L.push('| 标签 | 便签 | 资产 |')
    L.push('|---|---:|---:|')
    for (const t of tags) L.push('| ' + cell(t.name) + ' | ' + t.notes + ' | ' + t.assets + ' |')
  }
  L.push('')
  L.push('## 自定义字段')
  L.push('')
  if (fields.length === 0) {
    L.push('（暂无自定义字段）')
  } else {
    L.push('| key | 名称 | 类型 | 选项 |')
    L.push('|---|---|---|---|')
    for (const f of fields) {
      let opts = ''
      try {
        const arr = JSON.parse(f.options || '[]')
        opts = Array.isArray(arr) ? arr.join(' / ') : ''
      } catch {
        opts = ''
      }
      L.push('| ' + cell(f.key) + ' | ' + cell(f.label) + ' | ' + cell(f.type) + ' | ' + cell(opts) + ' |')
    }
  }
  L.push('')
  return L.join('\n')
}
