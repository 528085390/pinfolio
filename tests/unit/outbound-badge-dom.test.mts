// 观测页「出站：…」徽标（task 14a）+ 卡片「钉：直连 / 钉：代理」小标签的**渲染态**断言
//
// 为什么要有这个文件：徽标的三种态（proxy / direct / 读不到）和卡片小标签的「follow 不渲染」
// 全是**渲染时**才算出来的 —— outbound.ts 的纯函数测试看不到「读不到时是不是真的一个字节都不渲染」。
// 做法照 outbound-card-dom.test.mts / monitor-drawer-pin-dom.test.mts：vite 的 ssrLoadModule
// 加载**真正的**组件（JSX / lucide / i18n 全真），react-dom/server 出一份 HTML；
// 唯一被换掉的是 useOutbound 的「状态从哪来」（桩里返回固定 state，组件本身不动）。
//
// 每条断言都要求「实现被改坏时会变红」，变异自检见 task-14a-report.md：
//   失败态也渲染 / follow 也挂钉死标签 / 文本丢掉协议 / 打上 hasPassword / 改写 title / 复用状态色块 class。
//
// 运行：node --import tsx --test tests/unit/outbound-badge-dom.test.mts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer, type Plugin } from 'vite'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BADGE = '/web/pages/monitors/OutboundBadge.tsx'
const CARD = '/web/pages/monitors/MonitorCard.tsx'
const STUB_ID = '\u0000stub-use-outbound'

/** useOutbound 的返回值里，徽标渲染真正用到的那几个字段 */
type BadgeState = { cfg: any; pending: any; msg: string; err: string; busy: '' }

/**
 * 把 OutboundBadge 对 '../settings/useOutbound' 的引用换成桩。
 * 桩从 globalThis 读当前 state，所以**一个 vite 实例就能渲染任意种态**（每次改 __badgeState 再 render）。
 */
function stubHook(): Plugin {
  return {
    name: 'outbound-badge-state-stub',
    enforce: 'pre',
    resolveId(id: string, importer?: string) {
      if (id !== '../settings/useOutbound') return null
      const from = (importer ?? '').split('\\').join('/')
      return from.endsWith('/web/pages/monitors/OutboundBadge.tsx') ? STUB_ID : null
    },
    load(id: string) {
      if (id !== STUB_ID) return null
      return 'export function useOutbound() { return globalThis.__badgeState }\n'
    },
  }
}

const g = globalThis as any

async function withServer<T>(plugins: Plugin[], fn: (load: (f: string) => Promise<any>) => Promise<T>): Promise<T> {
  const server = await createServer({
    root: ROOT,
    configFile: false, // 不加载仓库的 vite.config（root 会变成 web/，这里也不需要 dev server 配置）
    logLevel: 'error',
    plugins,
    server: { middlewareMode: true },
    appType: 'custom',
  })
  try {
    return await fn((f: string) => server.ssrLoadModule(f))
  } finally {
    await server.close()
  }
}

/** 用桩 state 渲染徽标（每种态一份 HTML） */
async function renderBadge(state: BadgeState): Promise<string> {
  return withServer([stubHook()], async (load) => {
    const mod: any = await load(BADGE)
    g.__badgeState = state
    return renderToStaticMarkup(createElement(mod.OutboundBadge))
  })
}

/** 不开桩：useEffect 在 SSR 里不执行，正好就是「GET 还没回来」那一态 */
async function renderBadgeWithRealHook(): Promise<string> {
  return withServer([], async (load) => {
    const mod: any = await load(BADGE)
    return renderToStaticMarkup(createElement(mod.OutboundBadge))
  })
}

/** 取 className 含 cls 的那个元素的开标签（整个 <div …> 字符串） */
function openTagOf(html: string, cls: string): string {
  const i = html.indexOf(cls)
  assert.ok(i >= 0, 'HTML 里找不到 class 含「' + cls + '」的元素：' + html)
  const start = html.lastIndexOf('<', i)
  const end = html.indexOf('>', i)
  return html.slice(start, end + 1)
}

/** 取 className 含 cls 的那个元素的**文本节点**（内部没有子标签时就是全部文字） */
function textOf(html: string, cls: string): string {
  const open = openTagOf(html, cls)
  const from = html.indexOf(open) + open.length
  const tag = /^<(\w+)/.exec(open)![1]
  const to = html.indexOf('</' + tag + '>', from)
  return html.slice(from, to)
}

const PROXY_CFG = {
  mode: 'proxy',
  // username / hasPassword 故意都给上：徽标一个字都不许漏出去
  proxy: { protocol: 'socks5h', host: '127.0.0.1', port: 10808, username: 'alice', hasPassword: true },
  changedAt: null,
}

const badgeState = (cfg: any, err = ''): BadgeState => ({ cfg, pending: {}, msg: '', err, busy: '' })

// ───────────────────────── 徽标 ─────────────────────────

test('徽标 · proxy 态：文本逐字「出站：经代理 socks5h 127.0.0.1:10808」，class 标成 is-proxy', async () => {
  const html = await renderBadge(badgeState(PROXY_CFG))
  // 协议 + host:port 少一段都不行（丢协议 → 用户分不出 socks5h 还是 http）
  assert.equal(textOf(html, 'monitor-outbound'), '出站：经代理 socks5h 127.0.0.1:10808')
  assert.match(openTagOf(html, 'monitor-outbound'), /is-proxy/)
  assert.equal(html.includes('is-direct'), false, 'proxy 态不该带 is-direct')
})

test('徽标 · direct 态：弱化灰字「出站：直连」，class 标成 is-direct', async () => {
  const html = await renderBadge(badgeState({ mode: 'direct', proxy: null, changedAt: null }))
  assert.equal(textOf(html, 'monitor-outbound'), '出站：直连')
  assert.match(openTagOf(html, 'monitor-outbound'), /is-direct/)
  // 直连态不许顺手把已存的代理配置写出来（那是设置页的事，页头只回答「现在从哪出去」）
  assert.equal(html.includes('10808'), false)
})

test('徽标 · GET 还没回来（真 hook，useEffect 不执行）：一个字节都不渲染，不占位、不报错', async () => {
  const html = await renderBadgeWithRealHook()
  assert.equal(html, '', 'cfg=null 时必须完全静默（渲染占位或「直连」都是谎报）')
})

test('徽标 · GET 失败（cfg=null + err）：同样一个字节都不渲染（错误归设置页那张卡，页头不甩红字）', async () => {
  const html = await renderBadge(badgeState(null, 'Uptime Kuma 连不上'))
  assert.equal(html, '', '失败态必须静默，不许渲染「出站：直连」这种假信息')
  assert.equal(html.includes('出站'), false)
  assert.equal(html.includes('Uptime Kuma'), false)
})

test('徽标 · title 逐字：proxy 与 direct 各自的说明文字都在', async () => {
  const proxy = openTagOf(await renderBadge(badgeState(PROXY_CFG)), 'monitor-outbound')
  assert.match(proxy, /title="经代理的绿色只代表机器存活，不代表国内直连可用"/)

  const direct = openTagOf(await renderBadge(badgeState({ mode: 'direct', proxy: null, changedAt: null })), 'monitor-outbound')
  assert.match(direct, /title="直连的绿色代表本机不经代理直接可达"/)
})

test('徽标 · 绝不外泄凭据：输出里没有 password / hasPassword / 用户名', async () => {
  const html = await renderBadge(badgeState(PROXY_CFG))
  assert.equal(/password/i.test(html), false, '徽标不许出现 password 字样')
  assert.equal(html.includes('hasPassword'), false)
  assert.equal(html.includes('alice'), false, '用户名也算凭据的一部分，不许进页头')
})

test('徽标 · mode=proxy 但 proxy 为空（不该出现的脏数据）：不炸、也不谎报成直连', async () => {
  const html = await renderBadge(badgeState({ mode: 'proxy', proxy: null, changedAt: null }))
  assert.equal(textOf(html, 'monitor-outbound'), '出站：经代理（还没配代理）')
})

// ───────────────────── 卡片「钉死」小标签 ─────────────────────

const monitor = (outboundMode?: string) => ({
  id: 6, name: 'app-api', type: 'http', group: 'wb-server2 (阿里云)',
  status: 1, time: '2026-10-27T12:00:00.000Z', ping: 120, msg: '',
  description: '', showMsg: false, active: true, interval: 60,
  ...(outboundMode === undefined ? {} : { outboundMode }),
  uptime24: 0.999, beats: [1, 1, 1], downCount: 0, lastDown: null, link: null,
})

async function renderCard(outboundMode?: string): Promise<string> {
  return withServer([], async (load) => {
    const mod: any = await load(CARD)
    return renderToStaticMarkup(createElement(mod.MonitorCard, { m: monitor(outboundMode), onOpen: () => {} }))
  })
}

test('卡片 · 钉死直连：挂「钉：直连」，用的是独立 class（不是既有状态色块 monitor-chip）', async () => {
  const html = await renderCard('direct')
  assert.equal(textOf(html, 'monitor-pin'), '钉：直连')
  const tag = openTagOf(html, 'monitor-pin')
  assert.match(tag, /class="monitor-pin"/, '钉死标签必须用独立的 monitor-pin class')
  assert.equal(/monitor-chip/.test(tag), false, '别复用到状态色块上（那会让「钉死」看起来像状态）')
  assert.equal(html.includes('钉：代理'), false)
})

test('卡片 · 钉死代理：挂「钉：代理」', async () => {
  const html = await renderCard('proxy')
  assert.equal(textOf(html, 'monitor-pin'), '钉：代理')
  assert.equal(html.includes('钉：直连'), false)
})

test('卡片 · follow：一个「钉：」都不渲染（跟随全局不该有标签）', async () => {
  const html = await renderCard('follow')
  assert.equal(html.includes('钉：'), false)
  assert.equal(html.includes('monitor-pin'), false)
})

test('卡片 · 字段缺失（老服务端的 toJSON）：同样不渲染钉死标签', async () => {
  const html = await renderCard(undefined)
  assert.equal(html.includes('钉：'), false)
  assert.equal(html.includes('monitor-pin'), false)
})
