// 备份的纯逻辑：文件名、保留策略、心跳 CSV、定时开关。不碰磁盘、不碰数据库，方便单测。
//
// scheduledEnabled() 放在这里而不是 schedule.ts：schedule.ts 会 import runBackup → db.ts，
// 单测只要碰一下它就等于打开真实数据库，CI 上并行跑测试直接 "database is locked"（坑 52）。

export type HeartbeatRow = {
  time: string
  monitor_id: number
  monitor_name: string
  status: number
  msg: string | null
  ping: number | null
}

/** BACKUP=0 / off / false / no 关掉定时任务；空串或未设算开启（默认开）。 */
export function scheduledEnabled(): boolean {
  const v = String(process.env.BACKUP ?? '').trim().toLowerCase()
  return !(v === '0' || v === 'off' || v === 'false' || v === 'no')
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** 本地时间戳 YYYYMMDD-HHMM（文件名排序 = 时间排序） */
export function stamp(d: Date): string {
  return String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes())
}

export function backupFileName(d: Date): string {
  return 'pinfolio-' + stamp(d) + '.tar.gz'
}

/** 周日那份带 kuma 全量快照（每天带会让 14 份涨到 55 MB） */
export function isWeeklySnapshot(d: Date): boolean {
  return d.getDay() === 0
}

const BACKUP_RE = /^pinfolio-\d{8}-\d{4}\.tar\.gz$/

/** 超出保留份数的那些（最旧的）；只认 pinfolio-*.tar.gz，迁移前快照不动 */
export function pickExpired(names: string[], keep: number): string[] {
  if (keep <= 0) return []
  const backups = names.filter((n) => BACKUP_RE.test(n)).sort()
  if (backups.length <= keep) return []
  return backups.slice(0, backups.length - keep)
}

/** CSV 单元格：含逗号 / 引号 / 换行就整体加引号，内部引号翻倍 */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

export const HEARTBEAT_HEADER = 'time,monitor_id,monitor_name,status,msg,ping'

/** 心跳 → CSV（审计用：Excel / pandas 直接打开） */
export function heartbeatCsv(rows: HeartbeatRow[]): string {
  const lines = [HEARTBEAT_HEADER]
  for (const r of rows) {
    lines.push([csvCell(r.time), csvCell(r.monitor_id), csvCell(r.monitor_name), csvCell(r.status), csvCell(r.msg), csvCell(r.ping)].join(','))
  }
  return lines.join('\n') + '\n'
}

/** 本地时间 YYYYMMDD（心跳 CSV 与归档文件按天切） */
export function dayStamp(d: Date): string {
  return String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate())
}
