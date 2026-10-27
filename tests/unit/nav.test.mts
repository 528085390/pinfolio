import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isInternalUrl } from '../../desktop/nav.js'

// 外链白名单（Task 7）：只有「本次启动的 pinfolio 回环地址」算站内，其余一律交给系统浏览器。
// 这里是纯函数，node --test 里能直接跑（不 import electron）。
//
// 为什么必须逐条钉死而不是「测个大概」：
// - 端口写错 → 用户点应用里的外链，窗口会被导航到外部站点（等于把应用窗口变成浏览器）；
// - 只比较字符串前缀 → `http://127.0.0.1:41234@evil.com` 这种 userinfo 伪装能骗过去；
// - 放行 file: / javascript: → 页面里的任意链接都能让主进程去 shell.openExternal 启动本机程序。

/** 测试固定端口：故意不用 7788（真机线上实例），避免「端口写死 7788 也能过」的假绿 */
const PORT = 41234

test('isInternalUrl：本站回环地址放行（127.0.0.1 / localhost，带不带路径都行）', () => {
  assert.equal(isInternalUrl('http://127.0.0.1:41234', PORT), true)
  assert.equal(isInternalUrl('http://127.0.0.1:41234/', PORT), true)
  assert.equal(isInternalUrl('http://127.0.0.1:41234/notes?q=1#n2', PORT), true)
  assert.equal(isInternalUrl('http://localhost:41234/', PORT), true)
  assert.equal(isInternalUrl('http://localhost:41234/api/notes', PORT), true)
})

test('isInternalUrl：大小写与首尾空白都归一（浏览器给的是规范 URL 也要认）', () => {
  assert.equal(isInternalUrl('HTTP://127.0.0.1:41234/Notes', PORT), true)
  assert.equal(isInternalUrl('HtTp://LocalHost:41234/', PORT), true)
  assert.equal(isInternalUrl('  http://127.0.0.1:41234/notes  ', PORT), true)
})

test('isInternalUrl：port 只认本次启动分配到的那个（7788 这种别的实例必须是 false）', () => {
  assert.equal(isInternalUrl('http://127.0.0.1:7788/', PORT), false)
  assert.equal(isInternalUrl('http://127.0.0.1:41235/', PORT), false)
  assert.equal(isInternalUrl('http://localhost:7788/', PORT), false)
  // 省略端口 = 80，不是我们
  assert.equal(isInternalUrl('http://127.0.0.1/', PORT), false)
  assert.equal(isInternalUrl('http://localhost:80/', PORT), false)
  // 端口传 0 / 非法值：一个都不放行（startServer 传 0 让系统分配，真实端口只从 handle 里拿）
  assert.equal(isInternalUrl('http://127.0.0.1:41234/', 0), false)
  assert.equal(isInternalUrl('http://127.0.0.1:41234/', Number.NaN), false)
  assert.equal(isInternalUrl('http://127.0.0.1:41234/', -1), false)
  assert.equal(isInternalUrl('http://127.0.0.1:41234/', 70000), false)
})

test('isInternalUrl：只认 http（https / file / javascript / data 全部 false）', () => {
  assert.equal(isInternalUrl('https://127.0.0.1:41234/', PORT), false)
  assert.equal(isInternalUrl('https://localhost:41234/', PORT), false)
  assert.equal(isInternalUrl('file:///C:/Windows/System32/cmd.exe', PORT), false)
  assert.equal(isInternalUrl('javascript:alert(document.cookie)', PORT), false)
  assert.equal(isInternalUrl('data:text/html,<script>alert(1)</script>', PORT), false)
  assert.equal(isInternalUrl('ws://127.0.0.1:41234/', PORT), false)
})

test('isInternalUrl：外部站点一律 false（含 example.com 与 127.0.0.1.evil.com）', () => {
  assert.equal(isInternalUrl('https://example.com', PORT), false)
  assert.equal(isInternalUrl('https://example.com/', PORT), false)
  assert.equal(isInternalUrl('http://example.com/', PORT), false)
  assert.equal(isInternalUrl('http://127.0.0.1.evil.com:41234/', PORT), false)
  assert.equal(isInternalUrl('http://localhost.evil.com:41234/', PORT), false)
  // 十进制写法会被 URL 归一成 127.0.0.1，端口不同照样 false
  assert.equal(isInternalUrl('http://2130706433:7788/', PORT), false)
})

test('isInternalUrl：userinfo 伪装必须 false（http://127.0.0.1:端口@evil.com）', () => {
  assert.equal(isInternalUrl('http://127.0.0.1:41234@evil.com/', PORT), false)
  assert.equal(isInternalUrl('http://127.0.0.1:41234@evil.com:41234/', PORT), false)
  assert.equal(isInternalUrl('http://localhost:41234@evil.com/', PORT), false)
  // 反过来带凭据访问本站也不算站内（应用里没有任何地方这么跳）
  assert.equal(isInternalUrl('http://user:pass@127.0.0.1:41234/', PORT), false)
})

test('isInternalUrl：about:blank 单独放行（Electron 开新窗口时的空地址）', () => {
  assert.equal(isInternalUrl('about:blank', PORT), true)
  assert.equal(isInternalUrl('about:srcdoc', PORT), false)
  assert.equal(isInternalUrl('about:blank#x', PORT), false)
})

test('isInternalUrl：空串 / 垃圾串 / 相对地址都不抛异常且为 false', () => {
  for (const bad of ['', '   ', 'not a url', '//127.0.0.1:41234/', '/notes', 'http://']) {
    assert.equal(isInternalUrl(bad, PORT), false, `应判为外链：${JSON.stringify(bad)}`)
  }
})

test('isInternalUrl：一张表钉死放行集合（防止「永远为真」的假测试）', () => {
  const table: Array<[string, boolean]> = [
    ['http://127.0.0.1:41234/', true],
    ['http://127.0.0.1:41234/settings', true],
    ['https://example.com', false],
    ['http://127.0.0.1:41234.evil.com/', false],
    ['http://127.0.0.1:41234@evil.com/', false],
    ['file:///C:/x.txt', false],
    ['javascript:void(0)', false],
  ]
  const internal: string[] = []
  for (const [url, expected] of table) {
    assert.equal(isInternalUrl(url, PORT), expected, url)
    if (isInternalUrl(url, PORT)) internal.push(url)
  }
  // 放行的只有真的「127.0.0.1:41234」那两条，其余全被挡
  assert.equal(internal.length, 2, '放行集合应为 2 条：' + internal.join(', '))
})
