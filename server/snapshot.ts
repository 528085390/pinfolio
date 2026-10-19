import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, all, get } from './db.js'

/**
 * 生成 SNAPSHOT.md —— 给人（和下一个会话的 agent）快速预览用的可读快照。
 * 只读数据库、只写一个文件；任何失败都只打日志，不影响请求。
 */

export const SNAPSHOT_PATH = join(ROOT, 'SNAPSHOT.md')

const KIND_LABEL: Record<string, string> = { device: '设备', server: '服务器', account: '账号', domain: '域名', other: '其他' }
const STATUS_LABEL: Record<string, string> = { active: '在用', idle: '闲置', retired: '退役', lost: '丢失' }

const pad = (n: number) => (n < 10 ? '0' + n : String(n))

/** ISO 时间 -> 本地 'YYYY-MM-DD HH:mm' */
function fmt(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return String(iso)
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/** 表格单元格：去换行、转义竖线、空值给 — */
function cell(v: any): string {
  if (v === null || v === undefined || v === '') return '—'
  return String(v).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
}

/** 多行文本按 2 空格缩进，塞进列表项下面 */
function indent(text: string, prefix = '  '): string {
  return text.split(/\r?\n/).map((l) => (l ? prefix + l : '')).join('\n')
}

function parseCustom(raw: string): Record<string, any> {
  try {
    const o = JSON.parse(raw || '{}')
    return o && typeof o === 'object' ? o : {}
  } catch {
    return {}
  }
}

function countBy<T>(rows: T[], pick: (r: T) => string): string {
  const m = new Map<string, number>()
  for (const r of rows) m.set(pick(r), (m.get(pick(r)) || 0) + 1)
  return [...m.entries()].map(([k, v]) => k + ' ' + v).join(' / ')
}

interface AssetRow {
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

interface NoteRow {
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

function loadAssets(): AssetRow[] {
  return all<AssetRow>(
    [
      'SELECT a.*,',
      " (SELECT group_concat(t.name, '、') FROM asset_tags at JOIN tags t ON t.id = at.tag_id WHERE at.asset_id = a.id) AS tags",
      'FROM assets a',
      "ORDER BY a.status = 'active' DESC, a.kind, a.name COLLATE NOCASE",
    ].join('\n'),
  )
}

function loadNotes(): NoteRow[] {
  return all<NoteRow>(
    [
      'SELECT n.*,',
      " (SELECT group_concat(t.name, '、') FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.note_id = n.id) AS tags",
      'FROM notes n',
      'ORDER BY n.created_at DESC',
    ].join('\n'),
  )
}

export function buildSnapshot(): string {
  const assets = loadAssets()
  const notes = loadNotes()
  const tags = all<{ name: string; notes: number; assets: number }>(
    [
      'SELECT t.name,',
      ' (SELECT COUNT(*) FROM note_tags WHERE tag_id = t.id) AS notes,',
      ' (SELECT COUNT(*) FROM asset_tags WHERE tag_id = t.id) AS assets',
      'FROM tags t ORDER BY (notes + assets) DESC, t.name COLLATE NOCASE',
    ].join('\n'),
  )
  const fields = all<{ key: string; label: string; type: string; options: string }>(
    'SELECT key, label, type, options FROM field_defs ORDER BY sort ASC, id ASC',
  )
  const lastChange = get<{ t: string | null }>(
    'SELECT MAX(t) AS t FROM (SELECT MAX(updated_at) AS t FROM assets UNION ALL SELECT MAX(updated_at) AS t FROM notes)',
  )

  const pendingNotes = notes.filter((n) => !n.archived && !n.done)

  const L: string[] = []
  L.push('# 便签夹快照（pinboard）')
  L.push('')
  L.push('> 本文件由 `server/snapshot.ts` 自动生成，**不要手改**——每次增删改后约 1.5 秒会被整份重写。')
  L.push('> 用途：新会话先读这一份就能看到全部资产、便签、标签与自定义字段，不必查库。')
  L.push('>')
  L.push('> 生成时间：' + fmt(new Date().toISOString()) + '　｜　数据最后变更：' + fmt(lastChange?.t ?? null))
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

/** 立即重写快照；失败只打日志 */
export async function writeSnapshot(): Promise<string | null> {
  try {
    const text = buildSnapshot()
    await writeFile(SNAPSHOT_PATH, text, 'utf8')
    return SNAPSHOT_PATH
  } catch (err) {
    console.warn('[snapshot] 生成失败：', err instanceof Error ? err.message : err)
    return null
  }
}

let timer: NodeJS.Timeout | null = null
let running = false
let dirty = false

/** 请求改动后调用：1.5 秒防抖，合并连续写入 */
export function scheduleSnapshot(delay = 1500): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void flush()
  }, delay)
  if (timer.unref) timer.unref()
}

async function flush(): Promise<void> {
  if (running) {
    dirty = true
    return
  }
  running = true
  try {
    await writeSnapshot()
  } finally {
    running = false
    if (dirty) {
      dirty = false
      scheduleSnapshot(200)
    }
  }
}

// 直接执行时（pnpm snapshot / tsx server/snapshot.ts）立即生成一次
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (entry && import.meta.url === entry) {
  const p = await writeSnapshot()
  if (p) console.log('已生成 ' + p)
  else process.exitCode = 1
}
