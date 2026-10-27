// 外链白名单（Task 7）。这里必须是**纯函数**：主进程拿它判断「这个 URL 是不是本站」，
// 单测（node --test，没有 Electron 运行时）也拿它验证同一套规则。
//
// 本站 = 回环地址 + 本次启动分配到的端口。窗口只许停留在这个范围内：
// - `setWindowOpenHandler`（target=_blank / window.open）与 `will-navigate`（同窗口跳转）
//   都过这道闸，命中的交给系统浏览器；
// - 不认 hostname 后缀匹配、不认前缀字符串比较 —— `http://127.0.0.1:端口@evil.com`
//   这种 userinfo 伪装在 URL 解析后 hostname 是 evil.com，前缀比较会放它过去。
//
// 只放行 http：应用的监听地址永远是 http://127.0.0.1，https / file: / javascript: / data:
// 一律算外链（真递到 shell.openExternal 就等于让页面去启动本机程序）。
// IPv6（[::1]）故意不认：server/app.ts 的 HOSTNAME 固定 127.0.0.1，多认一个口子没必要。

/** 认的回环主机名（URL 解析后已小写，IPv4 的十进制写法也被归一成 127.0.0.1） */
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost']

/**
 * 这个 URL 是不是「本站」（http://127.0.0.1:<port> 或 http://localhost:<port>）。
 * `about:blank` 单独放行：Electron 开新窗口 / 关窗口过程中会出现这个地址，它不是外链。
 */
export function isInternalUrl(url: string, port: number): boolean {
  if (typeof url !== 'string') return false
  const raw = url.trim()
  if (raw === '') return false
  if (raw === 'about:blank') return true

  // 端口必须是 1–65535 的整数：startServer 传 0 让系统分配，真实端口只能从 handle 里拿，
  // 传 0（忘了替换）时一个都不放行，绝不退化成「放行所有回环地址」。
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return false

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    // 相对地址（/notes）、协议残缺（http://）等都解析不了，一律当外链
    return false
  }

  if (parsed.protocol !== 'http:') return false
  if (!LOOPBACK_HOSTS.includes(parsed.hostname)) return false
  // hostname 已经是 @ 之后那段，这条是双保险：应用里没有任何站内地址带凭据
  if (parsed.username !== '' || parsed.password !== '') return false

  // 端口用数字比：URL 会去掉前导零，`http://127.0.0.1:041234/`.port 是 "41234"；
  // 省略端口时是空串，Number('') === 0，天然不等于任何合法端口
  return Number(parsed.port) === port
}
