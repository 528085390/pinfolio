import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scrubCss } from '../../web/components/mail-reader/css.js'

test('scrubCss：@import 整条删掉（外链样式不许进来）', () => {
  const out = scrubCss('@import url("http://x/y.css");\nbody { color: red }', false)
  assert.equal(out.includes('@import'), false)
  assert.ok(out.includes('color: red'))
})

test('scrubCss：expression() 改成无害的 none(', () => {
  assert.equal(scrubCss('width: expression(alert(1));', false), 'width: none(alert(1));')
})

test('scrubCss：javascript: 协议删掉', () => {
  assert.equal(scrubCss('background: url(javascript:alert(1))', false).includes('javascript:'), false)
})

test('scrubCss：behavior 与 -moz-binding 删掉', () => {
  const out = scrubCss('a { behavior: url(x.htc); -moz-binding: url(y.xml); color: blue }', false)
  assert.equal(out.includes('behavior'), false)
  assert.equal(out.includes('-moz-binding'), false)
  assert.ok(out.includes('color: blue'))
})

test('scrubCss：fixed / sticky 定位改成 static（不然会盖住整个应用）', () => {
  assert.equal(scrubCss('position: fixed;', false), 'position:static;')
  assert.equal(scrubCss('position:sticky', false), 'position:static')
  assert.equal(scrubCss('position: absolute', false), 'position: absolute')
})

test('scrubCss：不允许远程图片时 http(s) 的 url() 全变 none', () => {
  assert.equal(scrubCss('background: url("https://t.example/p.gif")', false), 'background: none')
})

test('scrubCss：允许远程图片时保留 url()，但危险写法照样清', () => {
  const css = 'background: url("https://t.example/p.gif"); position: fixed; @import url(a.css);'
  const out = scrubCss(css, true)
  assert.ok(out.includes('https://t.example/p.gif'))
  assert.equal(out.includes('position: fixed'), false)
  assert.equal(out.includes('@import'), false)
})
