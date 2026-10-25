// 远程备份配置的规整（server/backup/remote.ts 的 normalizeConfig）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeConfig, DEFAULT_TABLE } from '../../server/backup/remote.js'

test('默认端口按类型给：MySQL 3306 / PostgreSQL 5432', () => {
  assert.equal(normalizeConfig({ host: 'h', database: 'd', user: 'u' }).port, 3306)
  assert.equal(normalizeConfig({ type: 'postgres', host: 'h', database: 'd', user: 'u' }).port, 5432)
})

test('表名缺省用 pinfolio_backups', () => {
  assert.equal(normalizeConfig({ host: 'h', database: 'd', user: 'u' }).table, DEFAULT_TABLE)
})

test('地址 / 库名 / 用户名不能为空', () => {
  assert.throws(() => normalizeConfig({ database: 'd', user: 'u' }), /地址不能为空/)
  assert.throws(() => normalizeConfig({ host: 'h', user: 'u' }), /库名不能为空/)
  assert.throws(() => normalizeConfig({ host: 'h', database: 'd' }), /用户名不能为空/)
})

test('表名只允许字母数字下划线（防注入）', () => {
  assert.throws(() => normalizeConfig({ host: 'h', database: 'd', user: 'u', table: 'a;drop table x' }), /表名/)
  assert.throws(() => normalizeConfig({ host: 'h', database: 'd', user: 'u', table: '1abc' }), /表名/)
})

test('端口必须是 1..65535 的整数', () => {
  assert.throws(() => normalizeConfig({ host: 'h', database: 'd', user: 'u', port: 0 }), /端口/)
  assert.throws(() => normalizeConfig({ host: 'h', database: 'd', user: 'u', port: 70000 }), /端口/)
  assert.equal(normalizeConfig({ host: 'h', database: 'd', user: 'u', port: 3307 }).port, 3307)
})
