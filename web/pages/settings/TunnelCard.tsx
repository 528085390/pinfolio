import { useCallback, useEffect, useState } from 'react'
import { Copy, Globe, RefreshCw } from 'lucide-react'
import { api, type TunnelStatus } from '../../lib/api'
import { localeTag, t } from '../../lib/i18n'

// 公网访问（frp / 任意反代）：填地址 → 本机每 60s 自检 → 这里显示在线状态。
// 探活走的是真正的公网地址，所以「在线」= 手机从外面能打开。
const FRPC_TEMPLATE = `# 家里这台（frpc）—— 服务器上跑 frps
serverAddr = "<服务器 IP 或域名>"
serverPort = 443
transport.protocol = "wss"            # 复用 443，不用额外开端口
transport.tls.serverName = "<服务器 IP 或域名>"
auth.method = "token"
auth.token = "<frps 里配的 token>"
loginFailExit = false

[[proxies]]
name = "pinfolio"
type = "tcp"
localIP = "127.0.0.1"
localPort = 7788
remotePort = 7790                     # 服务器 nginx 反代到 127.0.0.1:7790`

function fmt(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return t('刚刚')
  if (diff < 3_600_000) return t('{n} 分钟前', { n: Math.floor(diff / 60_000) })
  return d.toLocaleString(localeTag(), { hour12: false })
}

export function TunnelCard() {
  const [st, setSt] = useState<TunnelStatus | null>(null)
  const [url, setUrl] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const s = await api.tunnel.get()
      setSt(s)
      setUrl((cur) => (cur ? cur : s.publicUrl))
    } catch (e: any) {
      setMsg(e.message)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function save() {
    setBusy(true); setMsg('')
    try {
      const s = await api.tunnel.save(url)
      setSt(s)
      setMsg(s.online ? t('已保存，公网可达') : t('已保存，但暂时没连上'))
    } catch (e: any) {
      setMsg(e.message)
    } finally { setBusy(false) }
  }

  async function check() {
    setBusy(true); setMsg('')
    try {
      setSt(await api.tunnel.check())
    } catch (e: any) {
      setMsg(e.message)
    } finally { setBusy(false) }
  }

  async function copy() {
    if (!st?.publicUrl) return
    try {
      await navigator.clipboard.writeText(st.publicUrl)
      setMsg(t('地址已复制'))
    } catch {
      setMsg(t('复制失败，请手动选中'))
    }
  }

  const online = st?.online
  const state = online === true ? t('在线') : online === false ? t('连不上') : st?.publicUrl ? t('未检测') : t('未配置')

  return (
    <div className="card sec-card">
      <div className="section-title" style={{ marginTop: 0 }}>
        <Globe size={14} /> {t('公网访问')}
      </div>
      <p className="sec-hint">
        {t('手机 / 平板要看这台机器的数据，就得有一条从公网到这里的路（frp 隧道或任意反代）。 填好公网地址后，本机会每 60 秒请求一次这个地址自检，状态显示「在线」就说明外面能打开。')}
      </p>

      <div className="tunnel-row">
        <input
          className="input"
          value={url}
          placeholder="https://example.com/pinfolio"
          onChange={(e) => setUrl(e.target.value)}
          spellCheck={false}
        />
        <button className="btn" onClick={save} disabled={busy}>{t('保存并检测')}</button>
      </div>

      <div className="tunnel-status">
        <span className={'tunnel-dot ' + (online === true ? 'on' : online === false ? 'off' : 'idle')} />
        <span className="tunnel-state">{state}</span>
        {st?.online && st.latencyMs != null ? <span className="tunnel-meta">{st.latencyMs} ms</span> : null}
        {st?.checkedAt ? <span className="tunnel-meta">{t('检测于 {time}', { time: fmt(st.checkedAt) })}</span> : null}
        {st?.okAt && st.online === false ? <span className="tunnel-meta">{t('上次正常 {time}', { time: fmt(st.okAt) })}</span> : null}
      </div>

      {st?.online === false && st.error ? <div className="tunnel-err">{st.error}</div> : null}

      <div className="tunnel-actions">
        <button className="btn btn-sm" onClick={check} disabled={busy || !st?.publicUrl}>
          <RefreshCw size={13} /> {t('立即检测')}
        </button>
        <button className="btn btn-sm" onClick={copy} disabled={!st?.publicUrl}>
          <Copy size={13} /> {t('复制访问地址')}
        </button>
      </div>

      {msg ? <div className="tunnel-msg">{msg}</div> : null}

      <details className="tunnel-help">
        <summary>{t('怎么接 frp（点击展开）')}</summary>
        <p className="sec-hint" style={{ marginTop: 8 }}>
          {t('服务器上装 frps 并把 443 的')} <code>/~!frp</code>{' '}
          {t('反代到 frps（复用现有证书，不用开新端口）， 家里这台按下面跑 frpc。改完回到这里点「立即检测」。')}
        </p>
        <pre className="tunnel-pre">{FRPC_TEMPLATE}</pre>
      </details>
    </div>
  )
}
