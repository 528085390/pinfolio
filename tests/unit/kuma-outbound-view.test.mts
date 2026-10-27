// 出站设置的读侧视图 / 写回构造 / 回读比对（server/kuma/outbound-view.ts）
//
// 为什么有这一份（Task 7 评审 I-1）：铁律 7「写完回读比对，不一致就报 500」原本长在路由里，
// 谁都能把 diffWritten 改成永远 return [] 而所有测试照样绿。抽成纯函数后这里逐条钉住它。
// 铁律 6（日志不得打印请求体）在 outbound-log-guard.test.mts（静态断言）。
//
// 三个哨兵串：断言差异文案里**永远**不出现密码明文。
// 运行：node --import tsx --test tests/unit/*.test.mts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  AT_KEY, MODE_KEY, PROXY_KEY, buildProxyWrite, diffWritten, maskProxy, viewOf,
} from '../../server/kuma/outbound-view.js'

/** 密码哨兵：任何输出里出现它就算泄漏（评审要求的写法） */
const PW = 'PW_SENTINEL_9f3'
const AT = '2026-10-27T10:00:00.000Z'

const settings = (over: Record<string, any> = {}) => ({
  [MODE_KEY]: 'direct',
  [AT_KEY]: AT,
  ...over,
})

/** 一次「proxy 模式」的完整意图：protocol/host/port + 账号密码都是本次显式给的 */
const intent = (over: Record<string, any> = {}) => ({
  mode: 'proxy',
  changedAt: AT,
  proxy: { protocol: 'socks5h', host: '10.0.0.1', port: 10808, username: 'u', password: PW, ...over },
})

const text = (diffs: string[]) => diffs.join('；')

describe('diffWritten：铁律 7 的四个基本判定', () => {
  it('完全一致 → 返回 []', () => {
    const after = settings({
      [MODE_KEY]: 'proxy',
      [PROXY_KEY]: { protocol: 'socks5h', host: '10.0.0.1', port: 10808, username: 'u', password: PW },
    })
    assert.deepEqual(diffWritten(intent(), after), [])
  })

  it('mode 不一致 → 返回非空差异，且点出是「出站模式」', () => {
    // 想写 proxy、读回来还是 direct（典型：setSettings 没落库）
    const after = settings({ [MODE_KEY]: 'direct' })
    const diffs = diffWritten(intent(), after)
    assert.ok(diffs.length > 0, 'mode 与意图不一致时必须报差异')
    assert.match(text(diffs), /出站模式/)
    // 反向：想写 direct、读回来是 proxy
    const diffs2 = diffWritten({ mode: 'direct', changedAt: AT }, settings({ [MODE_KEY]: 'proxy' }))
    assert.ok(diffs2.length > 0, '想切直连但库里仍是 proxy 时必须报差异')
  })

  it('proxy.host 不一致 → 返回非空差异，且点出是「代理主机」', () => {
    const after = settings({
      [MODE_KEY]: 'proxy',
      [PROXY_KEY]: { protocol: 'socks5h', host: '10.0.0.2', port: 10808, username: 'u', password: PW },
    })
    const diffs = diffWritten(intent(), after)
    assert.ok(diffs.length > 0, '代理主机与意图不一致时必须报差异')
    assert.match(text(diffs), /代理主机/)
  })

  it('protocol / port / changedAt 不一致也各自报差异', () => {
    const base = { protocol: 'socks5h', host: '10.0.0.1', port: 10808, username: 'u', password: PW }
    const afterOf = (over: Record<string, any>) => settings({ [MODE_KEY]: 'proxy', [PROXY_KEY]: { ...base, ...over } })

    assert.match(text(diffWritten(intent(), afterOf({ protocol: 'http' }))), /代理协议/)
    assert.match(text(diffWritten(intent(), afterOf({ port: 10809 }))), /代理端口/)
    // changedAt：写回的时间戳没落库
    const afterAt = settings({ [MODE_KEY]: 'proxy', [PROXY_KEY]: base, [AT_KEY]: '2026-10-27T09:00:00.000Z' })
    assert.match(text(diffWritten(intent(), afterAt)), /改动时间/)
    // changedAt 整个键丢了（setSettings 会静默丢不认识的键）
    const afterNoAt: Record<string, any> = { [MODE_KEY]: 'proxy', [PROXY_KEY]: base }
    assert.match(text(diffWritten(intent(), afterNoAt)), /改动时间/)
  })

  it('mode=direct 的意图不比对代理（direct 不动 monitorOutboundProxy）', () => {
    // 想让用户切直连：库里留着一个跟谁都不同的代理配置也不许报差异
    const after = settings({ [MODE_KEY]: 'direct', [PROXY_KEY]: { protocol: 'http', host: 'x', port: 9 } })
    assert.deepEqual(diffWritten({ mode: 'direct', changedAt: AT }, after), [])
  })
})

describe('diffWritten：username / password 的键缺失语义（R14 三态）', () => {
  it('意图对象里没有 username/password 键 → 跳过这两项比较（读回为空也不许报差异）', () => {
    // 真实链路：请求没带这两个键 + 新 kuma 的 getSettings 已掩码
    // → buildProxyWrite 不写这两个键、回读也只能看到 hasPassword，读回 username 是空串、密码看不见。
    const written = buildProxyWrite({ protocol: 'socks5h', host: '10.0.0.1', port: 10808, hasPassword: true },
      { protocol: 'socks5h', host: '10.0.0.1', port: 10808 })
    assert.equal(Object.prototype.hasOwnProperty.call(written, 'username'), false, '掩码的 current + 未携带 → 不写 username 键')
    assert.equal(Object.prototype.hasOwnProperty.call(written, 'password'), false, '掩码的 current + 未携带 → 不写 password 键')

    const after = settings({
      [MODE_KEY]: 'proxy',
      [PROXY_KEY]: { protocol: 'socks5h', host: '10.0.0.1', port: 10808, username: '', hasPassword: true },
    })
    assert.deepEqual(diffWritten({ mode: 'proxy', changedAt: AT, proxy: written }, after), [],
      '键缺席 = 本次不修改，读回是空串/看不见密码都不算「没落库」')
  })

  it('对照：键存在时照样比 —— 显式清空账号却没生效必须报（证明上一条是真的「跳过」而不是「永远不比」）', () => {
    const written = buildProxyWrite({}, { protocol: 'socks5h', host: '10.0.0.1', port: 10808, username: '', password: '' })
    const after = settings({
      [MODE_KEY]: 'proxy',
      // 库里还是老值（账号 u、有密码）—— 说明这次「清空」没落库
      [PROXY_KEY]: { protocol: 'socks5h', host: '10.0.0.1', port: 10808, username: 'u', password: PW },
    })
    const diffs = diffWritten({ mode: 'proxy', changedAt: AT, proxy: written }, after)
    assert.match(text(diffs), /代理账号/)
    assert.match(text(diffs), /代理密码/)
  })

  it('只有 username 键时只比账号：密码看不见也不报差异', () => {
    const written = buildProxyWrite({}, { protocol: 'socks5h', host: '10.0.0.1', port: 10808, username: 'u' })
    assert.equal(Object.prototype.hasOwnProperty.call(written, 'password'), false)
    const after = settings({
      [MODE_KEY]: 'proxy',
      [PROXY_KEY]: { protocol: 'socks5h', host: '10.0.0.1', port: 10808, username: 'u', hasPassword: false },
    })
    assert.deepEqual(diffWritten({ mode: 'proxy', changedAt: AT, proxy: written }, after), [])
  })
})

describe('diffWritten：差异文案不得包含密码明文', () => {
  it('账号 / 密码都对不上时，文案里没有哨兵串，只有「有 / 没有」', () => {
    const after = settings({
      [MODE_KEY]: 'proxy',
      [PROXY_KEY]: { protocol: 'socks5h', host: '10.0.0.1', port: 10808, username: 'other', password: 'PLAINTEXT_SHOULD_NEVER_APPEAR' },
    })
    const diffs = diffWritten(intent(), after)
    assert.ok(diffs.length > 0, '账号不一致必须报差异')
    const joined = text(diffs)
    assert.ok(!joined.includes(PW), '差异文案里出现了意图里的密码明文：' + joined)
    assert.ok(!joined.includes('PLAINTEXT_SHOULD_NEVER_APPEAR'), '差异文案里出现了库里的密码明文：' + joined)
    assert.ok(!/password/i.test(joined), '差异文案不该出现 password 这个词：' + joined)
  })

  it('密码「该有却没有」与「该清空却没清空」都只按有无报，且不带明文', () => {
    // 期望有密码、读回来没有
    const d1 = diffWritten(intent(), settings({
      [MODE_KEY]: 'proxy',
      [PROXY_KEY]: { protocol: 'socks5h', host: '10.0.0.1', port: 10808, username: 'u', password: '' },
    }))
    assert.match(text(d1), /代理密码：期望有，实际没有/)
    assert.ok(!text(d1).includes(PW))

    // 期望清空（""）、读回来仍有密码
    const written = buildProxyWrite({}, { protocol: 'socks5h', host: '10.0.0.1', port: 10808, username: 'u', password: '' })
    const d2 = diffWritten({ mode: 'proxy', changedAt: AT, proxy: written }, settings({
      [MODE_KEY]: 'proxy',
      [PROXY_KEY]: { protocol: 'socks5h', host: '10.0.0.1', port: 10808, username: 'u', password: PW },
    }))
    assert.match(text(d2), /代理密码：期望没有，实际有/)
    assert.ok(!text(d2).includes(PW))
  })

  it('路由把这串差异拼进 500 文案时也不带密码（模拟路由那一行）', () => {
    const diffs = diffWritten(intent(), settings({
      [MODE_KEY]: 'proxy',
      [PROXY_KEY]: { protocol: 'socks5h', host: '10.0.0.1', port: 10808, username: 'u', password: '' },
    }))
    const err = 'Kuma 没有按预期写回设置：' + diffs.join('；')
    assert.ok(!err.includes(PW), err)
  })
})

describe('buildProxyWrite：三态与「绝不写 hasPassword」', () => {
  it('请求没带 username/password + 老 kuma 明文 current → 原样写回（不修改 ≠ 清空）', () => {
    const out = buildProxyWrite({ protocol: 'socks5h', host: 'old', port: 1, username: 'u', password: PW },
      { protocol: 'socks5h', host: '10.0.0.1', port: 10808 })
    assert.deepEqual(out, { protocol: 'socks5h', host: '10.0.0.1', port: 10808, username: 'u', password: PW })
  })

  it('current 带 hasPassword 也不许穿进写回对象，未知键同样不许', () => {
    const out = buildProxyWrite({ protocol: 'socks5h', host: 'h', port: 1, username: 'u', hasPassword: true, junk: 1 },
      { protocol: 'socks5h', host: 'h', port: 1 })
    assert.equal(Object.prototype.hasOwnProperty.call(out, 'hasPassword'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(out, 'junk'), false)
    assert.deepEqual(Object.keys(out).sort(), ['host', 'port', 'protocol', 'username'])
  })

  it('显式带键（含 "" = 清空）以请求为准', () => {
    const out = buildProxyWrite({ protocol: 'socks5h', host: 'h', port: 1, username: 'u', password: PW },
      { protocol: 'socks5h', host: 'h', port: 1, username: '', password: '' })
    assert.equal(out.username, '')
    assert.equal(out.password, '')
  })
})

describe('maskProxy / viewOf：读侧只回 5 键且永不回明文（抽文件后的最小护栏）', () => {
  it('maskProxy 把明文密码折成 hasPassword，输出里没有明文、也没有多余的键', () => {
    const v = maskProxy({ protocol: 'socks5h', host: 'h', port: 10808, username: 'u', password: PW, junk: 1 })
    assert.deepEqual(Object.keys(v).sort(), ['hasPassword', 'host', 'port', 'protocol', 'username'])
    assert.equal(v.hasPassword, true)
    assert.ok(!JSON.stringify(v).includes(PW))
    // 将来 kuma 自己掩码：只给 hasPassword 时按它来
    assert.equal(maskProxy({ protocol: 'socks5h', host: 'h', port: 1, hasPassword: true }).hasPassword, true)
    assert.equal(maskProxy({ protocol: 'socks5h', host: 'h', port: 1 }).hasPassword, false)
  })

  it('viewOf：键缺失按「直连 / 没配代理 / 没改过」处理，非 proxy 一律 direct', () => {
    assert.deepEqual(viewOf({}), { mode: 'direct', proxy: null, changedAt: null })
    assert.deepEqual(viewOf(null), { mode: 'direct', proxy: null, changedAt: null })
    assert.equal(viewOf({ [MODE_KEY]: 'PROXY' }).mode, 'direct')
    assert.equal(viewOf({ [AT_KEY]: '' }).changedAt, null)
  })
})
