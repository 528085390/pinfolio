// 把 imapflow / 网络错误翻译成人能看懂的一句中文；代理相关提示也在这里。

const AUTH_RE = /auth|credentials|LOGIN failed|AUTHENTICATIONFAILED|invalid user|password/i

/** 代理地址去掉账号密码，避免把凭据写进界面提示 */
function proxyLabel(proxy: string): string {
  return String(proxy || '').replace(/\/\/[^@/]*@/, '//')
}

/** 账号没填代理时，允许用环境变量兜底（PINBOARD_MAIL_PROXY=socks5://127.0.0.1:10808） */
export function proxyOf(a: { proxy?: string }): string {
  return String(a.proxy || process.env.PINBOARD_MAIL_PROXY || '').trim()
}

/** 把 imapflow / 网络错误翻译成人能看懂的一句话；传了 proxy 会说明「这是走代理失败」 */
export function friendlyError(err: unknown, proxy = ''): string {
  const e = err as any
  const code = String(e?.code || '')
  const msg = String(e?.responseText || e?.message || e || '').trim()
  const lower = msg.toLowerCase()
  const via = proxy ? '（经代理 ' + proxyLabel(proxy) + '）' : ''
  if (code === 'EPROXY' || code === 'ProxyError' || code === 'UnsupportedProxyAddress' || /proxy/i.test(msg)) {
    return '代理连接失败：请确认代理程序在运行、地址端口正确' + (proxy ? '（' + proxyLabel(proxy) + '）' : '（例如 socks5://127.0.0.1:10808）')
  }
  if (code === 'CONNECT_TIMEOUT' || /timeout|timed out|超时/.test(lower)) {
    return proxy
      ? '连接超时' + via + '：代理不通或目标服务器不可达，请确认代理程序在运行、服务器地址与端口正确'
      : '连接超时：服务器或网络不通。国内直连 imap.gmail.com 经常被墙，请在账号里填 SOCKS5 代理（例如 socks5://127.0.0.1:10808）；QQ/163 一般直连即可'
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '服务器地址解析失败，请检查 IMAP 服务器地址是否写错'
  if (code === 'ECONNREFUSED') {
    return proxy
      ? '连接被拒绝' + via + '：请确认代理程序在运行（端口对得上），以及服务器端口与加密方式（SSL 一般为 993）'
      : '端口拒绝连接：请确认端口号与加密方式（SSL/TLS 一般为 993，STARTTLS 一般为 143）'
  }
  if (code === 'ECONNRESET' || code === 'EPIPE') return '连接被服务器中断，请稍后重试'
  if (code === 'EAUTH' || AUTH_RE.test(msg) && !/certificate/i.test(msg)) {
    return '登录被拒绝：用户名或密码不对。Gmail 需用「应用专用密码」，QQ/163 需用「授权码」而不是登录密码'
  }
  if (/certificate|self signed|CERT_/i.test(msg)) return 'TLS 证书校验失败：' + msg
  if (/STARTTLS/i.test(msg)) return '服务器不支持 STARTTLS，请改用 SSL/TLS（993 端口）'
  if (/UNAVAILABLE|temporarily/i.test(msg)) return '服务器暂时不可用，请稍后重试'
  return msg || '未知错误'
}
