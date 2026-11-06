// 资产抽屉联动组件与编辑展示逻辑单元测试
// 运行：pnpm test:unit
import test from 'node:test'
import assert from 'node:assert/strict'
import { blank, toForm, buildPayload } from '../../web/components/asset-drawer/form.js'
import {
  parseAssetTelemetry,
  mergeAssetTelemetry,
  suggestTelemetry,
} from '../../web/lib/telemetry-link.js'
import {
  getSuggestHint,
  formatHostStats,
  formatMonitorStatus,
} from '../../web/components/asset-drawer/LinkedTelemetry.js'

test('form：blank() 默认具有空 custom 字典', () => {
  const f = blank()
  assert.deepEqual(f.custom, {})
  const { hostId, monitorIds } = parseAssetTelemetry(f.custom)
  assert.equal(hostId, null)
  assert.deepEqual(monitorIds, [])
})

test('form：toForm() 保留已有 custom 属性以及 hostId 与 monitorIds', () => {
  const asset = {
    id: 10,
    name: 'aws-node',
    kind: 'server',
    status: 'active',
    location: '俄勒冈',
    vendor: 'AWS',
    serial: 'i-12345',
    price: 35.5,
    currency: 'USD',
    custom: {
      ip: '54.200.10.1',
      hostId: 'aws',
      monitorIds: [101, 102],
    },
  } as any

  const f = toForm(asset)
  assert.equal(f.name, 'aws-node')
  assert.equal(f.custom.ip, '54.200.10.1')
  assert.equal(f.custom.hostId, 'aws')
  assert.deepEqual(f.custom.monitorIds, [101, 102])

  const telemetry = parseAssetTelemetry(f.custom)
  assert.equal(telemetry.hostId, 'aws')
  assert.deepEqual(telemetry.monitorIds, [101, 102])
})

test('form：toForm() 在 asset.custom 为空或非对象时安全回退', () => {
  const f1 = toForm({ id: 1, name: 'x', custom: null } as any)
  assert.deepEqual(f1.custom, {})
  const f2 = toForm({ id: 2, name: 'y' } as any)
  assert.deepEqual(f2.custom, {})
})

test('form：buildPayload() 干净保留 custom.hostId、custom.monitorIds 与已有 custom 字段', () => {
  const f = {
    ...blank(),
    name: 'my-server',
    custom: {
      role: 'bastion',
      ip: '10.0.0.5',
      hostId: 'oj',
      monitorIds: [201],
    },
  }

  const payload = buildPayload(f, 'tag1, tag2')
  assert.equal(payload.name, 'my-server')
  assert.deepEqual(payload.tags, ['tag1', 'tag2'])
  assert.equal(payload.custom.role, 'bastion')
  assert.equal(payload.custom.ip, '10.0.0.5')
  assert.equal(payload.custom.hostId, 'oj')
  assert.deepEqual(payload.custom.monitorIds, [201])
})

test('auto-suggest 联动流：检测到匹配并一键填入，不覆盖已有 custom 字段', () => {
  const hosts = [
    { id: 'aws', label: 'AWS (俄勒冈)' },
    { id: 'az', label: 'Azure (美中)' },
  ]
  const monitors = [
    { id: 101, name: 'aws / V2Ray', group: 'aws (AWS · 俄勒冈)' },
    { id: 102, name: 'aws / Caddy', group: 'aws (AWS · 俄勒冈)' },
    { id: 201, name: 'az / Nginx', group: 'az (Azure · 美中)' },
  ]

  // 用户新建或编辑资产，录入名称与位置
  const f = {
    ...blank(),
    name: 'AWS',
    location: '俄勒冈',
    custom: {
      provider: 'Amazon',
      datacenter: 'us-west-2',
    },
  }

  // 1. 调用 suggestTelemetry
  const suggestion = suggestTelemetry(f.name, f.location, hosts, monitors)
  assert.equal(suggestion.suggestedHostId, 'aws')
  assert.deepEqual(suggestion.suggestedMonitorIds, [101, 102])

  // 2. 检查 UI 提示文案 helper
  const hint = getSuggestHint(f.name, f.location, hosts, monitors, f.custom)
  assert.ok(hint)
  assert.equal(hint.hostId, 'aws')
  assert.deepEqual(hint.monitorIds, [101, 102])
  assert.ok(hint.text.includes('aws'))
  assert.ok(hint.text.includes('2'))

  // 3. 点击一键填入：通过 mergeAssetTelemetry 更新 custom
  const updatedCustom = mergeAssetTelemetry(f.custom, {
    hostId: suggestion.suggestedHostId,
    monitorIds: suggestion.suggestedMonitorIds,
  })

  // 验证既有字段完全保留，新增 hostId 与 monitorIds
  assert.equal(updatedCustom.provider, 'Amazon')
  assert.equal(updatedCustom.datacenter, 'us-west-2')
  assert.equal(updatedCustom.hostId, 'aws')
  assert.deepEqual(updatedCustom.monitorIds, [101, 102])

  // 4. 更新到 form 并提交 payload
  const updatedForm = { ...f, custom: updatedCustom }
  const payload = buildPayload(updatedForm, '')
  assert.equal(payload.custom.hostId, 'aws')
  assert.deepEqual(payload.custom.monitorIds, [101, 102])
  assert.equal(payload.custom.provider, 'Amazon')

  // 5. 填入后，再次检测 hint，因为已经匹配绑定，不再重复提示
  const hintAfter = getSuggestHint(f.name, f.location, hosts, monitors, updatedCustom)
  assert.equal(hintAfter, null)
})

test('formatHostStats：格式化主机 CPU、内存、负载与离线状态', () => {
  const host = {
    id: 'aws',
    label: 'AWS 节点',
    note: '',
    online: true,
    staleSec: 10,
    cpu_pct: 12.34,
    mem: {
      total_kb: 2097152,
      avail_kb: 1048576,
      used_pct: 50.0,
    },
    load: [0.15, 0.22, 0.35],
    series: [],
  } as any

  const stats = formatHostStats(host)
  assert.equal(stats.cpu, '12.3%')
  assert.equal(stats.memory, '50.0%')
  assert.equal(stats.load, '0.15 0.22 0.35')
  assert.equal(stats.statusTag, 'online')

  // 空值兜底
  const emptyHost = { id: 'test', label: '测试', note: '', online: false, staleSec: null, series: [] } as any
  const emptyStats = formatHostStats(emptyHost)
  assert.equal(emptyStats.cpu, '—')
  assert.equal(emptyStats.memory, '—')
  assert.equal(emptyStats.load, '—')
  assert.equal(emptyStats.statusTag, 'offline')
})

test('formatMonitorStatus：格式化观测项状态码、延迟与可用率', () => {
  const monUp = {
    id: 1,
    name: 'web',
    group: 'aws',
    type: 'http',
    status: 1,
    ping: 45,
    uptime24: 0.9998,
    active: true,
  } as any

  const s1 = formatMonitorStatus(monUp)
  assert.equal(s1.badge, 'UP')
  assert.equal(s1.ping, '45 ms')
  assert.equal(s1.uptime, '100%')

  const monDown = {
    id: 2,
    name: 'api',
    group: 'aws',
    type: 'http',
    status: 0,
    ping: null,
    uptime24: 0.954,
    active: true,
  } as any

  const s2 = formatMonitorStatus(monDown)
  assert.equal(s2.badge, 'DOWN')
  assert.equal(s2.ping, '—')
  assert.equal(s2.uptime, '95.4%')

  const monPending = {
    id: 3,
    name: 'worker',
    group: 'aws',
    type: 'port',
    status: 2,
    ping: null,
    uptime24: null,
    active: false,
  } as any

  const s3 = formatMonitorStatus(monPending)
  assert.equal(s3.badge, 'PENDING')
  assert.equal(s3.ping, '—')
  assert.equal(s3.uptime, '—')
})
