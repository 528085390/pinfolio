// 服务页的增删改纯逻辑（server/services/edit.ts）
// 运行：pnpm test:unit
import test from 'node:test'
import assert from 'node:assert/strict'
import type { ServicesData } from '../../server/services/parse.js'
import {
  addDeploy,
  addServer,
  addService,
  deployKey,
  mergeMonitorNames,
  patchDeploy,
  patchServer,
  patchService,
  removeDeploy,
  removeServer,
  removeService,
  splitDeployKey,
} from '../../server/services/edit.js'

function base(): ServicesData {
  return {
    servers: [
      { id: 'local', name: '本机', vendor: '本机', ip: '127.0.0.1', user: 'huang', monitors: [1] },
      { id: 'srv1', name: 'srv1', vendor: '阿里云 · 北京', ip: '203.0.113.10', user: 'admin', monitors: [] },
    ],
    services: [
      { id: 'wbapi', name: '网关 API', kind: 'project', summary: 'WorkBuddy 网关' },
      { id: 'nginx', name: 'Nginx', kind: 'site', summary: '站点' },
    ],
    deploys: [
      {
        server: 'local',
        service: 'wbapi',
        path: 'E:/wbapi',
        runtime: '计划任务 WorkBuddyServices',
        port: '7863',
        monitor: [1],
        url: 'http://127.0.0.1:7863',
      },
    ],
    monitors: { '1': 'WorkBuddy 网关 API（7863）' },
  }
}

function okOf(r: ReturnType<typeof addServer>): ServicesData {
  if (!r.ok) throw new Error('本来应该成功，却报了：' + r.error)
  return r.data
}

function errOf(r: ReturnType<typeof addServer>): string {
  if (r.ok) throw new Error('本来应该被拒绝，却成功了')
  return r.error
}

// ---------- 服务器 ----------

test('addServer：加一台，观测项规整；重复 id（不分大小写）与非法 id 都拒绝', () => {
  const d = okOf(addServer(base(), { id: 'Srv2', name: '第二台', vendor: 'AWS · 俄勒冈', ip: '1.2.3.4', user: 'ec2-user', monitors: ['3', 3, 2] }))
  assert.equal(d.servers.length, 3)
  assert.deepEqual(d.servers[2], {
    id: 'srv2',
    name: '第二台',
    vendor: 'AWS · 俄勒冈',
    ip: '1.2.3.4',
    user: 'ec2-user',
    note: undefined,
    doc: undefined,
    monitors: [2, 3],
  })
  // 原来那些不动
  assert.equal(d.servers[0].id, 'local')

  assert.match(errOf(addServer(base(), { id: 'LOCAL', name: '重名' })), /已经有这台服务器：local/)
  assert.match(errOf(addServer(base(), { id: 'bad id', name: 'x' })), /id 只能用字母、数字/)
  assert.match(errOf(addServer(base(), { id: 'x2', name: '  ' })), /名字/)
  assert.match(errOf(addServer(base(), { id: 'x3', name: 'x', monitors: [0] })), /观测项 id 只能是正整数/)
})

test('patchServer：改名不动部署；改 id 把部署一起指过去；撞别人的 id 拒绝', () => {
  const renamed = okOf(patchServer(base(), 'local', { name: '本机（改过）' }))
  assert.equal(renamed.servers[0].name, '本机（改过）')
  assert.equal(renamed.deploys[0].server, 'local')
  assert.equal(renamed.deploys[0].path, 'E:/wbapi')

  const moved = okOf(patchServer(base(), 'local', { id: 'me' }))
  assert.equal(moved.servers[0].id, 'me')
  // 部署跟着改，否则那条部署会指向不存在的服务器（parse 会整条丢掉）
  assert.equal(moved.deploys[0].server, 'me')
  assert.equal(moved.deploys[0].service, 'wbapi')

  assert.match(errOf(patchServer(base(), 'local', { id: 'srv1' })), /已经有这台服务器：srv1/)
  assert.match(errOf(patchServer(base(), 'ghost', { name: 'x' })), /没有这台服务器：ghost/)
  // 只改传上来的字段：没传的 ip / user 保持原样
  const partial = okOf(patchServer(base(), 'srv1', { note: '新备注' }))
  assert.equal(partial.servers[1].ip, '203.0.113.10')
  assert.equal(partial.servers[1].note, '新备注')
})

test('removeServer：上面还有部署就拒绝，删干净了才许删', () => {
  const blocked = errOf(removeServer(base(), 'local'))
  assert.match(blocked, /「本机」上还有 1 条部署（网关 API）/)
  assert.match(blocked, /先删它们再删服务器/)
  // 空机器能删
  const d = okOf(removeServer(base(), 'srv1'))
  assert.deepEqual(d.servers.map((s) => s.id), ['local'])
  assert.match(errOf(removeServer(d, 'srv1')), /没有这台服务器：srv1/)
})

// ---------- 服务 ----------

test('addService / patchService：种类写错报错，合法种类能改；改 id 部署跟着走', () => {
  const d = okOf(addService(base(), { id: 'immich', name: 'Immich 图库', kind: 'service', summary: '照片备份' }))
  assert.equal(d.services.length, 3)
  assert.equal(d.services[2].kind, 'service')
  // 不写种类就是 service
  assert.equal(okOf(addService(base(), { id: 'x', name: 'x' })).services[2].kind, 'service')

  assert.match(errOf(addService(base(), { id: 'y', name: 'y', kind: 'nope' })), /种类只能是 project \/ service \/ site \/ script \/ task/)
  assert.match(errOf(addService(base(), { id: 'WBAPI', name: '重名' })), /已经有这个服务：wbapi/)

  const kind = okOf(patchService(base(), 'nginx', { kind: 'service' }))
  assert.equal(kind.services[1].kind, 'service')
  assert.equal(kind.services[1].name, 'Nginx')

  const moved = okOf(patchService(base(), 'wbapi', { id: 'gateway' }))
  assert.equal(moved.deploys[0].service, 'gateway')
  assert.equal(moved.deploys[0].server, 'local')

  assert.match(errOf(patchService(base(), 'ghost', { name: 'x' })), /没有这个服务：ghost/)
})

test('removeService：还部署着就拒绝，并列出是哪几台机', () => {
  const blocked = errOf(removeService(base(), 'wbapi'))
  assert.match(blocked, /「网关 API」还部署在 1 台机器上（本机）/)
  assert.match(blocked, /先删这些部署再删服务/)
  assert.deepEqual(okOf(removeService(base(), 'nginx')).services.map((s) => s.id), ['wbapi'])
})

// ---------- 部署 ----------

test('deployKey / splitDeployKey：一对 id 当 key 用', () => {
  assert.equal(deployKey({ server: 'local', service: 'wbapi' }), 'local:wbapi')
  assert.deepEqual(splitDeployKey('local:wbapi'), { server: 'local', service: 'wbapi' })
  // 大小写与空格都抹平
  assert.deepEqual(splitDeployKey(' Local : WBAPI '), { server: 'local', service: 'wbapi' })
  assert.deepEqual(splitDeployKey('nocolon'), { server: '', service: '' })
})

test('addDeploy：正常加一条；重复的一对、没路径、没这台机、坏 URL 都拒绝', () => {
  const d = okOf(addDeploy(base(), {
    server: 'srv1',
    service: 'nginx',
    path: '/etc/nginx',
    runtime: 'systemd nginx',
    port: '443',
    url: 'https://203.0.113.10/',
    monitor: [5],
    note: '公网入口',
  }))
  assert.equal(d.deploys.length, 2)
  assert.deepEqual(d.deploys[1], {
    server: 'srv1',
    service: 'nginx',
    path: '/etc/nginx',
    runtime: 'systemd nginx',
    port: '443',
    monitor: [5],
    url: 'https://203.0.113.10/',
    note: '公网入口',
  })
  // 不传的可选字段落成 undefined，而不是 null
  const bare = okOf(addDeploy(base(), { server: 'srv1', service: 'nginx', path: '/opt/x', runtime: '' }))
  assert.equal(bare.deploys[1].port, undefined)
  assert.equal(bare.deploys[1].url, undefined)
  assert.equal(bare.deploys[1].note, undefined)

  assert.match(errOf(addDeploy(base(), { server: 'local', service: 'wbapi', path: '/x' })), /已经登记过了/)
  assert.match(errOf(addDeploy(base(), { server: 'srv1', service: 'nginx', path: '  ' })), /要填路径：这个服务在 srv1 上的绝对路径/)
  assert.match(errOf(addDeploy(base(), { server: 'ghost', service: 'nginx', path: '/x' })), /没有这台服务器：ghost/)
  assert.match(errOf(addDeploy(base(), { server: 'srv1', service: 'ghost', path: '/x' })), /没有这个服务：ghost/)
  assert.match(errOf(addDeploy(base(), { server: 'srv1', service: 'nginx', path: '/x', url: 'javascript:alert(1)' })), /管理页要写 http/)
  assert.match(errOf(addDeploy(base(), { server: '', service: 'nginx', path: '/x' })), /要选一台服务器/)
})

test('patchDeploy：只改传上来的字段；挪到已存在的一对上拒绝；key 不存在拒绝', () => {
  const d = okOf(patchDeploy(base(), 'local:wbapi', { path: 'E:/wbapi-v2', port: '7865' }))
  assert.equal(d.deploys[0].path, 'E:/wbapi-v2')
  assert.equal(d.deploys[0].port, '7865')
  // 没传的保持原样
  assert.equal(d.deploys[0].runtime, '计划任务 WorkBuddyServices')
  assert.deepEqual(d.deploys[0].monitor, [1])
  assert.equal(d.deploys[0].url, 'http://127.0.0.1:7863')
  // 清空 URL：传空串就是不填
  assert.equal(okOf(patchDeploy(base(), 'local:wbapi', { url: '' })).deploys[0].url, undefined)

  const two = okOf(addDeploy(base(), { server: 'srv1', service: 'nginx', path: '/etc/nginx' }))
  assert.match(errOf(patchDeploy(two, 'srv1:nginx', { server: 'local', service: 'wbapi' })), /已经登记过了/)
  assert.match(errOf(patchDeploy(base(), 'ghost:wbapi', { path: '/x' })), /没有这条部署：ghost:wbapi/)
})

test('removeDeploy：删掉那一条，别的都不动', () => {
  const d = okOf(removeDeploy(base(), 'local:wbapi'))
  assert.equal(d.deploys.length, 0)
  assert.equal(d.servers.length, 2)
  assert.equal(d.services.length, 2)
  assert.match(errOf(removeDeploy(d, 'local:wbapi')), /没有这条部署/)
})

// ---------- 观测项名字表 ----------

test('mergeMonitorNames：把选中项的名字并进文件自己的表', () => {
  const d = mergeMonitorNames(base(), { '1': '改过的名字', '5': '公网入口（443）', zero: '不是数字', '-2': '负数', '7': '   ' })
  assert.deepEqual(d.monitors, { '1': '改过的名字', '5': '公网入口（443）' })
  // 没有可改的就返回原对象（前端靠它判断要不要重渲染）
  const same = base()
  assert.equal(mergeMonitorNames(same, { '1': 'WorkBuddy 网关 API（7863）' }), same)
  assert.equal(mergeMonitorNames(same, {}), same)
  assert.equal(mergeMonitorNames(same, null), same)
})
