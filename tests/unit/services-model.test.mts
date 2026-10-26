// 服务栏的纯逻辑（web/pages/services/model.ts）
// 数据来源解析在 services-parse.test.mts；这里只管分组 / 搜索 / 统计 / 点击目标
// 运行：pnpm test:unit
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  KIND_LABEL,
  deployTarget,
  deployTitle,
  filterServerGroups,
  filterServiceGroups,
  groupByServer,
  groupByService,
  kindRank,
  monitorLabel,
  summaryOf,
  type DeployRec,
  type ServerRec,
  type ServiceRec,
} from '../../web/pages/services/model.js'

const servers: ServerRec[] = [
  { id: 'a', name: 'a机', vendor: '某云 · 北京', ip: '1.1.1.1', user: 'root', monitors: [9, 3] },
  { id: 'b', name: 'b机', vendor: '某云 · 东京', ip: '2.2.2.2', user: 'root' },
]
const services: ServiceRec[] = [
  { id: 'x', name: 'Xray', kind: 'service', summary: '代理' },
  { id: 'n', name: 'Nginx', kind: 'site', summary: '站点' },
  { id: 'z', name: 'Zzz', kind: 'project', summary: '登记了但没部署' },
]
const deploys: DeployRec[] = [
  { server: 'a', service: 'x', path: '/etc/xray', runtime: 'systemd xray', port: '443', monitor: [7] },
  { server: 'a', service: 'n', path: '/etc/nginx', runtime: 'systemd nginx', monitor: [5, 6] },
  { server: 'b', service: 'x', path: '/usr/local/etc/xray', runtime: 'systemd xray', url: 'http://127.0.0.1:9000' },
  { server: 'b', service: 'ghost', path: '/x', runtime: 'x' }, // 指向不存在的服务
  { server: 'ghost', service: 'x', path: '/y', runtime: 'y' }, // 指向不存在的服务器
]

test('kindRank：按 项目 → 服务 → 站点 → 脚本 → 任务 排，未知种类垫底', () => {
  assert.equal(kindRank('project'), 0)
  assert.equal(kindRank('service'), 1)
  assert.equal(kindRank('site'), 2)
  assert.equal(kindRank('script'), 3)
  assert.equal(kindRank('task'), 4)
  assert.equal(kindRank('nope' as any), 5)
  assert.equal(KIND_LABEL.script, '脚本')
})

test('groupByServer：每台机一张卡，行按种类再按名字排，坏数据不抛错', () => {
  const groups = groupByServer(servers, services, deploys)
  assert.equal(groups.length, 2)
  assert.deepEqual(groups[0].rows.map((r) => r.svc.name), ['Xray', 'Nginx'])
  assert.equal(groups[0].rows[0].path, '/etc/xray')
  // 服务器级观测去重排序后单独给，不与行里的混在一起
  assert.deepEqual(groups[0].monitors, [3, 9])
  // 指向不存在的服务那条被丢掉，这台机只剩一条真部署
  assert.equal(groups[1].rows.length, 1)
  assert.deepEqual(groups[1].monitors, [])
})

test('groupByService：只有真部署过的服务才出卡，行按服务器名排', () => {
  const groups = groupByService(services, servers, deploys)
  assert.deepEqual(groups.map((g) => g.service.name), ['Xray', 'Nginx'])
  assert.deepEqual(groups[0].rows.map((r) => r.srv.name), ['a机', 'b机'])
  assert.equal(groups[0].rows[0].server, 'a')
})

test('搜索：服务器自己命中留整张卡，否则只留命中的行', () => {
  const groups = groupByServer(servers, services, deploys)
  const byServer = filterServerGroups(groups, 'b机')
  assert.equal(byServer.length, 1)
  assert.equal(byServer[0].rows.length, 1)

  const byRow = filterServerGroups(groups, 'nginx')
  assert.equal(byRow.length, 1)
  assert.deepEqual(byRow[0].rows.map((r) => r.svc.name), ['Nginx'])

  const byPort = filterServerGroups(groups, '443')
  assert.equal(byPort.length, 1)
  assert.deepEqual(byPort[0].rows.map((r) => r.svc.name), ['Xray'])

  // 管理页地址也在搜索范围里
  const byUrl = filterServerGroups(groups, '9000')
  assert.equal(byUrl.length, 1)
  assert.equal(byUrl[0].rows[0].server, 'b')

  assert.deepEqual(filterServerGroups(groups, '  '), groups)
  assert.deepEqual(filterServerGroups(groups, '不存在'), [])
})

test('搜索：服务视角同理（服务名命中留整卡，服务器名命中只留那台）', () => {
  const groups = groupByService(services, servers, deploys)
  const bySvc = filterServiceGroups(groups, 'xray')
  assert.equal(bySvc.length, 1)
  assert.equal(bySvc[0].rows.length, 2)

  const bySrv = filterServiceGroups(groups, 'b机')
  assert.equal(bySrv.length, 1)
  assert.equal(bySrv[0].service.id, 'x')
  assert.deepEqual(bySrv[0].rows.map((r) => r.srv.name), ['b机'])

  const byKind = filterServiceGroups(groups, '站点')
  assert.deepEqual(byKind.map((g) => g.service.name), ['Nginx'])
})

test('summaryOf：服务数只算部署过的，观测项按 id 去重', () => {
  const s = summaryOf(servers, services, deploys)
  assert.equal(s.servers, 2)
  assert.equal(s.services, 2) // Zzz 没部署，不算
  assert.equal(s.deploys, 5)
  assert.equal(s.linked, 2) // 只有前两条挂了观测
  assert.equal(s.manage, 1) // 只有 b 机那条填了管理页
  assert.equal(s.monitors, 5) // 7 / 5 / 6 + 服务器级 3 / 9
})

test('deployTarget：先观测后管理页，都没有就返回 null', () => {
  const base: DeployRec = { server: 'a', service: 'x', path: '/etc/xray', runtime: 'systemd xray' }
  // 两个都有时优先观测台
  assert.deepEqual(deployTarget({ ...base, monitor: [7, 8], url: 'http://127.0.0.1:9000' }), { kind: 'monitor', id: 7 })
  // 只有管理页：点名字打开它（抖音续火花面板这种没观测但能打开的服务）
  assert.deepEqual(deployTarget({ ...base, url: 'http://127.0.0.1:8765' }), { kind: 'url', url: 'http://127.0.0.1:8765' })
  // 空的 monitor 数组不算
  assert.deepEqual(deployTarget({ ...base, monitor: [], url: 'http://127.0.0.1:8765' }), { kind: 'url', url: 'http://127.0.0.1:8765' })
  // 都没有：点了不动
  assert.equal(deployTarget(base), null)
})

test('monitorLabel：查得到就用数据文件里的名字，查不到退回 id', () => {
  const labels = { '24': '抖音续火花（每日打卡）', '126': 'os / 代理端口 443（TCP）', '7': '   ' }
  assert.equal(monitorLabel(labels, 24), '抖音续火花（每日打卡）')
  assert.equal(monitorLabel(labels, 126), 'os / 代理端口 443（TCP）')
  assert.equal(monitorLabel(labels, 7), '观测项 7') // 空名字不算
  assert.equal(monitorLabel(labels, 999), '观测项 999')
  assert.equal(monitorLabel(undefined, 3), '观测项 3')
  assert.equal(monitorLabel(null, 3), '观测项 3')
})

test('deployTitle：紧凑视图的悬停提示——路径 / 启动·端口 / 观测 / 备注各占一行', () => {
  const base: DeployRec = { server: 'a', service: 'x', path: '/etc/xray', runtime: 'systemd xray' }
  assert.equal(deployTitle(base), '/etc/xray\nsystemd xray')
  assert.equal(
    deployTitle({ ...base, port: '443', note: '主用' }, ['Xray 代理服务', '代理端口 443（TCP）']),
    '/etc/xray\nsystemd xray · 443\n观测：Xray 代理服务、代理端口 443（TCP）\n主用',
  )
  // 管理页单占一行，排在观测后面、备注前面
  assert.equal(
    deployTitle({ ...base, url: 'http://127.0.0.1:8765', note: '手动启动' }),
    '/etc/xray\nsystemd xray\n管理页：http://127.0.0.1:8765\n手动启动',
  )
})


