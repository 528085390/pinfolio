import { Activity, Server, Terminal } from 'lucide-react'

/**
 * 观测页的引导卡：没配 Kuma 时显示，替掉「读不到观测项 + 报错」那种像坏了的样子。
 * 观测页本身不探测（探测在 Kuma 里），所以没有 Kuma 时其余六页完全不受影响——
 * 这点要写清楚，否则用户会以为整个应用挂了。
 */
export function KumaGuide({ url }: { url?: string }) {
  return (
    <div className="kuma-guide">
      <div className="kuma-guide-head">
        <span className="kuma-guide-icon"><Activity size={20} /></span>
        <div>
          <div className="kuma-guide-title">观测页还没接上 Uptime Kuma</div>
          <div className="kuma-guide-sub">
            这一页只是 Kuma 的界面，探测是 Kuma 在跑。没接上时<strong>其余六页照常可用</strong>，不需要为了用便签去装 Kuma。
          </div>
        </div>
      </div>

      <ol className="kuma-guide-steps">
        <li>
          <div className="kuma-guide-step-title"><Server size={14} /> 起一个 Uptime Kuma</div>
          <pre className="kuma-guide-code">{`docker run -d --name kuma -p 3001:3001 \\
  -v kuma-data:/app/data louislam/uptime-kuma:2`}</pre>
          <div className="kuma-guide-hint">
            或者用你已经在跑的 Kuma（<code>docker compose</code> 里再加一个服务也行），地址能通就好。
          </div>
        </li>
        <li>
          <div className="kuma-guide-step-title"><Terminal size={14} /> 在 Kuma 里建一个公开状态页</div>
          <div className="kuma-guide-hint">
            状态页 → 新建，slug 填 <code>obs</code>（不是这个值就设 <code>KUMA_SLUG</code>），把要看的观测项勾进去。
          </div>
        </li>
        <li>
          <div className="kuma-guide-step-title"><Terminal size={14} /> 告诉 pinfolio 它在哪</div>
          <pre className="kuma-guide-code">{`KUMA_URL=http://127.0.0.1:3001   # 你实际的地址
KUMA_USER=admin
KUMA_PASS=你的 Kuma 密码`}</pre>
          <div className="kuma-guide-hint">
            Docker 部署就写进 <code>docker-compose.yml</code> 的 <code>environment</code>；改完重启进程/容器。
            当前探测地址：<code>{url || 'http://127.0.0.1:3001'}</code>。
          </div>
        </li>
      </ol>

      <div className="kuma-guide-foot">
        连上之后这一页会自动变成观测台（卡片 / 色条 / 详情抽屉），不用改任何代码。
      </div>
    </div>
  )
}
