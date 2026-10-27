// 出站设置的纯逻辑（server/kuma/outbound.ts）：校验、合并、描述
// 语义与 kuma 侧 server/outbound.js 协同（由 routes/outbound.ts 做映射），但**文案不共用**：
// 这里的错误文案来自 spec §3.3（设置页表单提示），kuma 心跳里是另一套（代理不可用：配置无效（协议/服务器地址/端口）…）。
// 跨仓库文案一致性没有自动测试可覆盖 —— 下面这些常量属于同源双写，只防手误不防「两边一起错」；
// 改动文案或语义时人工对一遍 E:\bqj\.worktrees\kuma\server\outbound.js。
// username 与 password **都是三态**（缺键 = 本次不修改 / null 或 "" = 清空 / 字符串 = 原样不 trim）。
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

    it("proxy 不是对象 → 配置无效（代理）", () => {
        for (const bad of [undefined, null, "socks5h", 8080, []]) {
            const r = validateOutboundBody({ mode: "proxy", proxy: bad })
            assert.equal(r.ok, false, JSON.stringify(bad))
            if (!r.ok) assert.equal(r.error, errInvalid("代理"), JSON.stringify(bad))
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

    it("username 缺键（或 undefined）= 本次不修改账号：结果里没有 username 键", () => {
        for (const body of [
            { protocol: "socks5h", host: "h", port: 1 },
            // 显式 undefined 与缺键等价
            { protocol: "socks5h", host: "h", port: 1, username: undefined },
        ]) {
            const r = validateOutboundBody({ mode: "proxy", proxy: body })
            assert.equal(r.ok, true)
            if (r.ok && r.value.proxy) assert.equal("username" in r.value.proxy, false)
        }
    })

    it("username = null → 键存在且为空串（= 清空账号，这条路径必须可达）", () => {
        const r = validateOutboundBody({ mode: "proxy", proxy: proxy({ username: null }) })
        assert.equal(r.ok, true)
        if (r.ok && r.value.proxy) {
            assert.equal("username" in r.value.proxy, true)
            assert.equal(r.value.proxy.username, "")
        }
    })

    it("username = \"\" → 键存在且为空串（= 清空账号）", () => {
        const r = validateOutboundBody({ mode: "proxy", proxy: proxy({ username: "" }) })
        assert.equal(r.ok, true)
        if (r.ok && r.value.proxy) {
            assert.equal("username" in r.value.proxy, true)
            assert.equal(r.value.proxy.username, "")
        }
    })

    it("username 是字符串 → 原样保留（不 trim）", () => {
        // 与 kuma 一致：username 也不 trim，首尾空格原样保留（评审 m-2）
        const r = validateOutboundBody({ mode: "proxy", proxy: proxy({ username: "  u1  " }) })
        assert.equal(r.ok, true)
        if (r.ok && r.value.proxy) assert.equal(r.value.proxy.username, "  u1  ")
    })

    it("username 非 string 非 null（number / boolean / object / array）→ 配置无效（账号）", () => {
        for (const bad of [42, 0, true, false, {}, { a: 1 }, []]) {
            const r = validateOutboundBody({ mode: "proxy", proxy: proxy({ username: bad }) })
            assert.equal(r.ok, false, JSON.stringify(bad))
            if (!r.ok) assert.equal(r.error, errInvalid("账号"), JSON.stringify(bad))
        }
    })

    it("password 缺键（或 undefined）= 本次不修改密码：结果里没有 password 键", () => {
        for (const body of [
            { protocol: "socks5h", host: "h", port: 1 },
            // 显式 undefined 与缺键等价
            { protocol: "socks5h", host: "h", port: 1, password: undefined },
        ]) {
            const r = validateOutboundBody({ mode: "proxy", proxy: body })
            assert.equal(r.ok, true)
            if (r.ok && r.value.proxy) assert.equal("password" in r.value.proxy, false)
        }
    })

    it("password = null → 键存在且为空串（= 清空密码，这条路径必须可达）", () => {
        const r = validateOutboundBody({ mode: "proxy", proxy: proxy({ password: null }) })
        assert.equal(r.ok, true)
        if (r.ok && r.value.proxy) {
            assert.equal("password" in r.value.proxy, true)
            assert.equal(r.value.proxy.password, "")
        }
    })

    it("password = \"\" → 键存在且为空串（= 清空密码）", () => {
        const r = validateOutboundBody({ mode: "proxy", proxy: proxy({ password: "" }) })
        assert.equal(r.ok, true)
        if (r.ok && r.value.proxy) {
            assert.equal("password" in r.value.proxy, true)
            assert.equal(r.value.proxy.password, "")
        }
    })

    it("password 是字符串 → 原样保留（不 trim）", () => {
        // 密码不 trim：首尾空格也是密码的一部分
        const raw = validateOutboundBody({ mode: "proxy", proxy: proxy({ password: "  p w  " }) })
        assert.equal(raw.ok, true)
        if (raw.ok && raw.value.proxy) assert.equal(raw.value.proxy.password, "  p w  ")
    })

    it("password 非 string 非 null（number / boolean / object / array）→ 配置无效（密码）", () => {
        for (const bad of [123, 0, true, false, {}, { a: 1 }, []]) {
            const r = validateOutboundBody({ mode: "proxy", proxy: proxy({ password: bad }) })
            assert.equal(r.ok, false, JSON.stringify(bad))
            if (!r.ok) assert.equal(r.error, errInvalid("密码"), JSON.stringify(bad))
        }
    })

    it("成功时的形状：只含 protocol/host/port + 按需出现的 username/password，不带 hasPassword", () => {
        // 分支一：不给 username → 结果里没有 username 键
        const plain = validateOutboundBody({
            mode: "proxy",
            proxy: { protocol: "SOCKS5", host: " 127.0.0.1 ", port: 10808, password: "p" },
        })
        assert.deepEqual(plain, {
            ok: true,
            value: { mode: "proxy", proxy: { protocol: "socks5", host: "127.0.0.1", port: 10808, password: "p" } },
        })
        // 分支二：给了 username → 多一个 username 键，值原样（不 trim）
        const withUser = validateOutboundBody({
            mode: "proxy",
            proxy: { protocol: "SOCKS5", host: " 127.0.0.1 ", port: 10808, username: " u ", password: "p" },
        })
        assert.deepEqual(withUser, {
            ok: true,
            value: { mode: "proxy", proxy: { protocol: "socks5", host: "127.0.0.1", port: 10808, username: " u ", password: "p" } },
        })
        // 两条分支都不含意料之外的键（尤其 hasPassword）
        for (const r of [plain, withUser]) {
            if (!r.ok || !r.value.proxy) continue
            const keys = Object.keys(r.value.proxy).sort()
            assert.equal(keys.includes("hasPassword"), false)
            assert.equal(
                keys.every((k) => ["host", "password", "port", "protocol", "username"].includes(k)),
                true,
                keys.join(",")
            )
        }
    })
})

describe("mergeProxySettings", () => {
    it("缺 password 键 = 保留旧密码", () => {
        const out = mergeProxySettings({ password: "old", host: "h" }, { host: "h2", port: 2 })
        assert.equal(out.password, "old")
        assert.equal(out.host, "h2")
    })
    it("incoming 缺 username 键 = 保留 current.username（默认值补齐语义不变，R15）", () => {
        const out = mergeProxySettings(
            { protocol: "socks5h", host: "h", port: 1, username: "u", password: "old" },
            { host: "h2" }
        )
        assert.equal(out.username, "u")
        assert.equal(out.host, "h2")
    })

    it("password = null 或空串 = 清空", () => {
        assert.equal(mergeProxySettings({ password: "old" }, { password: null }).password, "")
        assert.equal(mergeProxySettings({ password: "old" }, { password: "" }).password, "")
    })

    it("只回 5 个业务键：current 里的额外键（含 hasPassword）不穿过去", () => {
        const out = mergeProxySettings(
            { protocol: "socks5h", host: "h", port: 1, username: "u", password: "old", hasPassword: true, keepMe: 1 },
            { host: "h2" }
        )
        assert.deepEqual(Object.keys(out).sort(), ["host", "password", "port", "protocol", "username"])
        assert.equal("hasPassword" in out, false)
        assert.equal(out.host, "h2")
        assert.equal(out.password, "old")
    })

    it("incoming 里的额外键（例如 bob:1）不落进结果", () => {
        const out = mergeProxySettings(
            { protocol: "socks5h", host: "h", port: 1, username: "u", password: "old" },
            { host: "h2", bob: 1 }
        )
        assert.deepEqual(Object.keys(out).sort(), ["host", "password", "port", "protocol", "username"])
        assert.equal("bob" in out, false)
        assert.equal(out.host, "h2")
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
