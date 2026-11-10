import { test } from 'node:test'
import assert from 'node:assert/strict'
import { injectDemoPrefs, isCacheablePath } from '../../server/static.js'

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

/* ---------- 演示站缺省外观注入 ---------- */

const SHELL = '<!doctype html><html lang="zh-CN"><head><title>pinfolio</title></head><body><div id="root"></div></body></html>'

test('injectDemoPrefs: 普通实例（null）原样返回', () => {
  assert.equal(injectDemoPrefs(SHELL, null), SHELL)
})

test('injectDemoPrefs: 演示站把三个缺省值写进 <head>', () => {
  const out = injectDemoPrefs(SHELL, { style: 'glass', refract: 'on', wallpaper: 'wallpapers/street.jpg' })
  assert.match(out, /<script>window\.__PINBOARD_DEMO_PREFS__ = \{/)
  assert.match(out, /"refract":"on"/)
  // 脚本必须在 </head> 之前：首帧之前执行，否则会先按暖纸画一帧
  assert.ok(out.indexOf('__PINBOARD_DEMO_PREFS__') < out.indexOf('</head>'))
  assert.equal(out.includes('<div id="root">'), true, '壳的其余部分不动')
})

test('injectDemoPrefs: 地址里的尖括号被转义，不会切断脚本块', () => {
  const out = injectDemoPrefs(SHELL, { style: 'glass', refract: 'off', wallpaper: '</script><script>alert(1)</script>' })
  assert.equal(out.includes('</script><script>alert(1)'), false)
  assert.match(out, /\\u003c\/script>/)
})

test('injectDemoPrefs: 不是我们那份壳（没有 </head>）就不注入', () => {
  assert.equal(injectDemoPrefs('<html><body>hi</body></html>', { style: 'glass', refract: 'on', wallpaper: 'a.jpg' }), '<html><body>hi</body></html>')
})
