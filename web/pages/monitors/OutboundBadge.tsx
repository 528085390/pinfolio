import { t } from '../../lib/i18n'
import { outboundSummary } from '../settings/outbound'
import { useOutbound } from '../settings/useOutbound'

/**
 * 观测页页头的「出站：…」徽标（task 14a）
 *
 * 它只回答一句话：**观测台的探测现在从哪条出口出去**。三条边界：
 *
 *   1. 全局值读不到（GET 还没回来 / 失败）→ **一个字节都不渲染**。宁可什么都不显示，
 *      也不许「先写个直连、回头再改」—— 那是 Task 8 Important-1 的同一类陷阱（界面谎报当前态）。
 *   2. 文本走设置页那套纯函数（outboundSummary → proxyLine），永远是「协议 host:port」，
 *      **不含账号、密码、hasPassword**：页头是给人扫一眼的地方，凭据留在设置页那张卡里。
 *   3. 徽标不参与任何状态判断：卡片的绿/红、统计、筛选全都不看它。
 *      经代理时的绿色只代表机器活着（见下面的 title），别把它读成「国内直连可用」。
 */
export function OutboundBadge() {
  // 复用设置页那只 hook 的 GET（同一个 /api/outbound）。err 故意不显示：
  // 出站设置读不到时观测台照常能用，红字归设置页那张卡，页头不重复喊。
  const { cfg } = useOutbound()
  if (!cfg) return null

  const proxy = cfg.mode === 'proxy'
  return (
    <div
      className={'monitor-outbound' + (proxy ? ' is-proxy' : ' is-direct')}
      title={proxy
        ? t('经代理的绿色只代表机器存活，不代表国内直连可用')
        : t('直连的绿色代表本机不经代理直接可达')}
    >
      {outboundSummary(cfg)}
    </div>
  )
}
