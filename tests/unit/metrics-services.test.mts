// 主机上的服务 → 观测项的映射（server/metrics/services.ts）。
// host-services.json 里写「哪台机的哪个 unit 对应哪个观测项」，这里只做纯解析，不碰网络。
// 运行：pnpm test:unit
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  shortGroup, shortName, resolveUnitMonitors, loadServiceRules, removeServiceRules,
} from '../../server/metrics/services.js'

/* ---------------- 组名 / 观测项短名 ---------------- */

test('shortGroup：剥掉末尾括号里的厂商地区，没括号原样返回', () => {
  assert.equal(shortGroup('my-server (阿里云 · 北京)'), 'my-server')
  assert.equal(shortGroup('os（Oracle · 东京）'), 'os')
  assert.equal(shortGroup('  aws (AWS · 俄勒冈)  '), 'aws')
  assert.equal(shortGroup('oj'), 'oj')
  assert.equal(shortGroup(''), '')
})

test('shortName：去掉「组短名 / 」前缀，别的前缀不动', () => {
  assert.equal(shortName('my-server / Nginx 站点', 'my-server (阿里云 · 北京)'), 'Nginx 站点')
  assert.equal(shortName('Xray 代理服务', 'oj (Oracle · 东京)'), 'Xray 代理服务')
  assert.equal(shortName('aws2 / 别的', 'aws (AWS · 俄勒冈)'), 'aws2 / 别的')
})

/* ---------------- resolveUnitMonitors ---------------- */

const monitors = () => [
  { id: 5, name: 'my-server / Nginx 站点', group: 'my-server (阿里云 · 北京)' },
  { id: 6, name: 'my-server / MyApp 网关 API', group: 'my-server (阿里云 · 北京)' },
  { id: 7, name: 'os / sing-box 代理服务', group: 'os (Oracle · 东京)' },
  { id: 8, name: 'ox / sing-box 代理服务', group: 'ox (Oracle · 东京)' },
  { id: 9, name: 'aws / Xray 代理服务（主用）', group: 'aws (AWS · 俄勒冈)' },
  { id: 10, name: 'aws / V2Ray 服务（备用）', group: 'aws (AWS · 俄勒冈)' },
]

const rules = () => [
  { host: 'my-server', unit: 'nginx', match: 'Nginx' },
  { host: 'my-server', unit: 'app-api', match: '网关 API' },
  { host: 'os', unit: 'sing-box', match: 'sing-box' },
  { host: 'aws', unit: 'xray', match: 'Xray' },
]

test('resolveUnitMonitors：按主机分组 + 短名包含匹配，输出 unit → {id,name}', () => {
  assert.deepEqual(resolveUnitMonitors(rules(), 'my-server', monitors()), {
    nginx: { id: 5, name: 'my-server / Nginx 站点' },
    app-api: { id: 6, name: 'my-server / MyApp 网关 API' },
  })
})

test('resolveUnitMonitors：match 不分大小写', () => {
  const r = resolveUnitMonitors([{ host: 'os', unit: 'sing-box', match: 'SING-BOX' }], 'os', monitors())
  assert.deepEqual(r, { 'sing-box': { id: 7, name: 'os / sing-box 代理服务' } })
})

test('resolveUnitMonitors：只在本机分组里找，同名的别台观测项不算', () => {
  const r = resolveUnitMonitors([{ host: 'ox', unit: 'sing-box', match: 'sing-box' }], 'ox', monitors())
  assert.deepEqual(r, { 'sing-box': { id: 8, name: 'ox / sing-box 代理服务' } })
  // 只配了 os 的规则，去查 ox 应该空
  assert.deepEqual(resolveUnitMonitors(rules(), 'ox', monitors()), {})
})

test('resolveUnitMonitors：没有匹配就整条不出现（前端据此不可点）', () => {
  assert.deepEqual(resolveUnitMonitors(rules(), 'az', monitors()), {})
  assert.deepEqual(
    resolveUnitMonitors([{ host: 'my-server', unit: 'memwatch', match: 'Memwatch' }], 'my-server', monitors()),
    {},
  )
})

test('resolveUnitMonitors：monitor 按 id 精确匹配，忽略名字与分组', () => {
  const r = resolveUnitMonitors([{ host: 'az', unit: 'nginx', monitor: 5 }], 'az', monitors())
  assert.deepEqual(r, { nginx: { id: 5, name: 'my-server / Nginx 站点' } })
  // id 不存在 → 不出现
  assert.deepEqual(resolveUnitMonitors([{ host: 'az', unit: 'nginx', monitor: 999 }], 'az', monitors()), {})
})

test('resolveUnitMonitors：同一个 unit 配了多条时第一条赢', () => {
  const r = resolveUnitMonitors([
    { host: 'aws', unit: 'xray', match: 'V2Ray' },
    { host: 'aws', unit: 'xray', match: 'Xray' },
  ], 'aws', monitors())
  assert.deepEqual(r, { xray: { id: 10, name: 'aws / V2Ray 服务（备用）' } })
})

test('resolveUnitMonitors：形状不全的规则跳过，不抛错', () => {
  const r = resolveUnitMonitors([
    { host: 'os' } as any,
    { host: 'os', unit: 'x' } as any,
    { host: 'os', unit: 'y', match: '' } as any,
    null as any,
    { host: 'os', unit: 'sing-box', match: 'sing-box' },
  ], 'os', monitors())
  assert.deepEqual(Object.keys(r), ['sing-box'])
  assert.deepEqual(resolveUnitMonitors(null as any, 'os', monitors()), {})
})

/* ---------------- removeServiceRules ---------------- */

test('removeServiceRules：删掉这台机的映射（不分大小写），别人的保序不动', () => {
  const rules = [
    { host: 'my-server', unit: 'nginx', match: 'Nginx' },
    { host: 'AWS', unit: 'xray', match: 'Xray' },
    { host: 'aws', unit: 'caddy', match: 'Caddy' },
  ]
  assert.deepEqual(removeServiceRules(rules, 'aws'), [
    { host: 'my-server', unit: 'nginx', match: 'Nginx' },
  ])
  assert.deepEqual(removeServiceRules(rules, 'nope'), rules)
  assert.deepEqual(removeServiceRules(rules, ''), rules)
})

/* ---------------- loadServiceRules ---------------- */

test('loadServiceRules：读文件、trim、丢掉缺 host/unit 的条目', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pinboard-svc-'))
  const file = join(dir, 'host-services.json')
  writeFileSync(file, JSON.stringify([
    { host: ' my-server ', unit: ' nginx ', match: ' Nginx ' },
    { host: 'aws', unit: 'xray', monitor: '9' },
    { host: 'os' },
    { unit: 'sing-box' },
    'junk',
  ]), 'utf8')
  assert.deepEqual(loadServiceRules(file), [
    { host: 'my-server', unit: 'nginx', match: 'Nginx' },
    { host: 'aws', unit: 'xray', monitor: 9 },
  ])
})

test('loadServiceRules：文件不存在 / 不是数组 → 空表（没配置就不跳）', () => {
  assert.deepEqual(loadServiceRules(join(tmpdir(), 'pinboard-no-such-file.json')), [])
  const dir = mkdtempSync(join(tmpdir(), 'pinboard-svc2-'))
  const file = join(dir, 'bad.json')
  writeFileSync(file, '{ not json', 'utf8')
  assert.deepEqual(loadServiceRules(file), [])
})
