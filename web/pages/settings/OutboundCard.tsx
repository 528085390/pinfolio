import { Network, RefreshCw, Trash2 } from 'lucide-react'
import { t } from '../../lib/i18n'
import type { ProxyProtocol } from '../../lib/api'
import { PROTOCOLS, changedAtText, outboundSummary } from './outbound'
import { useOutbound } from './useOutbound'

// 设置页「出站模式」卡片（spec §10.1 五块）：
//   ① 两枚按钮「直连」/「经代理」（不是 checkbox —— 避免「关 = 直连」的歧义）
//   ② 代理表单（协议 / 主机 / 端口 / 用户名 / 密码），切直连时变灰但仍显示已存的配置
//   ③ 底部：当前出站摘要 + 上次切换时间 + 保存 + 测试连通
//   ④ 两条灰字（逐字照 spec：绿字含义、通知不走这个开关）
//   ⑤ 保存成功 toast：「已切换，正在重新探测 N 个观测项…」
//
// 密码这一格的红线：库里存着密码时（hasPassword）输入框**留空**、占位写「已保存，留空表示不修改」，
// 永远不回显；「没动框 = 不发送 password 键」这件事在 buildOutboundPayload（outbound.ts）里定，组件不许自己拼请求体。
export function OutboundCard() {
  const ob = useOutbound()
  const f = ob.pending
  const direct = f.mode === 'direct'
  // 还没读到（或读失败）时不能假装「当前是直连」：模式不高亮、表单变灰、摘要写「正在读取」
  const known = ob.cfg !== null
  const dim = !known || direct
  const hasPw = ob.cfg?.proxy?.hasPassword === true
  const busy = ob.busy !== ''

  return (
    <div className="card sec-card">
      <div className="section-title" style={{ marginTop: 0 }}>
        <Network size={14} /> {t('出站模式')}
      </div>
      <p className="sec-hint">
        {t('观测台的所有探测（HTTP / TCP / SSH）都从这条出口出去。切到「直连」时下面的代理配置会留着，切回「经代理」不用重填。')}
      </p>

      {ob.err ? <div className="alert" style={{ marginBottom: 12 }}>{ob.err}</div> : null}

      {/* ① 两枚按钮 —— 不是 checkbox */}
      <div className="row" style={{ gap: 6, marginBottom: 12 }}>
        <button className={'chip' + (known && direct ? ' active' : '')} disabled={busy}
          onClick={() => ob.patch({ mode: 'direct' })}>
          {t('直连')}
        </button>
        <button className={'chip' + (known && !direct ? ' active' : '')} disabled={busy}
          onClick={() => ob.patch({ mode: 'proxy' })}>
          {t('经代理')}
        </button>
      </div>

      {/* ② 代理表单：直连时变灰但仍显示，方便确认切回去会发生什么 */}
      <div className="form-grid" style={{ opacity: dim ? 0.55 : 1 }}>
        <div className="field">
          <label className="field-label" htmlFor="ob-protocol">{t('协议')}</label>
          <select id="ob-protocol" className="select" value={f.protocol} disabled={dim}
            onChange={(e) => ob.patch({ protocol: e.target.value as ProxyProtocol })}>
            {PROTOCOLS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="ob-port">{t('端口')}</label>
          <input id="ob-port" className="input" inputMode="numeric" value={f.port} disabled={dim}
            placeholder="10808" spellCheck={false}
            onChange={(e) => ob.patch({ port: e.target.value })} />
        </div>

        <div className="field span-2">
          <label className="field-label" htmlFor="ob-host">{t('代理主机')}</label>
          <input id="ob-host" className="input" value={f.host} disabled={dim}
            placeholder="127.0.0.1" spellCheck={false}
            onChange={(e) => ob.patch({ host: e.target.value })} />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="ob-username">{t('用户名')}</label>
          <input id="ob-username" className="input" value={f.username} disabled={dim}
            placeholder={t('可空')} spellCheck={false} autoComplete="off"
            onChange={(e) => ob.patch({ username: e.target.value, usernameTouched: true })} />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="ob-password">
            {t('密码')}
            {hasPw ? <span className="sec-tag">{t('已保存')}</span> : null}
          </label>
          <input id="ob-password" className="input" type="password" value={f.password} disabled={dim}
            placeholder={hasPw ? t('已保存，留空表示不修改') : t('可空')}
            autoComplete="new-password"
            onChange={(e) => ob.patch({ password: e.target.value, clearPassword: false })} />
        </div>
      </div>

      {hasPw || f.clearPassword ? (
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <button className="btn btn-ghost btn-sm" disabled={direct || busy}
            onClick={() => ob.patch({ password: '', clearPassword: !f.clearPassword })}>
            <Trash2 size={13} /> {f.clearPassword ? t('撤销清除') : t('清除密码')}
          </button>
          {f.clearPassword ? <span className="field-hint">{t('保存后清除已存密码')}</span> : null}
        </div>
      ) : null}

      {/* ③ 当前摘要 + 上次切换 + 保存 / 测试 */}
      <div className="divider" style={{ margin: '14px 0' }} />
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="sec-title">{known ? outboundSummary(ob.cfg) : t('正在读取出站设置…')}</span>
        {ob.cfg?.changedAt ? <span className="sec-sub" style={{ marginTop: 0 }}>{changedAtText(ob.cfg.changedAt)}</span> : null}
        <span className="grow" />
        <button className="btn btn-primary" disabled={busy || !known} onClick={() => ob.save(f)}>{t('保存')}</button>
        <button className="btn" disabled={busy || !known} onClick={ob.test}>
          <RefreshCw size={13} /> {ob.busy === 'test' ? t('测试中…') : t('测试连通')}
        </button>
      </div>

      {/* 没读到（或读失败了）时按钮为什么是灰的 —— 别让用户以为界面卡了 */}
      {known ? null : (
        <div className="field-hint" style={{ marginTop: 8, color: 'var(--ink-2)' }}>
          {t('还没读取出站设置：保存与测试连通先禁用，免得把真实出站误切成直连')}
        </div>
      )}

      {/* ④ 两条灰字 —— 文案逐字照 spec §10.1 第 4 点，别改字 */}
      <div className="field-hint" style={{ marginTop: 12, lineHeight: 1.7 }}>
        {t('经代理的绿色只代表机器存活，不代表国内直连可用')}
        <br />
        {t('通知推送（webhook / 邮件）不受此开关影响，仍走直连')}
      </div>

      {/* ⑤ 保存成功 / 测试结果 */}
      {ob.msg ? <div className="field-hint" style={{ marginTop: 8, color: 'var(--ink-2)' }}>{ob.msg}</div> : null}
    </div>
  )
}
