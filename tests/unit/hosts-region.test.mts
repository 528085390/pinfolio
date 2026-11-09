// 主机备注 → 厂商 / 机房 / 国旗 的纯逻辑（web/pages/hosts/region.ts）。
// 备注是自由文本，认不出来就返回空串，卡片上少个徽标，不要瞎猜。
// 运行：pnpm test:unit
import test from 'node:test'
import assert from 'node:assert/strict'
import { hostFlag, hostRegion, hostVendor } from '../../web/pages/hosts/region.js'

test('「厂商 · 机房」两段式：前段认厂商，后段原样当机房', () => {
  assert.equal(hostVendor('Oracle · 东京'), 'ORACLE')
  assert.equal(hostRegion('Oracle · 东京'), '东京')
  assert.equal(hostFlag('Oracle · 东京'), '🇯🇵')
})

test('备注带括注时把括注剥掉，不影响机房与国旗', () => {
  const note = 'Azure · 美中（WorkBuddy + 自建服务，2026-11-02 起）'
  assert.equal(hostVendor(note), 'AZURE')
  assert.equal(hostRegion(note), '美中')
  assert.equal(hostFlag(note), '🇺🇸')
  assert.equal(hostFlag('AWS · 俄勒冈'), '🇺🇸')
})

test('认不出来就返回空串（不显示错的徽标 / 国旗）', () => {
  assert.equal(hostVendor(''), '')
  assert.equal(hostRegion(''), '')
  assert.equal(hostFlag(''), '')
  assert.equal(hostVendor('某某机房'), '')
  assert.equal(hostFlag('某某机房'), '')
})
