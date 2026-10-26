import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from '../db.js'
import { parseServices, type ServicesData } from './parse.js'

// 服务栏的数据文件（data/services.json，每次请求热读，改完刷新页面即生效）。
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
