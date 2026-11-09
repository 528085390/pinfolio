import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isCacheablePath } from '../../server/static.js'

test('isCacheablePath: 哈希资源允许长缓存', () => {
  assert.equal(isCacheablePath('/assets/index-D7h.js'), true)
  assert.equal(isCacheablePath('/assets/vendor-82f.css'), true)
})

test('isCacheablePath: 壳与固定命名的元文件禁止长缓存', () => {
  assert.equal(isCacheablePath('/index.html'), false)
  assert.equal(isCacheablePath('/favicon.ico'), false)
  assert.equal(isCacheablePath('/robots.txt'), false)
  assert.equal(isCacheablePath('/manifest.webmanifest'), false)
  assert.equal(isCacheablePath('/icons/icon-192.png'), false)
  assert.equal(isCacheablePath('/apple-touch-icon.png'), false)
  // 壁纸允许用户拿同名文件直接覆盖，长缓存会让换图不生效
  assert.equal(isCacheablePath('/wallpapers/street.jpg'), false)
})
