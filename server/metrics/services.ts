import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// 主机上的服务（unit）→ 观测项的映射表（host-services.json，可随时改，不用重启）。
// 形如 [{ "host": "指标源", "unit": "nginx", "match": "Nginx" }]：
//   match   该主机分组里观测项「短名」包含它（不分大小写）就算对上；
//   monitor 直接按 Kuma 的观测项 id 钉死（改名也不怕）。
// 对不上就当没配：前端把 chip 渲染成纯文字，点了不跳（需求：没有观测就不跳）。
const SERVICES_FILE = process.env.HOST_SERVICES || join(process.cwd(), 'host-services.json')

export type ServiceRule = { host: string; unit: string; match?: string; monitor?: number }
/** 状态页里的一项（只取跳转要用的三个字段）。 */
export type MonitorRef = { id: number; name: string; group: string }
export type UnitMonitor = { id: number; name: string }

/** 「指标源 (阿里云 · 北京)」→「指标源」：组名尾巴的厂商地区只是给人看的。 */
export function shortGroup(name: string): string {
  const s = String(name || '')
  return s.replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim() || s
}

/** 观测项名普遍是「机器短名 / 服务名」，映射表里只写服务名那截。 */
export function shortName(name: string, group: string): string {
  const prefix = shortGroup(group) + ' / '
  return name.startsWith(prefix) ? name.slice(prefix.length) : name
}

function findMonitor(rule: ServiceRule, host: string, monitors: MonitorRef[]): MonitorRef | null {
  if (typeof rule.monitor === 'number' && Number.isFinite(rule.monitor)) {
    return monitors.find((m) => m && m.id === rule.monitor) || null
  }
  const match = String(rule.match || '').trim().toLowerCase()
  if (!match) return null
  return monitors.find((m) => m
    && shortGroup(m.group).toLowerCase() === host
    && shortName(m.name, m.group).toLowerCase().includes(match)) || null
}

/**
 * 一台机的 unit → 观测项。同一个 unit 配了多条规则时第一条赢；
 * 规则形状不全、观测项被删了、Kuma 拿不到状态页（传空数组）都只是「这条不出现」，不抛错。
 */
export function resolveUnitMonitors(rules: ServiceRule[], hostId: string, monitors: MonitorRef[]): Record<string, UnitMonitor> {
  const out: Record<string, UnitMonitor> = {}
  if (!Array.isArray(rules)) return out
  const host = shortGroup(String(hostId || '')).toLowerCase()
  const list = Array.isArray(monitors) ? monitors : []
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue
    const unit = String(rule.unit || '').trim()
    const ruleHost = String(rule.host || '').trim().toLowerCase()
    if (!unit || !ruleHost || ruleHost !== host || out[unit]) continue
    const hit = findMonitor(rule, host, list)
    if (hit) out[unit] = { id: hit.id, name: hit.name }
  }
  return out
}

/**
 * 写回映射表：先写 .tmp 再 rename，中途崩了也不会留半份 JSON
 * （读侧坏文件只是 chip 不可点，但没必要冒这个险）。
 */
export function saveServiceRules(rules: ServiceRule[], file: string = SERVICES_FILE): ServiceRule[] {
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(rules, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
  return rules
}

/** 删掉一台机的映射（彻底删主机时用；host 不分大小写）。没命中就原样返回。 */
export function removeServiceRules(rules: ServiceRule[], host: string): ServiceRule[] {
  const want = String(host || '').trim().toLowerCase()
  if (!want) return rules
  return rules.filter((r) => String(r?.host || '').trim().toLowerCase() !== want)
}

/** 读映射表；文件不存在 / 写坏了就当没配（主机页照常显示，只是 chip 不可点）。 */
export function loadServiceRules(file: string = SERVICES_FILE): ServiceRule[] {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (!Array.isArray(parsed)) return []
    const out: ServiceRule[] = []
    for (const r of parsed) {
      if (!r || typeof r !== 'object') continue
      const host = String(r.host || '').trim()
      const unit = String(r.unit || '').trim()
      if (!host || !unit) continue
      const rule: ServiceRule = { host, unit }
      const match = String(r.match || '').trim()
      if (match) rule.match = match
      const monitor = Number(r.monitor)
      if (Number.isFinite(monitor) && monitor > 0) rule.monitor = Math.floor(monitor)
      if (!rule.match && !rule.monitor) continue
      out.push(rule)
    }
    return out
  } catch {
    return []
  }
}
