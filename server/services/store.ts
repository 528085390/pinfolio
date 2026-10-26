import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DATA_DIR } from '../db.js'
import { parseServices, type ServicesData } from './parse.js'

// 服务栏的数据文件（data/services.json，每次请求热读）。
// 与观测无关：这里只登记「谁部署在谁上面」，不产生 Kuma 检查、没有心跳、不进观测统计。
export const SERVICES_FILE = process.env.SERVICES_FILE || join(DATA_DIR, 'services.json')

export type ServicesPayload = ServicesData & { file: string }

export function loadServices(): ServicesPayload {
  try {
    return { ...parseServices(JSON.parse(readFileSync(SERVICES_FILE, 'utf8'))), file: SERVICES_FILE }
  } catch {
    // 文件不存在（或写坏了）就当没登记：页面给「还没有登记」的空态，不报错
    return { servers: [], services: [], deploys: [], monitors: {}, file: SERVICES_FILE }
  }
}

// 每次写盘前先把旧文件留一份：页面上删错一台机，还能从这里捞回来。
const BACKUP_DIR = join(dirname(SERVICES_FILE), 'services-backups')
const BACKUP_KEEP = 10
const BACKUP_RE = /^services-\d{8}-\d{6}(-\d+)?\.json$/

function stamp(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return (
    d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
  )
}

/** 同一秒里连写两次时给文件名加个序号，别把前一份备份覆盖掉。 */
function backupPath(): string {
  const base = join(BACKUP_DIR, 'services-' + stamp())
  for (let i = 1; i < 100; i++) {
    const file = i === 1 ? base + '.json' : base + '-' + i + '.json'
    try {
      readFileSync(file)
    } catch {
      return file
    }
  }
  return base + '-' + Date.now() + '.json'
}

/** 只留最近 BACKUP_KEEP 份（文件名带时间戳，按名字排就是按时间排）。 */
function pruneBackups() {
  let names: string[]
  try {
    names = readdirSync(BACKUP_DIR).filter((n) => BACKUP_RE.test(n)).sort()
  } catch {
    return
  }
  for (const n of names.slice(0, Math.max(0, names.length - BACKUP_KEEP))) {
    try {
      unlinkSync(join(BACKUP_DIR, n))
    } catch {
      /* 删不掉就算了，下次再试 */
    }
  }
}

/**
 * 把整份数据写回 data/services.json：先备份旧文件，再 tmp + rename。
 * 写一半断电最多留下一个 .tmp，不会留下半个 JSON 让页面直接空掉。
 */
export function saveServices(data: ServicesData): ServicesPayload {
  const file = SERVICES_FILE
  mkdirSync(dirname(file), { recursive: true })
  try {
    const raw = readFileSync(file, 'utf8')
    if (raw.trim()) {
      mkdirSync(BACKUP_DIR, { recursive: true })
      writeFileSync(backupPath(), raw, 'utf8')
      pruneBackups()
    }
  } catch {
    /* 第一次写：还没有旧文件，不用备份 */
  }
  const next: ServicesData = {
    servers: data.servers,
    services: data.services,
    deploys: data.deploys,
    monitors: data.monitors,
  }
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
  // 读回来（走一遍 parse）：返回给前端的永远是「文件里真正存着什么」
  return loadServices()
}

/** 最近几份备份（调试与文档用；页面上没有入口）。 */
export function listBackups(): string[] {
  try {
    return readdirSync(BACKUP_DIR).filter((n) => BACKUP_RE.test(n)).sort().reverse()
  } catch {
    return []
  }
}
