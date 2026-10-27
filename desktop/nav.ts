// 外链白名单（桌面客户端套壳）。必须是**纯函数**：主进程拿它判断「这个 URL 是不是本站」，
// 单测（node --test，没有 Electron 运行时）也拿它验证同一套规则。
//
// 本站 = 与目标网页端同一源（默认 http://127.0.0.1:7788 或 http://localhost:7788）。
// 窗口只许停留在这个范围内：
// - `setWindowOpenHandler`（target=_blank / window.open）与 `will-navigate`（同窗口跳转）
//   都过这道闸，外链交给系统浏览器；
// - 不认 hostname 后缀匹配、不认前缀字符串比较 —— `http://127.0.0.1:端口@evil.com`
//   这种 userinfo 伪装在 URL 解析后 hostname 是 evil.com，前缀比较会放它过去。
//
// 只放行 http/https：应用的监听地址永远是网页端地址，file: / javascript: / data:
// 一律算外链（真递到 shell.openExternal 就等于让页面去启动本机程序）。

/** 认的回环主机名（URL 解析后已小写，IPv4 的十进制写法也被归一成 127.0.0.1） */
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost']

/**
 * 这个 URL 是不是「本站」网页端：
 * - target 为数字端口（例如 41234）：匹配 http://127.0.0.1:<port> 或 http://localhost:<port>；
 * - target 为完整 URL 字符串（例如 'http://127.0.0.1:7788'）：同源匹配（回环地址互通）。
 * `about:blank` 单独放行：Electron 开新窗口时会出现。
 */
export function isInternalUrl(url: string, target: number | string): boolean {
  if (typeof url !== 'string') return false
  const raw = url.trim()
  if (raw === '') return false
  if (raw === 'about:blank') return true

  let targetPort: number
  let targetProtocol = 'http:'
  let targetHostname = '127.0.0.1'
  let isTargetLoopback = true

  if (typeof target === 'number') {
    if (!Number.isInteger(target) || target <= 0 || target > 65535) return false
    targetPort = target
  } else if (typeof target === 'string') {
    try {
      const parsedTarget = new URL(target)
      targetProtocol = parsedTarget.protocol
      targetHostname = parsedTarget.hostname
      targetPort = Number(parsedTarget.port) || (targetProtocol === 'https:' ? 443 : 80)
      isTargetLoopback = LOOPBACK_HOSTS.includes(targetHostname)
    } catch {
      return false
    }
  } else {
    return false
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    // 相对地址（/notes）、协议残缺（http://）等都解析不了，一律当外链
    return false
  }

  if (parsed.protocol !== targetProtocol) return false
  // hostname 已经是 @ 之后那段，应用里没有任何站内地址带凭据
  if (parsed.username !== '' || parsed.password !== '') return false

  const candidatePort = Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80)
  if (candidatePort !== targetPort) return false

  if (isTargetLoopback) {
    if (!LOOPBACK_HOSTS.includes(parsed.hostname)) return false
  } else {
    if (parsed.hostname.toLowerCase() !== targetHostname.toLowerCase()) return false
  }

  return true
}
