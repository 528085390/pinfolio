// 出站设置的纯逻辑（server/kuma/outbound.ts）：校验、合并、描述
// 这些规则与 kuma 侧 server/outbound.js 的 normalizeProxyConfig / mergeProxyOnWrite 逐条对齐 ——
// 两边文案与语义必须一样，否则界面说的话和探测实际干的事会对不上。
// 运行：pnpm test:unit
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validateOutboundBody, mergeProxySettings, describe as describeProxy } from '../../server/kuma/outbound.js'

/* 逐字照抄的错误文案（多一个字都算 bug） */
const ERR_MODE = '出站模式只能是 direct 或 proxy'
const ERR_PROTOCOL = '不支持该代理协议（支持 socks5h / socks5 / http / https）'
const ERR_HOST = '代理主机格式不对（只填主机或 IP，不要带 http:// 或端口）'
const ERR_PORT = '代理端口必须是 1–65535 的整数' // 注意是 en dash（U+2013）
const errInvalid = (field: string) => '代理不可用：配置无效（' + field + '），请检查 设置 → 出站模式'

const proxy = (over: Record<string, unknown> = {}) => ({ protocol: 'socks5h', host: 'h', port: 10808, ...over })

describe("validateOutboundBody", () => {
    it("mode=direct 通过且不带 proxy", () => {
        const r = validateOutboundBody({ mode: "direct" })
        assert.equal(r.ok, true)
        // 忽略 body.proxy：direct 就是不带代理
        const r2 = validateOutboundBody({ mode: "direct", proxy: { protocol: "socks5h", host: "h", port: 1 } })
        assert.deepEqual(r2, { ok: true, value: { mode: "direct", proxy: null } })
    })
    it("mode=proxy 缺 proxy / 协议非法 / 端口越界 / host 带 scheme 都拒", () => {
        for (const bad of [
            { mode: "proxy" },
            { mode: "proxy", proxy: { protocol: "socks", host: "h", port: 1 } },
            { mode: "proxy", proxy: { protocol: "socks5h", host: "h", port: 0 } },
            { mode: "proxy", proxy: { protocol: "socks5h", host: "h", port: 70000 } },
            { mode: "proxy", proxy: { protocol: "socks5h", host: "http://h", port: 1 } },
            { mode: "proxy", proxy: { protocol: "socks5h", host: "h:1080", port: 1 } },
            { mode: "proxy", proxy: { protocol: "socks5h", host: "", port: 1 } },
            { mode: "goofy" },
            null,
            "x",
        ]) {
            assert.equal(validateOutboundBody(bad).ok, false, JSON.stringify(bad))
        }
    })

    it("body 不是对象 / 为 null → 出站模式文案", () => {
        for (const bad of [null, undefined, 42, true, "direct", []]) {
            const r = validateOutboundBody(bad)
            assert.equal(r.ok, false, JSON.stringify(bad))
            if (!r.ok) assert.equal(r.error, ERR_MODE, JSON.stringify(bad))
        }
        const r = validateOutboundBody({ mode: "DIRECT " })
        assert.equal(r.ok, false)
        if (!r.ok) assert.equal(r.error, ERR_MODE) // mode 不做大小写/trim 归一
    })

    it("proxy 不是对象 → 配置无效（proxy）", () => {
        for (const bad of [undefined, null, "socks5h", 8080, []]) {
            const r = validateOutboundBody({ mode: "proxy", proxy: bad })
            assert.equal(r.ok, false, JSON.stringify(bad))
            if (!r.ok) assert.equal(r.error, errInvalid("proxy"), JSON.stringify(bad))
        }
    })

    it("protocol：大小写不敏感 + trim，输出统一小写", () => {
        for (const proto of ["socks5h", "socks5", "http", "https", " SOCKS5 ", "Http\t"]) {
            const r = validateOutboundBody({ mode: "proxy", proxy: proxy({ protocol: proto }) })
            assert.equal(r.ok, true, proto)
            if (r.ok && r.value.proxy) assert.equal(r.value.proxy.protocol, proto.trim().toLowerCase())
        }
        for (const bad of ["socks", "socks4", "SOCKS4", "", 5, null]) {
            const r = validateOutboundBody({ mode: "proxy", proxy: proxy({ protocol: bad }) })
            assert.equal(r.ok, false, JSON.stringify(bad))
            if (!r.ok) assert.equal(r.error, ERR_PROTOCOL, JSON.stringify(bad))
        }
    })

    it("host：trim 后必须非空、无空白、无 / 、无 : 、不带 scheme", () => {
        for (const bad of ["", "   ", "h h", "a b:1", "http://h", "https://h", "socks5h://h", "1.2.3.4/24", "h:1080", "::1"]) {
            const r = validateOutboundBody({ mode: "proxy", proxy: proxy({ host: bad }) })
            assert.equal(r.ok, false, JSON.stringify(bad))
            if (!r.ok) assert.equal(r.error, ERR_HOST, JSON.stringify(bad))
        }
        const ok = validateOutboundBody({ mode: "proxy", proxy: proxy({ host: "  apiccccc.dpdns.org  " }) })
        assert.equal(ok.ok, true)
        if (ok.ok && ok.value.proxy) assert.equal(ok.value.proxy.host, "apiccccc.dpdns.org")
    })

    it("port：只认整数 1–65535，字符串/布尔/数组/小数都拒", () => {
        for (const bad of [0, 70000, -1, 10808.5, "10808", true, [10808], null, undefined, NaN]) {
            const r = validateOutboundBody({ mode: "proxy", proxy: proxy({ port: bad }) })
            assert.equal(r.ok, false, JSON.stringify(bad))
            if (!r.ok) assert.equal(r.error, ERR_PORT, JSON.stringify(bad))
        }
        for (const good of [1, 10808, 65535]) {
            const r = validateOutboundBody({ mode: "proxy", proxy: proxy({ port: good }) })
            assert.equal(r.ok, true, String(good))
            if (r.ok && r.value.proxy) assert.equal(r.value.proxy.port, good)
        }
    })

    it("username：缺省 / null 归空串，给了就 trim", () => {
        const none = validateOutboundBody({ mode: "proxy", proxy: { protocol: "socks5h", host: "h", port: 1 } })
        assert.equal(none.ok, true)
        if (none.ok && none.value.proxy) assert.equal(none.value.proxy.username, "")
        const nul = validateOutboundBody({ mode: "proxy", proxy: proxy({ username: null }) })
        if (nul.ok && nul.value.proxy) assert.equal(nul.value.proxy.username, "")
        const trim = validateOutboundBody({ mode: "proxy", proxy: proxy({ username: "  u1  " }) })
        if (trim.ok && trim.value.proxy) assert.equal(trim.value.proxy.username, "u1")
        const bad = validateOutboundBody({ mode: "proxy", proxy: proxy({ username: 42 }) })
        assert.equal(bad.ok, false)
        if (!bad.ok) assert.equal(bad.error, errInvalid("username"))
    })

    it("password：缺键 / null = 本次不提供，string 原样保留", () => {
        const none = validateOutboundBody({ mode: "proxy", proxy: { protocol: "socks5h", host: "h", port: 1 } })
        assert.equal(none.ok, true)
        if (none.ok && none.value.proxy) {
            assert.equal(none.value.proxy.password, undefined)
            assert.equal("password" in none.value.proxy, false)
        }
        const nul = validateOutboundBody({ mode: "proxy", proxy: proxy({ password: null }) })
        if (nul.ok && nul.value.proxy) {
            assert.equal(nul.value.proxy.password, undefined)
            assert.equal("password" in nul.value.proxy, false)
        }
        // 密码不 trim：首尾空格也是密码的一部分
        const raw = validateOutboundBody({ mode: "proxy", proxy: proxy({ password: "  p w  " }) })
        if (raw.ok && raw.value.proxy) assert.equal(raw.value.proxy.password, "  p w  ")
        const bad = validateOutboundBody({ mode: "proxy", proxy: proxy({ password: 123 }) })
        assert.equal(bad.ok, false)
        if (!bad.ok) assert.equal(bad.error, errInvalid("password"))
    })

    it("成功时的形状：只有 protocol/host/port/username(=password)，不带 hasPassword", () => {
        const r = validateOutboundBody({
            mode: "proxy",
            proxy: { protocol: "SOCKS5", host: " 127.0.0.1 ", port: 10808, username: " u ", password: "p" },
        })
        assert.deepEqual(r, {
            ok: true,
            value: { mode: "proxy", proxy: { protocol: "socks5", host: "127.0.0.1", port: 10808, username: "u", password: "p" } },
        })
    })
})

describe("mergeProxySettings", () => {
    it("缺 password 键 = 保留旧密码", () => {
        const out = mergeProxySettings({ password: "old", host: "h" }, { host: "h2", port: 2 })
        assert.equal(out.password, "old")
        assert.equal(out.host, "h2")
    })
    it("password = null 或空串 = 清空", () => {
        assert.equal(mergeProxySettings({ password: "old" }, { password: null }).password, "")
        assert.equal(mergeProxySettings({ password: "old" }, { password: "" }).password, "")
    })

    it("current 里其它字段原样保留", () => {
        const out = mergeProxySettings({ host: "h", keepMe: 1, nested: { a: 1 } }, { host: "h2" })
        assert.equal(out.host, "h2")
        assert.equal(out.keepMe, 1)
        assert.deepEqual(out.nested, { a: 1 })
    })

    it("incoming 为 null 的字段 = 未修改，不会把 null 写进去", () => {
        const current = { protocol: "socks5h", host: "127.0.0.1", port: 10808, username: "u", password: "old" }
        const out = mergeProxySettings(current, { protocol: null, host: null, port: null, username: null })
        assert.equal(out.protocol, "socks5h")
        assert.equal(out.host, "127.0.0.1")
        assert.equal(out.port, 10808)
        assert.equal(out.username, "u")
        assert.equal(out.password, "old")
    })

    it("不原地修改 current，返回新对象", () => {
        const current = { host: "h", password: "old" }
        const snapshot = JSON.stringify(current)
        const out = mergeProxySettings(current, { host: "h2", password: null })
        assert.notEqual(out, current)
        assert.equal(JSON.stringify(current), snapshot)
        assert.equal(current.password, "old")
    })

    it("空 current 也能合并（默认 socks5h / 空串 / 0）", () => {
        const out = mergeProxySettings(undefined, { host: "h", port: 1080 })
        assert.equal(out.protocol, "socks5h")
        assert.equal(out.host, "h")
        assert.equal(out.port, 1080)
        assert.equal(out.username, "")
        assert.equal(out.password, "")
    })
})

describe("describe", () => {
    it("不含账号与密码", () => {
        const s = describeProxy({ protocol: "socks5h", host: "127.0.0.1", port: 10808, username: "u", hasPassword: true })
        assert.equal(s, "socks5h 127.0.0.1:10808")
    })

    it("格式固定：协议 + 单空格 + host:port，无方括号无尾空格", () => {
        assert.equal(describeProxy({ protocol: "http", host: "apiccccc.dpdns.org", port: 80, username: "", hasPassword: false }), "http apiccccc.dpdns.org:80")
        assert.equal(describeProxy({ protocol: "socks5", host: "h", port: 1, username: "u", hasPassword: true }).includes("u"), false)
    })
})
