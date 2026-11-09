import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import type { HeartbeatRow, MonitorRow } from './types.ts'
import { MonitorStore } from './store.ts'
import { parsePolicy, POLICY_PRESETS } from './policy.ts'

export const TYPE_LABEL: Record<string, string> = {
  http: 'HTTP',
  port: 'TCP 端口',
  ssh: 'SSH 命令',
  push: 'Push',
}

const pad = (n: number) => (n < 10 ? '0' + n : String(n))

export function fmtLocal(d: Date): string {
  return (
    d.getFullYear() +
    '-' +
    pad(d.getMonth() + 1) +
    '-' +
    pad(d.getDate()) +
    ' ' +
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes())
  )
}

export function cell(v: any): string {
  if (v === null || v === undefined || v === '') return '—'
  return String(v).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
}

export function formatTarget(m: Partial<MonitorRow>): string {
  if (m.type === 'http') {
    return (m.url || '') + (m.keyword ? '　关键词「' + m.keyword + '」' : '')
  }
  if (m.type === 'port') {
    return (m.hostname || '') + ':' + (m.port || '')
  }
  if (m.type === 'ssh') {
    const user = m.ssh_username ? m.ssh_username + '@' : ''
    return (
      user +
      (m.hostname || '') +
      ':' +
      (m.port || 22) +
      (m.ssh_command ? '　' + m.ssh_command : '')
    )
  }
  if (m.type === 'push') {
    return '—'
  }
  return m.url || m.hostname || '—'
}

function canon(v: any): string {
  if (Array.isArray(v)) {
    return '[' + v.map(canon).join(',') + ']'
  }
  if (v && typeof v === 'object') {
    return (
      '{' +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canon(v[k]))
        .join(',') +
      '}'
    )
  }
  return JSON.stringify(v)
}

/** 去掉根级 timeZone，用来认出「加 timeZone 之前」保存下来的预设 JSON。 */
function withoutTimeZone(v: any): any {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v
  const out: Record<string, any> = {}
  for (const [k, val] of Object.entries(v)) {
    if (k === 'timeZone') continue
    out[k] = val
  }
  return out
}

export function formatPolicyLabel(json: string | null | undefined): string {
  const parsed = parsePolicy(json)
  if (parsed.error || !parsed.policy) {
    return '-'
  }
  const p = parsed.policy
  const key = canon(p)
  for (const [name, preset] of Object.entries(POLICY_PRESETS)) {
    if (canon(preset) === key) {
      return name
    }
    // 老数据：预设加了 timeZone 之后，早先存下的同一份 JSON 少了这个字段，
    // 它实际是按服务器本地时区解释时间窗的，所以标出来而不是当成自定义策略。
    if (preset.timeZone && !p.timeZone && canon(withoutTimeZone(preset)) === key) {
      return name + '（本地时区）'
    }
  }

  const rules =
    p.interval && Array.isArray(p.interval.rules) ? p.interval.rules.length : 0
  let label: string
  if (rules > 0) {
    label = 'custom(' + rules + ' rules)'
  } else if (p.interval && typeof p.interval.default === 'number') {
    label = 'fixed ' + p.interval.default + 's'
  } else {
    label = 'custom'
  }
  return p.gate ? 'gate+' + label : label
}

export function renderMonitorSnapshot(
  monitors: MonitorRow[],
  latestBeats: Map<number, HeartbeatRow>,
  now?: Date
): string {
  const currentDate = now instanceof Date ? now : new Date()

  // Find latest heartbeat timestamp across all heartbeats
  let latestHbTime: Date | null = null
  for (const hb of latestBeats.values()) {
    if (hb.time) {
      const d = new Date(hb.time)
      if (!isNaN(d.getTime())) {
        if (!latestHbTime || d.getTime() > latestHbTime.getTime()) {
          latestHbTime = d
        }
      }
    }
  }

  const active = monitors.filter((m) => m.active)
  const inactive = monitors.filter((m) => !m.active)

  // Count by type
  const typeCounts = new Map<string, number>()
  for (const m of monitors) {
    const label = TYPE_LABEL[m.type] || m.type
    typeCounts.set(label, (typeCounts.get(label) || 0) + 1)
  }
  const typeSummary = [...typeCounts.entries()]
    .map(([k, v]) => `${k} ${v}`)
    .join(' / ')

  // Group monitors
  const grouped = new Map<string, MonitorRow[]>()
  const ungrouped: MonitorRow[] = []

  for (const m of monitors) {
    const g = (m.group_name || '').trim()
    if (!g) {
      ungrouped.push(m)
    } else {
      if (!grouped.has(g)) {
        grouped.set(g, [])
      }
      grouped.get(g)!.push(m)
    }
  }

  // Determine group ordering: '本机' first, then others
  const sortedGroupNames = [...grouped.keys()].sort((a, b) => {
    if (a === '本机') return -1
    if (b === '本机') return 1
    return a.localeCompare(b, 'zh-CN')
  })

  const lines: string[] = []
  lines.push('# 观测台快照')
  lines.push('')
  lines.push(
    '> 由 `server/monitor/snapshot.ts` 自动生成，**不要手改**——改完观测项会自动整份重写。'
  )
  lines.push('> 用途：新会话先读这一份就能看到全部观测项与分组，不必查库。')
  lines.push('>')
  lines.push(
    `> 生成时间：${fmtLocal(currentDate)}　｜　最后心跳：${
      latestHbTime ? fmtLocal(latestHbTime) : '—'
    }`
  )
  lines.push(
    '> 实时状态：pinboard 观测页 http://127.0.0.1:7788/（侧栏「观测」）'
  )
  lines.push('> 库：pinboard.db')
  lines.push('')
  lines.push('## 概览')
  lines.push('')
  lines.push(
    `- 观测项 **${monitors.length}** 个（启用 ${active.length} / 停用 ${inactive.length}）：${typeSummary}`
  )
  lines.push(
    `- 分组 ${sortedGroupNames.length} 个：${sortedGroupNames.join('、')}${
      ungrouped.length ? '　｜　未分组 ' + ungrouped.length + ' 个' : ''
    }`
  )
  lines.push(
    '- 默认节奏：间隔 60 秒；超时 HTTP 10–20 / TCP 20 / SSH 30；重试 HTTP 1 / SSH 2（首次 SSH 握手易超时，故多一次重试）'
  )
  lines.push(
    '- 判 UP 规则：HTTP 2xx（可带关键词）、TCP 端口能连上、SSH 命令退出码 0'
  )
  lines.push('')

  for (const groupName of sortedGroupNames) {
    const list = grouped.get(groupName) || []
    lines.push(`## ${groupName}（${list.length} 项）`)
    lines.push('')
    lines.push(
      '| id | 名称 | 类型 | 目标 | 间隔 | 超时 | 重试 | 策略 | 说明 |'
    )
    lines.push('|---:|---|---|---|---:|---:|---:|---|---|')
    for (const m of list) {
      lines.push(
        `| ${m.id} | ${cell(m.name)} | ${cell(
          TYPE_LABEL[m.type] || m.type
        )} | ${cell(formatTarget(m))} | ${cell(m.interval)}s | ${cell(
          m.timeout
        )}s | ${cell(m.maxretries)} | ${cell(
          formatPolicyLabel(m.policy_json)
        )} | ${cell(m.description)}${m.active ? '' : '（已停用）'} |`
      )
    }
    lines.push('')
  }

  if (ungrouped.length > 0) {
    lines.push('## 未分组（观测页看不到，需要 attach）')
    lines.push('')
    lines.push(
      '| id | 名称 | 类型 | 目标 | 间隔 | 超时 | 重试 | 策略 | 说明 |'
    )
    lines.push('|---:|---|---|---|---:|---:|---:|---|---|')
    for (const m of ungrouped) {
      lines.push(
        `| ${m.id} | ${cell(m.name)} | ${cell(
          TYPE_LABEL[m.type] || m.type
        )} | ${cell(formatTarget(m))} | ${cell(m.interval)}s | ${cell(
          m.timeout
        )}s | ${cell(m.maxretries)} | ${cell(
          formatPolicyLabel(m.policy_json)
        )} | ${cell(m.description)}${m.active ? '' : '（已停用）'} |`
      )
    }
    lines.push('')
  }

  lines.push('## 维护入口')
  lines.push('')
  lines.push('- 观测界面：pinboard 观测页 http://127.0.0.1:7788/')
  lines.push('- 抽屉配置：可在抽屉直接编辑、暂停、删除或立即观测')
  lines.push('')

  return lines.join('\n')
}

export function writeMonitorSnapshot(
  snapshotPath: string,
  store: MonitorStore,
  now?: Date
): void {
  const monitors = store.getAllMonitors()
  const latestBeats = new Map<number, HeartbeatRow>()
  for (const m of monitors) {
    const hb = store.getLatestHeartbeat(m.id)
    if (hb) {
      latestBeats.set(m.id, hb)
    }
  }

  const markdown = renderMonitorSnapshot(monitors, latestBeats, now)
  const dir = path.dirname(snapshotPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(snapshotPath, markdown, 'utf8')
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (entry && import.meta.url === entry) {
  const { db } = await import('../db.js')
  const store = new MonitorStore(db)
  const target =
    process.env.MONITOR_SNAPSHOT ||
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'SNAPSHOT-MONITORS.md')
  writeMonitorSnapshot(target, store)
  console.log('已生成 ' + target)
}
