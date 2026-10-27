// 观测项抽屉「出站模式」三选一的**渲染态**断言（task 12）
//
// 为什么要单独一个文件：三选一的高亮、以及「跟随全局（当前：…）」那句说明文字，
// 都是渲染时才算出来的 —— form.ts 的纯逻辑测试看不到它们。这里按 outbound-card-dom.test.mts
// 那套做法：用 vite 的 ssrLoadModule 加载**真正的** BasicSection.tsx（含 JSX / lucide / i18n），
// 再用 react-dom/server 出一份 HTML；只把 useOutbound 换成「返回固定 state」的桩，
// 组件本身（按钮 / 高亮 / 说明文字）全是真代码。
//
// 运行：node --import tsx --test tests/unit/*.test.mts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer, type Plugin } from 'vite'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SECTION = '/web/components/monitor-drawer/BasicSection.tsx'
const STUB_ID = '\u0000stub-use-outbound'

/** useOutbound 的返回值里，渲染真正用到的那几个字段 */
type OutboundState = { cfg: any; pending: any; msg: string; err: string; busy: '' }

function stubHook(state: OutboundState): Plugin {
  return {
    name: 'monitor-drawer-pin-state-stub',
    enforce: 'pre',
    resolveId(id: string, importer?: string) {
      if (id !== '../../pages/settings/useOutbound') return null
      const from = (importer ?? '').split('\\').join('/')
      return from.endsWith('/web/components/monitor-drawer/BasicSection.tsx') ? STUB_ID : null
    },
    load(id: string) {
      if (id !== STUB_ID) return null
      return 'const state = ' + JSON.stringify(state) + '\nexport function useOutbound() { return state }\n'
    },
  }
}

/** 真挂 BasicSection，返回 SSR 出来的 HTML。state=null 用真 hook（= GET 未返回 / 失败那一态） */
async function renderSection(outboundMode: 'follow' | 'direct' | 'proxy', state: OutboundState | null): Promise<string> {
  const server = await createServer({
    root: ROOT,
    configFile: false, // 不加载仓库 vite.config（root 会变成 web/，这里也不需要 dev server 配置）
    logLevel: 'error',
    plugins: state ? [stubHook(state)] : [],
    server: { middlewareMode: true },
    appType: 'custom',
  })
  try {
    const mod: any = await server.ssrLoadModule(SECTION)
    const form = {
      name: 'app-api', description: '', interval: 60, timeout: 20,
      maxretries: 0, retryInterval: 60, showMsg: false, outboundMode,
    }
    const m = { type: 'http', target: 'https://example.com/x', group: '', policy: null }
    return renderToStaticMarkup(createElement(mod.BasicSection, { form, setForm: () => {}, m }))
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

/** 三选一那三枚按钮（按固定顺序） */
const PIN_LABELS = ['跟随全局', '钉：直连', '钉：代理']

function pinButtons(html: string) {
  return buttons(html).filter((b) => PIN_LABELS.includes(b.body))
}

/**
 * 取「出站模式」那一格的 .field-hint 文本（task-12 C34）。
 * 精确比对整句，别用 html.includes：那种断言会被按钮文案本身满足，等于没测。
 */
function outboundHint(html: string): string {
  const start = html.indexOf('\u51fa\u7ad9\u6a21\u5f0f') // 出站模式
  assert.ok(start >= 0, 'HTML 里找不到「出站模式」这一格')
  const head = html.indexOf('<span class="field-hint">', start)
  assert.ok(head >= 0, '「出站模式」这一格没有 field-hint')
  const from = head + '<span class="field-hint">'.length
  const to = html.indexOf('</span>', from)
  return html.slice(from, to)
}

const PROXY_STATE: OutboundState = {
  cfg: { mode: 'proxy', proxy: { protocol: 'socks5h', host: '127.0.0.1', port: 10808, username: 'u', hasPassword: true }, changedAt: null },
  pending: {}, msg: '', err: '', busy: '',
}

test('渲染态：三选一正好三枚按钮，顺序 fixed（跟随全局 / 钉：直连 / 钉：代理）', async () => {
  const html = await renderSection('follow', null)
  const pins = pinButtons(html)
  assert.deepEqual(pins.map((b) => b.body), PIN_LABELS)
})

test('渲染态：高亮跟着 form.outboundMode 走，钉那一行只有一枚 on', async () => {
  for (const [mode, label] of [['follow', '跟随全局'], ['direct', '钉：直连'], ['proxy', '钉：代理']] as const) {
    const html = await renderSection(mode, null)
    const pins = pinButtons(html)
    const on = pins.filter((b) => /monitor-chip-btn on/.test(b.attrs))
    assert.equal(on.length, 1, mode + '：钉那一行只能有一枚高亮')
    assert.equal(on[0].body, label, mode + '：高亮落错按钮了')
  }
})

test('渲染态：读不到全局配置时说明文字降级成「跟随全局」，不带括号也不报错', async () => {
  const html = await renderSection('follow', null)
  // 精确比对那一行灰字本身（task-12 C34：原来用 html.includes('跟随全局')，被按钮文案满足，等于什么都没测）
  assert.equal(outboundHint(html), '跟随全局', 'cfg=null 时灰字应正好是「跟随全局」')
})

test('渲染态：读得到全局配置时说明文字写清当前出口（经代理 socks5h host:port，不含账号密码）', async () => {
  const html = await renderSection('follow', PROXY_STATE)
  assert.equal(outboundHint(html), '跟随全局（当前：经代理 socks5h 127.0.0.1:10808）', '说明文字逐字')
  assert.equal(html.includes('hasPassword'), false, '说明文字里不许漏出密码字段')
  assert.equal(html.includes('u@'), false, '用户名也不许漏')
})

test('渲染态：已经钉死时灰字改口（task-12 C31）——不再讲「跟随全局（当前：…）」', async () => {
  for (const pin of ['direct', 'proxy'] as const) {
    const html = await renderSection(pin, PROXY_STATE)
    assert.equal(outboundHint(html), '这一项已钉死，不吃上面的全局设置', pin + '：钉死态的灰字')
    assert.equal(outboundHint(html).includes('跟随全局'), false, pin + '：钉死时不许再讲「跟随全局」')
  }
})
