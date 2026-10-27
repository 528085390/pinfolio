import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getOfflineHtml, getOfflineDataUrl } from '../../desktop/offline-page.js'

test('getOfflineHtml：包含提示文本、目标地址与立即重试按钮', () => {
  const html = getOfflineHtml('http://127.0.0.1:7788')
  assert.ok(html.includes('http://127.0.0.1:7788'), '应包含目标地址')
  assert.ok(html.includes('等待连接网页端服务'), '应包含等待提示')
  assert.ok(html.includes('start.cmd'), '应提示启动 start.cmd')
  assert.ok(html.includes('立即重试'), '应包含立即重试按钮')
})

test('getOfflineHtml：目标地址特殊字符被转义', () => {
  const html = getOfflineHtml('http://127.0.0.1:7788/?x="test"')
  assert.ok(html.includes('&quot;test&quot;'), '双引号应被转义')
})

test('getOfflineDataUrl：返回合法的 data:text/html 地址', () => {
  const dataUrl = getOfflineDataUrl('http://127.0.0.1:7788')
  assert.ok(dataUrl.startsWith('data:text/html;charset=utf-8,'), '应为 data URL 前缀')
  assert.ok(dataUrl.includes(encodeURIComponent('http://127.0.0.1:7788')), '应包含编码后的 URL')
})
