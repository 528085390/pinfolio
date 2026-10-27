// 服务栏的数据文件解析（server/services/parse.ts）
// 运行：pnpm test:unit
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEPLOY_KINDS, MAX_DEPLOYS, MAX_SERVERS, parseServices } from '../../server/services/parse.js'

const good = {
  servers: [
    { id: 'os', name: 'os', vendor: 'Oracle · 东京', ip: '168.110.34.103', user: 'ubuntu', note: '照片库在这台', doc: 'E:\\services\\os', monitors: [125, '126', 125, 0, -3, 'x'] },
    { id: 'os', name: '重复 id 的会被丢掉', ip: '1.1.1.1' },
    { id: 'bad id', name: '非法 id', ip: '2.2.2.2' },
    { id: 'noName', ip: '3.3.3.3' },
    null,
    'not an object',
  ],
  services: [
    { id: 'immich', name: 'Immich 图库', kind: 'service', summary: '照片备份', doc: 'https://immich.app' },
    { id: 'xray', name: 'Xray', kind: 'whatever', summary: '种类写错退回 service' },
    { id: 'immich', name: '重复的丢掉' },
  ],
  deploys: [
    { server: 'os', service: 'immich', path: '/srv/immich', runtime: 'docker compose', port: '2283', url: 'http://168.110.34.103:2283', note: '不参与观测', autostart: true },
    { server: 'os', service: 'xray', path: '/etc/xray', runtime: 'systemd xray', monitor: ['443', 443, 12], url: 'javascript:alert(1)', autostart: false },
    { server: 'os', service: 'ghost', path: '/x', runtime: 'x' },
    { server: 'ghost', service: 'immich', path: '/y', runtime: 'y' },
  ],
  monitors: { '24': '抖音续火花（每日打卡）', '126': 'os / 代理端口 443（TCP）', zero: '不是数字', '0': '零', '-1': '负', '5': '  ' },
}

test('parseServices：正常数据原样过，坏条目逐条丢掉而不是整份报错', () => {
  const d = parseServices(good)
  // 重复 id / 非法 id / 没名字 / 非对象 的服务器都丢掉
  assert.deepEqual(d.servers.map((s) => s.id), ['os'])
  assert.equal(d.servers[0].note, '照片库在这台')
  assert.equal(d.servers[0].doc, 'E:\\services\\os')
  // 观测项 id：字符串也认、去重、排序，0 / 负数 / 非数字丢掉
  assert.deepEqual(d.servers[0].monitors, [125, 126])
  // 服务：重复丢掉，kind 写错退回 service
  assert.deepEqual(d.services.map((s) => s.id), ['immich', 'xray'])
  assert.equal(d.services[1].kind, 'service')
  assert.ok(DEPLOY_KINDS.includes(d.services[0].kind))
  // 部署：指向没登记的服务器 / 服务的丢掉
  assert.equal(d.deploys.length, 2)
  assert.deepEqual(d.deploys[0], {
    server: 'os',
    service: 'immich',
    path: '/srv/immich',
    runtime: 'docker compose',
    port: '2283',
    monitor: [],
    url: 'http://168.110.34.103:2283',
    note: '不参与观测',
    autostart: true,
  })
  assert.equal(d.deploys[1].autostart, undefined)
})

test('parseServices：管理页只认 http(s)，观测 id 去重排序', () => {
  const d = parseServices(good)
  const xray = d.deploys[1]
  assert.equal(xray.url, undefined) // javascript: 这种不许变成可点链接
  assert.deepEqual(xray.monitor, [12, 443]) // 字符串 443 与数字 443 合并
})

test('parseServices：monitors 表只留正整数键、非空名字', () => {
  const d = parseServices(good)
  assert.deepEqual(Object.keys(d.monitors).sort(), ['126', '24'])
  assert.equal(d.monitors['24'], '抖音续火花（每日打卡）')
})

test('parseServices：字段类型不对就当没写（不抛错）', () => {
  const d = parseServices({
    servers: [
      { id: 'a', name: 'A机', ip: {}, user: [], note: null },
      { id: 'b', name: 123 },
    ],
    services: [{ id: 'x', name: 'X', kind: 5, summary: [] }],
    deploys: [{ server: 'a', service: 'x', path: 1, runtime: null, monitor: 'nope', url: 7 }],
  })
  assert.deepEqual(d.servers.map((s) => s.id), ['a']) // name 不是字符串 → 没有可用标题，丢掉
  assert.equal(d.servers[0].ip, '')
  assert.equal(d.servers[0].note, undefined)
  assert.deepEqual(d.services.map((s) => s.name), ['X'])
  assert.equal(d.services[0].kind, 'service')
  assert.equal(d.services[0].summary, '')
  assert.deepEqual(d.deploys, [
    { server: 'a', service: 'x', path: '', runtime: '', port: undefined, monitor: [], url: undefined, note: undefined, autostart: undefined },
  ])
})

test('parseServices：整份不是对象 / 缺段都回空数据', () => {
  for (const bad of [null, undefined, 42, 'x', [], true]) {
    assert.deepEqual(parseServices(bad), { servers: [], services: [], deploys: [], monitors: {} })
  }
  assert.deepEqual(parseServices({}), { servers: [], services: [], deploys: [], monitors: {} })
  assert.deepEqual(parseServices({ servers: 'nope', deploys: 3 }).servers, [])
})

test('parseServices：条数上限挡垃圾（不是截断正常数据）', () => {
  const servers = Array.from({ length: MAX_DEPLOYS + 10 }, (_, i) => ({ id: 's' + i, name: 'S' + i }))
  const services = [{ id: 'x', name: 'X' }]
  const deploys = Array.from({ length: MAX_DEPLOYS + 10 }, () => ({ server: 's0', service: 'x', path: '/x', runtime: 'r' }))
  const d = parseServices({ servers, services, deploys })
  assert.equal(d.servers.length, MAX_SERVERS) // 超出上限的直接不读，不是报错
  assert.equal(d.deploys.length, MAX_DEPLOYS)
})
