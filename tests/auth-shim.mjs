// 给 fetch 型 e2e 脚本自动加 Authorization（token 由 tests/run.mjs 生成并通过 PINBOARD_TOKEN 传下来）。
// 只对本地目标地址加，别把 token 发给第三方。
const TOKEN = process.env.PINBOARD_TOKEN
const BASE = (process.env.MAIL_E2E_BASE || process.env.E2E_BASE || 'http://127.0.0.1:7788').replace(/\/+$/, '')

if (TOKEN) {
  const orig = globalThis.fetch
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.startsWith(BASE)) return orig(input, init)
    const headers = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined))
    if (!headers.has('authorization')) headers.set('authorization', 'Bearer ' + TOKEN)
    return orig(input, { ...(init || {}), headers })
  }
}
