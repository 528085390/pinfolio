// 给 fetch 型 e2e 脚本自动加 Authorization（token 由 tests/run.mjs 生成并通过 PINBOARD_TOKEN 传下来）。
// 只对测试目标地址加，别把 token 发给第三方。
// 这里不 import env.mjs：没设 E2E_BASE 时它会让脚本直接退出，而 shim 本身应该安静地什么都不做。
const TOKEN = process.env.PINBOARD_TOKEN
const BASES = [process.env.E2E_BASE, process.env.MAIL_E2E_BASE]
  .filter(Boolean)
  .map((s) => s.replace(/\/+$/, ''))

if (TOKEN && BASES.length) {
  const orig = globalThis.fetch
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!BASES.some((b) => url.startsWith(b))) return orig(input, init)
    const headers = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined))
    if (!headers.has('authorization')) headers.set('authorization', 'Bearer ' + TOKEN)
    return orig(input, { ...(init || {}), headers })
  }
}
