// 资产与主机/观测项联动逻辑纯函数单元测试
// 运行：pnpm test:unit
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseAssetTelemetry,
  mergeAssetTelemetry,
  suggestTelemetry,
  findAssetsForHost,
  findAssetsForMonitor,
} from '../../web/lib/telemetry-link.js'

test('parseAssetTelemetry：兜底与容错', () => {
  assert.deepEqual(parseAssetTelemetry(null), { hostId: null, monitorIds: [] })
  assert.deepEqual(parseAssetTelemetry(undefined), { hostId: null, monitorIds: [] })
  assert.deepEqual(parseAssetTelemetry('string'), { hostId: null, monitorIds: [] })
  assert.deepEqual(parseAssetTelemetry(123), { hostId: null, monitorIds: [] })
  assert.deepEqual(parseAssetTelemetry([]), { hostId: null, monitorIds: [] })
  assert.deepEqual(parseAssetTelemetry({}), { hostId: null, monitorIds: [] })
})

test('parseAssetTelemetry：hostId 规范化（trim、非字符串与空白回退 null）', () => {
  assert.deepEqual(parseAssetTelemetry({ hostId: 'aws' }), { hostId: 'aws', monitorIds: [] })
  assert.deepEqual(parseAssetTelemetry({ hostId: '  oj  ' }), { hostId: 'oj', monitorIds: [] })
  assert.deepEqual(parseAssetTelemetry({ hostId: '   ' }), { hostId: null, monitorIds: [] })
  assert.deepEqual(parseAssetTelemetry({ hostId: '' }), { hostId: null, monitorIds: [] })
  assert.deepEqual(parseAssetTelemetry({ hostId: 123 }), { hostId: null, monitorIds: [] })
  assert.deepEqual(parseAssetTelemetry({ hostId: null }), { hostId: null, monitorIds: [] })
})

test('parseAssetTelemetry：monitorIds 过滤、去重与正整数校验', () => {
  assert.deepEqual(parseAssetTelemetry({ monitorIds: [1, 2, 3] }), { hostId: null, monitorIds: [1, 2, 3] })
  assert.deepEqual(parseAssetTelemetry({ monitorIds: [1, 2, 2, 3, 1] }), { hostId: null, monitorIds: [1, 2, 3] })
  // 过滤非正整数（0、负数、浮点数、非数字）
  assert.deepEqual(
    parseAssetTelemetry({ monitorIds: [1, 0, -5, 3.14, 'abc', null, NaN, 4] }),
    { hostId: null, monitorIds: [1, 4] }
  )
  // 非数组 monitorIds 回退空数组
  assert.deepEqual(parseAssetTelemetry({ monitorIds: '1,2,3' }), { hostId: null, monitorIds: [] })
  assert.deepEqual(parseAssetTelemetry({ monitorIds: null }), { hostId: null, monitorIds: [] })
})

test('parseAssetTelemetry：同时解析 hostId 与 monitorIds', () => {
  const custom = { hostId: 'az', monitorIds: [10, 20, 10], ip: '1.2.3.4' }
  assert.deepEqual(parseAssetTelemetry(custom), { hostId: 'az', monitorIds: [10, 20] })
})

test('mergeAssetTelemetry：不改原对象，保留已有自定义字段', () => {
  const orig = { ip: '192.168.1.1', owner: 'admin' }
  const merged = mergeAssetTelemetry(orig, { hostId: 'aws' })

  assert.deepEqual(merged, { ip: '192.168.1.1', owner: 'admin', hostId: 'aws' })
  assert.equal((orig as any).hostId, undefined, '不应污染原对象')
})

test('mergeAssetTelemetry：合并 hostId 与 monitorIds', () => {
  const orig = { hostId: 'oj', monitorIds: [1], other: 42 }

  const next1 = mergeAssetTelemetry(orig, { hostId: 'aws' })
  assert.deepEqual(next1, { hostId: 'aws', monitorIds: [1], other: 42 })

  const next2 = mergeAssetTelemetry(orig, { monitorIds: [2, 3] })
  assert.deepEqual(next2, { hostId: 'oj', monitorIds: [2, 3], other: 42 })

  const next3 = mergeAssetTelemetry(orig, { hostId: null })
  assert.deepEqual(next3, { hostId: null, monitorIds: [1], other: 42 })
})

test('mergeAssetTelemetry：非法 custom 输入兜底为对象', () => {
  assert.deepEqual(mergeAssetTelemetry(null, { hostId: 'aws' }), { hostId: 'aws' })
  assert.deepEqual(mergeAssetTelemetry(undefined, { monitorIds: [5] }), { monitorIds: [5] })
})

test('suggestTelemetry：根据资产名称与位置精确/忽略大小写匹配主机', () => {
  const hosts = [
    { id: 'aws', label: 'AWS (俄勒冈)' },
    { id: 'az', label: 'Azure (美中)' },
    { id: 'oj', label: 'Oracle (东京)' },
  ]
  const monitors = [
    { id: 1, name: 'aws / V2Ray', group: 'aws (AWS · 俄勒冈)' },
    { id: 2, name: 'oj / Xray', group: 'oj (Oracle · 东京)' },
  ]

  // 名称匹配主机 id
  assert.deepEqual(suggestTelemetry('aws', '', hosts, monitors), {
    suggestedHostId: 'aws',
    suggestedMonitorIds: [1],
  })

  // 大小写不敏感
  assert.deepEqual(suggestTelemetry('AWS', '', hosts, monitors), {
    suggestedHostId: 'aws',
    suggestedMonitorIds: [1],
  })

  // 位置匹配主机 id
  assert.deepEqual(suggestTelemetry('My-Server', 'OJ', hosts, monitors), {
    suggestedHostId: 'oj',
    suggestedMonitorIds: [2],
  })

  // 资产位置或名称匹配主机 label
  assert.deepEqual(suggestTelemetry('Azure-Host', 'Azure (美中)', hosts, monitors), {
    suggestedHostId: 'az',
    suggestedMonitorIds: [],
  })
})

test('suggestTelemetry：根据主机或资产名称匹配关联观测项组', () => {
  const hosts = [{ id: 'aws', label: 'AWS' }]
  const monitors = [
    { id: 10, name: 'aws / V2Ray', group: 'aws (AWS · 俄勒冈)' },
    { id: 11, name: 'aws / Caddy', group: 'aws (AWS · 俄勒冈)' },
    { id: 20, name: 'oj / Xray', group: 'oj' },
  ]

  const res = suggestTelemetry('aws', '', hosts, monitors)
  assert.equal(res.suggestedHostId, 'aws')
  assert.deepEqual(res.suggestedMonitorIds, [10, 11])
})

test('suggestTelemetry：没有匹配项时返回空兜底', () => {
  const hosts = [{ id: 'aws', label: 'AWS' }]
  const monitors = [{ id: 1, name: 'aws / V2Ray', group: 'aws' }]

  const res = suggestTelemetry('Unknown-Asset', 'Nowhere', hosts, monitors)
  assert.deepEqual(res, {
    suggestedHostId: null,
    suggestedMonitorIds: [],
  })
})

test('findAssetsForHost：根据 custom.hostId 或名称反向匹配资产', () => {
  const assets = [
    { id: 1, name: '生产服务器', custom: { hostId: 'aws' } },
    { id: 2, name: 'AWS', custom: {} },
    { id: 3, name: 'oj', custom: { hostId: 'oj' } },
    { id: 4, name: '无匹配', custom: { hostId: 'az' } },
  ]

  const matches = findAssetsForHost('aws', assets)
  assert.deepEqual(matches, [
    { id: 1, name: '生产服务器' },
    { id: 2, name: 'AWS' },
  ])

  assert.deepEqual(findAssetsForHost('none', assets), [])
  assert.deepEqual(findAssetsForHost('aws', []), [])
})

test('findAssetsForMonitor：根据 custom.monitorIds 或监控项组名反向匹配资产', () => {
  const assets = [
    { id: 1, name: '网关机器', custom: { monitorIds: [10, 12] } },
    { id: 2, name: 'aws', custom: { monitorIds: [] } },
    { id: 3, name: '独立节点', custom: { monitorIds: [12] } },
    { id: 4, name: '其它资产', custom: { monitorIds: [99] } },
  ]

  // 按 monitorId 匹配 (10)
  assert.deepEqual(findAssetsForMonitor(10, 'other-group', assets), [
    { id: 1, name: '网关机器' },
  ])

  // 按 monitorGroup 剥离后的短组名匹配 (aws (AWS · 俄勒冈) -> aws)
  assert.deepEqual(findAssetsForMonitor(999, 'aws (AWS · 俄勒冈)', assets), [
    { id: 2, name: 'aws' },
  ])

  // 既包含 monitorId 又匹配 group 的资产去重
  const mixedAssets = [
    { id: 5, name: 'aws', custom: { monitorIds: [10] } },
  ]
  assert.deepEqual(findAssetsForMonitor(10, 'aws', mixedAssets), [
    { id: 5, name: 'aws' },
  ])
})
