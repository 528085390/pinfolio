// 设置页「出站模式」卡片的**渲染态**断言（task-8 复评 I-2：这一态原来没有任何已提交测试）
//
// 为什么要有这个文件：Task 8 的 SSR 冒烟是临时脚本、跑完就删了，于是「把 OutboundCard.tsx 的
// known = ob.cfg !== null 改成 known = true」这种变异在 18 条纯逻辑单测下**全绿** —— 而后果是
// GET 还没回来（或失败）时界面直接谎报「出站：直连」，用户点一下保存就把真实全局出站切成直连。
// 纯逻辑测试看不到这个，因为 known / dim / disabled 都是渲染时才算的。
//
// 做法（在 node --test 里真挂真组件）：
//   - 用 vite 的 ssrLoadModule 加载**真正的** web/pages/settings/OutboundCard.tsx（含 JSX / lucide 图标 /
//     i18n），再用 react-dom/server 的 renderToStaticMarkup 出一份 HTML —— 与浏览器里同一份渲染代码；
//   - 第一态（cfg=null）用**真 hook**：useEffect 在 SSR 不执行，正好就是「GET 未返回」那一态；
//   - 第二态（cfg=mode:proxy）需要 useOutbound 有状态，这里用一个 vite 插件把组件对 './useOutbound' 的
//     引用换成一个返回固定 state 的桩模块 —— 组件本身（known / dim / disabled / 掩码占位）全是真代码，
//     只有「状态从哪来」被换掉。
//
// 运行：node --import tsx --test tests/unit/*.test.mts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer, type Plugin } from 'vite'
import { formFromCfg } from '../../web/pages/settings/outbound.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CARD = '/web/pages/settings/OutboundCard.tsx'
const STUB_ID = '\u0000stub-use-outbound'

/** 卡片要的状态（useOutbound 的返回值里，渲染真正用到的那几个字段） */
type CardState = {
  cfg: any
  pending: any
  msg: string
  err: string
  busy: '' | 'save' | 'test'
}

/** 把组件对 './useOutbound' 的引用换成「返回固定 state」的桩（组件本身不动） */
function stubHook(state: CardState): Plugin {
  return {
    name: 'outbound-card-state-stub',
    enforce: 'pre',
    resolveId(id: string, importer?: string) {
      if (id !== './useOutbound') return null
      const from = (importer ?? '').split('\\').join('/')
      return from.endsWith('/web/pages/settings/OutboundCard.tsx') ? STUB_ID : null
    },
    load(id: string) {
      if (id !== STUB_ID) return null
      return 'const state = ' + JSON.stringify(state) + '\nexport function useOutbound() { return state }\n'
    },
  }
}

/** 真挂 OutboundCard，返回 SSR 出来的 HTML。state=null 用真 hook（= GET 未返回那一态）。 */
async function renderCard(state: CardState | null): Promise<string> {
  const server = await createServer({
    root: ROOT,
    configFile: false, // 不加载仓库的 vite.config（root 会变成 web/，而且这里不需要 dev server 配置）
    logLevel: 'error',
    plugins: state ? [stubHook(state)] : [],
    server: { middlewareMode: true },
    appType: 'custom',
  })
  try {
    const mod: any = await server.ssrLoadModule(CARD)
    return renderToStaticMarkup(createElement(mod.OutboundCard))
  } finally {
    await server.close()
  }
}

/** HTML 里的每一个 button，切成「属性串 + 内部 HTML」 */
function buttons(html: string): Array<{ attrs: string; body: string }> {
  const out: Array<{ attrs: string; body: string }> = []
  const parts = html.split('<button')
  for (let i = 1; i < parts.length; i += 1) {
    const seg = parts[i]
    const end = seg.indexOf('</button>')
    const body = end === -1 ? seg : seg.slice(0, end)
    const gt = body.indexOf('>')
    out.push({ attrs: body.slice(0, gt), body: body.slice(gt + 1) })
  }
  return out
}

/** 按按钮上的文字取那一枚（必须正好一枚，取不到就说明界面变样了） */
function button(html: string, label: string): { attrs: string; body: string } {
  const hits = buttons(html).filter((b) => b.body.includes(label))
  assert.equal(hits.length, 1, '按「' + label + '」找到 ' + hits.length + ' 枚按钮（应为 1）')
  return hits[0]
}

/** 取带某个属性的那个标签的完整开标签（例如 id="ob-host" 所在的 <input …>） */
function tagOf(html: string, attr: string): string {
  const i = html.indexOf(attr)
  assert.ok(i >= 0, 'HTML 里找不到 ' + attr)
  const start = html.lastIndexOf('<', i)
  const end = html.indexOf('>', i)
  return html.slice(start, end + 1)
}

const PROXY_CFG = {
  mode: 'proxy' as const,
  proxy: { protocol: 'socks5h' as const, host: '127.0.0.1', port: 10808, username: 'u', hasPassword: true },
  changedAt: null as string | null,
}

test('渲染态 · cfg=null（GET 未返回 / 失败）：不高亮、不谎报「出站：直连」、保存与测试都禁用', async () => {
  const html = await renderCard(null)

  // 挂的是真组件，不是假的 DOM
  assert.ok(html.includes('card sec-card'))
  assert.ok(html.includes('出站模式'))

  // ① 模式不高亮：还没读到，不许假装知道现在是哪一种
  assert.equal(/chip active/.test(html), false, 'cfg=null 时不许有 chip active（模式高亮 = 谎报当前态）')

  // ② 摘要写「正在读取」，绝不能写「出站：直连」
  assert.ok(html.includes('正在读取出站设置…'), '摘要应是「正在读取出站设置…」')
  assert.equal(html.includes('出站：直连'), false, 'cfg=null 时写「出站：直连」就是谎报（会诱导用户以为现在是直连）')

  // ③ 两枚写按钮必须带 disabled —— 否则点一下保存 = POST {mode:"direct"}，真实全局出站被切成直连
  assert.match(button(html, '保存').attrs, /disabled/, 'cfg=null 时「保存」必须禁用')
  assert.match(button(html, '测试连通').attrs, /disabled/, 'cfg=null 时「测试连通」必须禁用')

  // ④ 表单也是灰的，并且给一句「为什么点不了」
  assert.match(tagOf(html, 'id="ob-host"'), /disabled/)
  assert.match(tagOf(html, 'id="ob-protocol"'), /disabled/)
  assert.match(tagOf(html, 'id="ob-password"'), /disabled/)
  assert.ok(html.includes('还没读取出站设置：保存与测试连通先禁用，免得把真实出站误切成直连'), '没读到时要说明按钮为什么是灰的')
})

test('渲染态 · cfg=proxy + hasPassword：高亮「经代理」、表单可编辑、密码框留空、保存可点', async () => {
  const cfg = PROXY_CFG
  const html = await renderCard({ cfg, pending: formFromCfg(cfg), msg: '', err: '', busy: '' })

  // ① 高亮在「经代理」这一枚上，且只有一枚 active
  assert.equal((html.match(/chip active/g) || []).length, 1, 'active 标记必须正好一枚')
  assert.match(button(html, '经代理').attrs, /chip active/)
  assert.equal(/chip active/.test(button(html, '直连').attrs), false)

  // ② 代理表单可编辑（没有 disabled）
  for (const id of ['ob-protocol', 'ob-port', 'ob-host', 'ob-username', 'ob-password']) {
    assert.equal(/disabled/.test(tagOf(html, 'id="' + id + '"')), false, id + ' 应该可编辑')
  }

  // ③ 密码掩码铁律：value 空 + 占位「已保存，留空表示不修改」，绝不回显
  const pw = tagOf(html, 'id="ob-password"')
  assert.match(pw, /value=""/, '已存密码时密码框必须留空')
  assert.ok(pw.includes('已保存，留空表示不修改'), '密码框占位应是「已保存，留空表示不修改」')
  assert.equal(/回显|saved-secret/.test(pw), false)

  // ④ 已知态：摘要说清当前出站、保存可以点、也不再显示「还没读取」的提示
  assert.ok(html.includes('出站：经代理 socks5h 127.0.0.1:10808'), '摘要要写清当前代理')
  assert.equal(/disabled/.test(button(html, '保存').attrs), false, '已知态「保存」不该禁用')
  assert.equal(/disabled/.test(button(html, '测试连通').attrs), false, '已知态「测试连通」不该禁用')
  assert.equal(html.includes('还没读取出站设置'), false, '已知态不该再提示「还没读取」')
})

test('渲染态 · 已知态 + busy：忙的时候两枚按钮仍然禁用（busy 与 known 是「或」的关系）', async () => {
  const cfg = PROXY_CFG
  const html = await renderCard({ cfg, pending: formFromCfg(cfg), msg: '', err: '', busy: 'save' })
  assert.match(button(html, '保存').attrs, /disabled/)
  assert.match(button(html, '测试连通').attrs, /disabled/)
  // 忙的时候不显示「还没读取」（那是另一码事），但表单与高亮照旧
  assert.match(button(html, '经代理').attrs, /chip active/)
  assert.equal(html.includes('还没读取出站设置'), false)
})
