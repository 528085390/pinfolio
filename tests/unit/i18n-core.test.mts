import test from 'node:test'
import assert from 'node:assert/strict'
import { interpolate, pickLocale, translate, type Dict } from '../../shared/i18n/core.js'
import { en } from '../../shared/i18n/en/index.js'

// 双语内核的纯函数 + 英文字典的完整性。
// 字典那几条是"防手滑"用的：并行翻译时最容易犯的就是占位符写错（{n} 写成 {count}），
// 而那种错误在界面上只会安静地丢掉一个数字，不会报错。

test('interpolate：没有 vars 时原样返回', () => {
  assert.equal(interpolate('共 {n} 封'), '共 {n} 封')
})

test('interpolate：数字与字符串都能替换', () => {
  assert.equal(interpolate('共 {n} 封', { n: 3 }), '共 3 封')
  assert.equal(interpolate('{a} / {b}', { a: 'x', b: 'y' }), 'x / y')
})

test('interpolate：同一个占位符出现多次全部替换', () => {
  assert.equal(interpolate('{n}-{n}', { n: 7 }), '7-7')
})

test('interpolate：没给的占位符保留原样（不变成 undefined）', () => {
  assert.equal(interpolate('{a} 和 {b}', { a: 1 }), '1 和 {b}')
})

test('translate：中文永远回落到源码原文，但仍然插值', () => {
  const d: Dict = { '共 {n} 封': '{n} messages' }
  assert.equal(translate(d, 'zh', '共 {n} 封', { n: 2 }), '共 2 封')
})

test('translate：英文命中字符串条目并插值', () => {
  const d: Dict = { '共 {n} 封': '{n} messages' }
  assert.equal(translate(d, 'en', '共 {n} 封', { n: 2 }), '2 messages')
})

test('translate：英文命中函数条目（复数）时收到 vars', () => {
  const d: Dict = { '{n} 分钟前': (v) => (v.n === 1 ? '1 minute ago' : v.n + ' minutes ago') }
  assert.equal(translate(d, 'en', '{n} 分钟前', { n: 1 }), '1 minute ago')
  assert.equal(translate(d, 'en', '{n} 分钟前', { n: 5 }), '5 minutes ago')
})

test('translate：英文缺条目时回落中文原文', () => {
  assert.equal(translate({}, 'en', '共 {n} 封', { n: 9 }), '共 9 封')
})

test('pickLocale：没有请求头就是中文（源码语言）', () => {
  assert.equal(pickLocale(), 'zh')
  assert.equal(pickLocale(null), 'zh')
  assert.equal(pickLocale(''), 'zh')
})

test('pickLocale：zh / en 基本判定', () => {
  assert.equal(pickLocale('zh'), 'zh')
  assert.equal(pickLocale('zh-CN'), 'zh')
  assert.equal(pickLocale('en'), 'en')
  assert.equal(pickLocale('en-US,en;q=0.9'), 'en')
})

test('pickLocale：浏览器默认的 zh 优先串', () => {
  assert.equal(pickLocale('zh-CN,zh;q=0.9,en;q=0.8'), 'zh')
})

test('pickLocale：按 q 值取最高优先，不看先后顺序', () => {
  assert.equal(pickLocale('en;q=0.5,zh;q=0.9'), 'zh')
  assert.equal(pickLocale('zh;q=0.2,en;q=0.8'), 'en')
})

test('pickLocale：没见过的语言（fr 等）当英文', () => {
  assert.equal(pickLocale('fr-FR,fr;q=0.9'), 'en')
})

test('pickLocale：q 值写坏了就跳过那一段', () => {
  assert.equal(pickLocale('en;q=abc'), 'zh')
  assert.equal(pickLocale('en;q=abc,zh;q=0.1'), 'zh')
})

// ---- 英文字典完整性 ----

const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')

test('英文字典：没有空键、空译文', () => {
  const bad = Object.entries(en).filter(([k, v]) => !k.trim() || (typeof v === 'string' && !v.trim()))
  assert.deepEqual(bad, [], '空条目：' + JSON.stringify(bad.slice(0, 5)))
})

test('英文字典：字符串条目的占位符必须和中文原文一致', () => {
  const bad: string[] = []
  for (const [k, v] of Object.entries(en)) {
    if (typeof v !== 'string') continue
    if (holes(k) !== holes(v)) bad.push(k + ' → ' + v)
  }
  assert.deepEqual(bad, [], '占位符对不上：\n' + bad.join('\n'))
})

test('英文字典：函数条目在缺 vars 时也不抛错（返回字符串即可）', () => {
  for (const [k, v] of Object.entries(en)) {
    if (typeof v !== 'function') continue
    assert.equal(typeof v({}), 'string', '函数条目返回值不是字符串：' + k)
  }
})

test('英文字典：外壳与便签页的关键词已接上', () => {
  assert.equal(translate(en, 'en', '保存'), 'Save')
  assert.equal(translate(en, 'en', '便签'), 'Notes')
  assert.equal(translate(en, 'en', '设置'), 'Settings')
})

// ---- 跨字典一致性 ----
// 字典是扁平表，en/index.ts 按固定顺序合并，后合并的同名键会覆盖前面的。
// 并行翻译时两边都写「端口」这种通用词，一旦译文不同，界面上同一个词会随加载顺序变样。
// 这条测试按文件分别加载，把所有「同名键」的译文摆在一起比。

const CJK = /[\u3400-\u9fff]/

test('英文字典：译文里不能还留着中文', async () => {
  const bad: string[] = []
  for (const [k, v] of Object.entries(en)) {
    const out = typeof v === 'function' ? v({}) : v
    if (CJK.test(out)) bad.push(k + ' → ' + out)
  }
  assert.deepEqual(bad, [], '英文条目里还有中文：\n' + bad.slice(0, 10).join('\n'))
})

test('英文字典：同名键在多个文件里出现时，译文必须一致', async () => {
  const { readdirSync } = await import('node:fs')
  const { fileURLToPath, pathToFileURL } = await import('node:url')
  const { dirname, join } = await import('node:path')
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../../shared/i18n/en')
  const seen = new Map<string, { file: string; value: string }[]>()
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts') && x !== 'index.ts')) {
    const mod = await import(pathToFileURL(join(dir, f)).href)
    for (const [name, dict] of Object.entries(mod)) {
      if (!name || typeof dict !== 'object' || dict === null) continue
      for (const [k, v] of Object.entries(dict as Dict)) {
        const value = typeof v === 'function' ? v({}) : v
        const list = seen.get(k) ?? []
        list.push({ file: f, value: String(value) })
        seen.set(k, list)
      }
    }
  }
  const bad: string[] = []
  for (const [k, list] of seen) {
    if (list.length < 2) continue
    if (new Set(list.map((x) => x.value)).size > 1) {
      bad.push(k + ' → ' + list.map((x) => x.file + ':' + x.value).join(' | '))
    }
  }
  assert.deepEqual(bad, [], '同名键译文不一致：\n' + bad.slice(0, 10).join('\n'))
})

