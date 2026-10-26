// 主机清单的纯逻辑：data/metrics.json 里 hosts 数组的校验、增删改，以及写回时的合并。
// 文件读写（含原子写）在 config.ts；这里不碰 fs，所以能直接单测。
import { t } from '../i18n.js'
import { parseDisks, parseUnits } from './onboard.js'

// units / disks / address 是「装采集端」要用的参数，跟 id 一起存进 data/metrics.json：
// 这样隔几天再打开「接入这台机器」，还能原样生成同一条安装命令。
export type HostMeta = {
  id: string
  label: string
  note: string
  paused?: boolean
  units?: string[]
  disks?: string[]
  address?: string
  /** 加主机时顺带建的观测项 id：彻底删这台机时照着它去 Kuma 里收掉 */
  monitors?: number[]
  /** 顺带建的分组 id：观测项删干净后这个组也一起删 */
  group?: number
}
export type HostResult = { ok: true; hosts: HostMeta[] } | { ok: false; error: string }

export const ID_MAX = 32
export const LABEL_MAX = 40
export const NOTE_MAX = 60

// id 同时是采集端上报的文件名（tools/node-metrics/ 里 HOST_ID 生成 <id>.json），
// 所以只允许能在 URL / 文件名里安全出现的字符，且不能以符号开头。
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** 读文件时用：坏值直接当没有（配置写坏了也不该让整页起不来）。 */
function safeUnits(value: any): string[] {
  try {
    return parseUnits(Array.isArray(value) ? value.join(' ') : value)
  } catch {
    return []
  }
}

function safeMonitors(value: any): number[] {
  if (!Array.isArray(value)) return []
  const out: number[] = []
  for (const v of value) {
    const n = Number(v)
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n)
    if (out.length >= 32) break
  }
  return out
}

function safeDisks(value: any): string[] {
  try {
    const out = parseDisks(Array.isArray(value) ? value.join(' ') : value)
    return out.length === 1 && out[0] === '/' ? [] : out
  } catch {
    return []
  }
}

/** 读配置时归一化 hosts 数组：丢坏条目、去重（不分大小写）、label 回落 id。 */
export function parseHosts(raw: any): HostMeta[] {
  if (!Array.isArray(raw)) return []
  const out: HostMeta[] = []
  const seen = new Set<string>()
  for (const h of raw) {
    if (!h || typeof h !== 'object') continue
    const id = typeof h.id === 'string' ? h.id.trim() : ''
    if (!id || seen.has(id.toLowerCase())) continue
    seen.add(id.toLowerCase())
    const host: HostMeta = {
      id,
      label: String(h.label || id).trim() || id,
      note: String(h.note || '').trim(),
    }
    if (h.paused === true) host.paused = true
    const units = safeUnits(h.units)
    if (units.length) host.units = units
    const disks = safeDisks(h.disks)
    if (disks.length) host.disks = disks
    const address = typeof h.address === 'string' ? h.address.trim() : ''
    if (address) host.address = address
    const monitors = safeMonitors(h.monitors)
    if (monitors.length) host.monitors = monitors
    const group = Number(h.group)
    if (Number.isInteger(group) && group > 0) host.group = group
    out.push(host)
  }
  return out
}

/** 新主机 / 改名备注的校验。错误文案直接给用户看，所以写成中文整句。 */
export function normalizeHostInput(input: any): { ok: true; host: HostMeta } | { ok: false; error: string } {
  const id = String(input?.id ?? '').trim()
  if (!id) return { ok: false, error: t('主机 id 不能为空') }
  if (id.length > ID_MAX) return { ok: false, error: t('主机 id 最长 {n} 位', { n: ID_MAX }) }
  if (!ID_RE.test(id)) return { ok: false, error: t('主机 id 只能用字母、数字、点、下划线、短横线') }
  const label = String(input?.label ?? '').trim() || id
  if (label.length > LABEL_MAX) return { ok: false, error: t('名字最长 {n} 字', { n: LABEL_MAX }) }
  const note = String(input?.note ?? '').trim()
  if (note.length > NOTE_MAX) return { ok: false, error: t('备注最长 {n} 字', { n: NOTE_MAX }) }
  const host: HostMeta = { id, label, note }
  const extra = applyCollectorFields(host, input)
  if (!extra.ok) return extra
  return { ok: true, host: extra.host }
}

/** 采集端参数：服务清单 / 磁盘路径 / 地址。不传就不动；传空数组 = 清掉。 */
function applyCollectorFields(host: HostMeta, patch: any): { ok: true; host: HostMeta } | { ok: false; error: string } {
  const next: HostMeta = { ...host }
  if (patch?.units !== undefined) {
    let units: string[]
    try {
      units = parseUnits(Array.isArray(patch.units) ? patch.units.join(' ') : patch.units)
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) }
    }
    if (units.length) next.units = units
    else delete next.units
  }
  if (patch?.disks !== undefined) {
    let disks: string[]
    try {
      disks = parseDisks(Array.isArray(patch.disks) ? patch.disks.join(' ') : patch.disks)
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) }
    }
    // 只填 "/" 等于默认值，不写进文件
    if (disks.length === 1 && disks[0] === '/') delete next.disks
    else next.disks = disks
  }
  if (patch?.monitors !== undefined) {
    const monitors = safeMonitors(patch.monitors)
    if (monitors.length) next.monitors = monitors
    else delete next.monitors
  }
  if (patch?.group !== undefined) {
    const group = Number(patch.group)
    if (Number.isInteger(group) && group > 0) next.group = group
    else delete next.group
  }
  if (patch?.address !== undefined) {
    const address = String(patch.address ?? '').trim()
    if (address.length > 100) return { ok: false, error: t('地址最长 100 字') }
    if (address) next.address = address
    else delete next.address
  }
  return { ok: true, host: next }
}

function applyFields(base: HostMeta, patch: any): { ok: true; host: HostMeta } | { ok: false; error: string } {
  const host: HostMeta = { ...base }
  if (patch?.label !== undefined) {
    const label = String(patch.label).trim() || base.id
    if (label.length > LABEL_MAX) return { ok: false, error: t('名字最长 {n} 字', { n: LABEL_MAX }) }
    host.label = label
  }
  if (patch?.note !== undefined) {
    const note = String(patch.note).trim()
    if (note.length > NOTE_MAX) return { ok: false, error: t('备注最长 {n} 字', { n: NOTE_MAX }) }
    host.note = note
  }
  return { ok: true, host }
}

export function addHost(hosts: HostMeta[], input: any): HostResult {
  const n = normalizeHostInput(input)
  if (!n.ok) return n
  if (hosts.some((h) => h.id.toLowerCase() === n.host.id.toLowerCase())) {
    return { ok: false, error: t('已经有这台主机：') + n.host.id }
  }
  return { ok: true, hosts: [...hosts, n.host] }
}

/** paused 是真值就写 paused: true，假值就把键删掉 —— 配置文件里不留 paused: false 的噪声。 */
export function patchHost(hosts: HostMeta[], id: string, patch: any): HostResult {
  const want = String(id ?? '').trim()
  const idx = hosts.findIndex((h) => h.id.toLowerCase() === want.toLowerCase())
  if (idx < 0) return { ok: false, error: t('没有这台主机：') + want }
  const f = applyFields(hosts[idx], patch)
  if (!f.ok) return f
  const c = applyCollectorFields(f.host, patch)
  if (!c.ok) return c
  const host = c.host
  if (patch?.paused === true) host.paused = true
  else if (patch?.paused === false) delete host.paused
  return { ok: true, hosts: hosts.map((h, i) => (i === idx ? host : h)) }
}

export function removeHost(hosts: HostMeta[], id: string): HostResult {
  const want = String(id ?? '').trim()
  const idx = hosts.findIndex((h) => h.id.toLowerCase() === want.toLowerCase())
  if (idx < 0) return { ok: false, error: t('没有这台主机：') + want }
  return { ok: true, hosts: hosts.filter((_, i) => i !== idx) }
}

/**
 * 拉取失败清单只留「还在配置里、且没暂停」的机器：
 * 删掉 / 暂停之后还挂着上一轮的失败，页面上会冒出不存在的主机告警。
 */
export function visibleFailures<T extends { id: string }>(failed: T[], hosts: HostMeta[]): T[] {
  const live = new Set(hosts.filter((h) => h.paused !== true).map((h) => h.id))
  return failed.filter((f) => live.has(f.id))
}

/**
 * 写回 data/metrics.json 时只换 hosts：base（带 token）和其它未知键原样保留，
 * 否则一次「加主机」就会把指标源地址弄丢。
 */
export function mergeMetricsFile(raw: any, hosts: HostMeta[]): Record<string, any> {
  const base = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return { ...base, hosts }
}
