import { readFileSync } from 'node:fs'
import { Hono } from 'hono'
import { isJsonContentType } from '../kuma/http.js'
import { addMonitor, deleteGroup, deleteMonitor, ensureGroup, kumaCliPath, kumaCliReady } from '../kuma/kuma-cli.js'
import { groupNameFor, mergeServiceRules, planMonitors } from '../kuma/provision.js'
import { getStatusPage } from '../kuma/source.js'
import { metricsConfig, saveHosts } from './config.js'
import { addHost, patchHost, removeHost, visibleFailures } from './hostmeta.js'
import { buildIngestUrl, buildInstallCommand, INSTALL_URL } from './onboard.js'
import { lastPoll, pollAll } from './poll.js'
import { loadServiceRules, removeServiceRules, resolveUnitMonitors, saveServiceRules, type MonitorRef } from './services.js'
import { deleteSamples, latestSamples, sampleCount, seriesSince } from './store.js'

// 主机指标：GET 出「每台机最新一帧 + 24 小时曲线」，POST /refresh 强制立刻拉一次。
// 增 / 暂停 / 删走 POST / PATCH / DELETE，写回 data/metrics.json（唯一真相），改完不用重启。
// 数据来自 6 台机自己的 systemd timer，本服务只负责拉和存，不做任何主动探测。
export const hostsRoute = new Hono()

const STALE_SEC = 900 // 3 个采集周期没上报就当离线
const SERIES_SEC = 86400

/** 状态页里的观测项摊平（只取映射要用的 id / name / group）。Kuma 挂了就回空表。 */
async function monitorRefs(): Promise<MonitorRef[]> {
  try {
    const page = await getStatusPage()
    const out: MonitorRef[] = []
    for (const g of page?.publicGroupList || []) {
      for (const m of g.monitorList || []) out.push({ id: m.id, name: m.name, group: g.name })
    }
    return out
  } catch {
    return [] // 主机页不能因为观测台挂了就整页报错，只是服务 chip 不可点
  }
}

async function buildPayload() {
  const cfg = metricsConfig()
  const rules = loadServiceRules()
  const refs = await monitorRefs()
  const latest = latestSamples()
  const now = Math.floor(Date.now() / 1000)
  const hosts = cfg.hosts.map((h) => {
    const paused = h.paused === true
    // unit → 观测项：前端据此决定 chip 能不能点（没有映射 / 观测项已删就只剩文字）
    const unitMonitors = rules.length ? resolveUnitMonitors(rules, h.id, refs) : {}
    const row = latest.get(h.id)
    if (!row) {
      return {
        id: h.id, label: h.label, note: h.note, paused, unitMonitors,
        online: false, staleSec: null, series: [] as [number, number, number][],
      }
    }
    const staleSec = Math.max(0, now - row.ts)
    return {
      ...row.data,
      id: h.id,
      label: h.label,
      note: h.note,
      paused,
      online: !paused && staleSec <= STALE_SEC,
      staleSec,
      series: seriesSince(h.id, now - SERIES_SEC),
      unitMonitors,
    }
  })
  const p = lastPoll()
  return {
    hosts,
    updatedAt: new Date().toISOString(),
    polledAt: p.at ? new Date(p.at).toISOString() : null,
    pollOk: p.ok,
    // 只报「本来有数据、这次没拉到」的：刚加的主机还没装采集端时别刷红条，卡片自己会写「还没收到上报」
    pollFailed: visibleFailures(p.failed, cfg.hosts).filter((f) => latest.has(f.id)),
    samples: sampleCount(),
  }
}

hostsRoute.get('/', async (c) => {
  const cfg = metricsConfig()
  if (!cfg.base) {
    return c.json({ error: '还没配指标源：在 data/metrics.json 里写 base 和 hosts', hosts: [] }, 500)
  }
  // 库里一行都没有（刚部署 / 刚清库）时等这一次拉取，否则后台补拉，不让首屏卡 8 秒
  if (sampleCount() === 0) await pollAll(true).catch(() => {})
  else void pollAll().catch(() => {})
  return c.json(await buildPayload())
})

hostsRoute.post('/refresh', async (c) => {
  if (!isJsonContentType(c.req.header('content-type'))) return c.json({ error: '需要 application/json' }, 415)
  await pollAll(true)
  return c.json(await buildPayload())
})

type Templates = {
  port?: number
  http?: { url: string; keyword: string }
  services: { unit: string; ssh: { user: string; key: string } }[]
}

/** 私钥文件大小上限：真私钥几 KB，超过这个数基本是拿错文件了。 */
const KEY_MAX = 64 * 1024

/**
 * 抽屉「观测项」段：端口 / HTTP 站点 / systemd 服务，都可以不填。
 * 私钥在这一步读好（读不到就直接 400，别把主机加进去一半）。
 */
function readTemplates(body: any): Templates {
  const port = body?.port === undefined || body?.port === null || body?.port === ''
    ? undefined
    : Number(body.port)
  const http = body?.http && String(body.http.url ?? '').trim()
    ? { url: String(body.http.url).trim(), keyword: String(body.http.keyword ?? '').trim() }
    : undefined
  const services: Templates['services'] = []
  for (const s of Array.isArray(body?.services) ? body.services : []) {
    const unit = String(s?.unit ?? '').trim()
    if (!unit) continue
    const user = String(s?.user ?? '').trim()
    const keyPath = String(s?.keyPath ?? '').trim()
    if (!user) throw new Error('systemd 探测要填 SSH 用户名（' + unit + '）')
    if (!keyPath) throw new Error('systemd 探测要填 SSH 私钥路径（' + unit + '）')
    let key: string
    try {
      key = readFileSync(keyPath, 'utf8')
    } catch {
      throw new Error('读不到私钥：' + keyPath)
    }
    // keyPath 是请求体给的，等于「任意文件读取」的入口：只收真私钥、限大小，
    // 免得被拿来读 data/secret.key 之类的东西再顺着 Kuma 观测项带出去（坑 50）。
    if (key.length > KEY_MAX) throw new Error('私钥文件太大（超过 64 KB）：' + keyPath)
    if (!/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(key)) {
      throw new Error('这个文件不是 OpenSSH / PEM 私钥：' + keyPath)
    }
    services.push({ unit, ssh: { user, key } })
  }
  return { port, http, services }
}

hostsRoute.post('/', async (c) => {
  if (!isJsonContentType(c.req.header('content-type'))) return c.json({ error: '需要 application/json' }, 415)
  const body: any = await c.req.json().catch(() => ({}))
  let templates: Templates
  try {
    templates = readTemplates(body)
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 400)
  }
  const address = String(body?.address ?? '').trim()
  const wantsMonitors = templates.port !== undefined || Boolean(templates.http) || templates.services.length > 0
  if (wantsMonitors && !address) return c.json({ error: '勾了观测项就要填主机地址（IP 或域名）' }, 400)

  const r = addHost(metricsConfig().hosts, { ...body, address })
  // 重名是冲突（409），其余是参数不对（400）
  if (!r.ok) return c.json({ error: r.error }, r.error.startsWith('已经有这台主机') ? 409 : 400)
  saveHosts(r.hosts)
  const host = r.hosts.find((h) => h.id === String(body?.id ?? '').trim()) || r.hosts[r.hosts.length - 1]

  // 建观测项是「顺带」：失败不回滚主机（指标照样收），把错误原样带回去让用户决定
  let provision: Record<string, unknown> | null = null
  if (wantsMonitors) {
    try {
      const groupName = groupNameFor(host)
      const planned = planMonitors({
        hostId: host.id,
        address: host.address || address,
        groupName,
        port: templates.port,
        http: templates.http,
        services: templates.services,
      })
      if (!kumaCliReady()) throw new Error('找不到 kuma-monitor：' + kumaCliPath())
      const groupId = await ensureGroup(groupName)
      const created: { id: number; name: string; unit?: string }[] = []
      try {
        for (const p of planned) {
          created.push({ id: await addMonitor(p.payload, groupId), name: p.name, unit: p.unit })
        }
      } catch (e) {
        // 建到一半失败：把已经建出来的删掉，别留半套观测项
        for (const m of created) await deleteMonitor(m.id).catch(() => {})
        throw e
      }
      const additions = created
        .filter((m) => m.unit)
        .map((m) => ({ host: host.id, unit: m.unit as string, monitor: m.id }))
      if (additions.length) saveServiceRules(mergeServiceRules(loadServiceRules(), additions))
      // 记住这批 id：彻底删这台机时要去 Kuma 里把它们收掉，不然会一直探一个已经下线的地址
      const tagged = patchHost(metricsConfig().hosts, host.id, { monitors: created.map((m) => m.id), group: groupId })
      if (tagged.ok) saveHosts(tagged.hosts)
      provision = { ok: true, groupId, groupName, monitors: created }
    } catch (e: any) {
      provision = { ok: false, error: String(e?.message || e) }
    }
  }

  // 新加的这台立刻拉一帧：否则卡片要空等 5 分钟，看起来像没加上
  await pollAll(true).catch(() => {})
  return c.json({ ...(await buildPayload()), provision })
})

/**
 * 「接入这台机器」：一条安装命令 + 首帧状态。
 * ingest 地址里带 token，所以只在登录后的这一支出现（/api/hosts 列表里没有）。
 */
hostsRoute.get('/:id/onboard', (c) => {
  const cfg = metricsConfig()
  const want = c.req.param('id').trim().toLowerCase()
  const host = cfg.hosts.find((h) => h.id.toLowerCase() === want)
  if (!host) return c.json({ error: '没有这台主机：' + c.req.param('id') }, 404)
  let ingestUrl: string
  try {
    ingestUrl = buildIngestUrl(cfg.base)
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 500)
  }
  const units = host.units ?? []
  const disks = host.disks && host.disks.length ? host.disks : ['/']
  const origin = process.env.PUBLIC_URL || new URL(c.req.url).origin
  const installUrl = INSTALL_URL || origin + '/nm/node-metrics-install.sh'
  const command = buildInstallCommand({ installUrl, ingestUrl, hostId: host.id, units, disks })
  const latest = latestSamples().get(host.id)
  const now = Math.floor(Date.now() / 1000)
  return c.json({
    hostId: host.id,
    label: host.label,
    address: host.address ?? null,
    units,
    disks,
    installUrl,
    ingestUrl,
    command,
    ready: Boolean(latest),
    firstSampleAt: latest ? new Date(latest.ts * 1000).toISOString() : null,
    staleSec: latest ? Math.max(0, now - latest.ts) : null,
  })
})

hostsRoute.patch('/:id', async (c) => {
  if (!isJsonContentType(c.req.header('content-type'))) return c.json({ error: '需要 application/json' }, 415)
  const body: any = await c.req.json().catch(() => ({}))
  const r = patchHost(metricsConfig().hosts, c.req.param('id'), body)
  // 纯函数只回一句中文错误，这里按前缀分状态码（没有这台机 = 404，参数不对 = 400）
  if (!r.ok) return c.json({ error: r.error }, r.error.startsWith('没有这台主机') ? 404 : 400)
  saveHosts(r.hosts)
  // 恢复暂停后立刻补一帧：采集端一直在推，最新数据就在 指标源 上
  if (body?.paused === false) await pollAll(true).catch(() => {})
  return c.json(await buildPayload())
})

hostsRoute.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const confirm = (c.req.query('confirm') || '').trim()
  if (!confirm || confirm.toLowerCase() !== id.trim().toLowerCase()) {
    return c.json({ error: '要手输主机 id（' + id + '）确认删除' }, 400)
  }
  const cfg = metricsConfig()
  const target = cfg.hosts.find((h) => h.id.toLowerCase() === id.trim().toLowerCase())
  const r = removeHost(cfg.hosts, id)
  if (!r.ok) return c.json({ error: r.error }, 404)
  saveHosts(r.hosts)
  // 历史样本默认跟着删：留着没人认领的 30 天数据只会在库里越堆越多
  const purge = c.req.query('purge') === '1'
  const purged = purge && target ? deleteSamples(target.id) : 0
  // 彻底删时把「加主机顺带建」的观测项一起收掉，否则它们会一直探一台已经不在清单里的机器
  let monitorsDeleted = 0
  const monitorsFailed: number[] = []
  if (purge && target) {
    for (const mid of target.monitors ?? []) {
      try {
        await deleteMonitor(mid)
        monitorsDeleted++
      } catch {
        monitorsFailed.push(mid)
      }
    }
    // 观测项删完，组空了才删组（组里还有别的项时 CLI 会拒绝，忽略即可）
    if (target.group) await deleteGroup(target.group).catch(() => {})
    const rules = loadServiceRules()
    const kept = removeServiceRules(rules, target.id)
    if (kept.length !== rules.length) saveServiceRules(kept)
  }
  return c.json({ ...(await buildPayload()), purged, monitorsDeleted, monitorsFailed })
})
