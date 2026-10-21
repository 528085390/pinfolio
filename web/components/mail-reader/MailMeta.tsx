import type { MailMessage } from '../../lib/api'
import { fullTime } from '../../lib/format'
import { addrList, addrText } from './text'

/** 阅读区顶部：主题 + 发件人 / 收件人 / 抄送 / 时间 / 邮箱几行 */
export function MailMeta({ msg, folderLabel }: { msg: MailMessage; folderLabel?: string }) {
  return (
    <div className="mail-reader-head">
      <h2 className="mail-reader-subject">{msg.subject || '（无主题）'}</h2>
      <div className="mail-reader-meta">
        <div className="mail-meta-row">
          <span className="mail-meta-k">发件人</span>
          <span className="mail-meta-v">{addrText(msg.from) || '（无）'}</span>
        </div>
        <div className="mail-meta-row">
          <span className="mail-meta-k">收件人</span>
          <span className="mail-meta-v">{addrList(msg.to)}</span>
        </div>
        {msg.cc && msg.cc.length ? (
          <div className="mail-meta-row">
            <span className="mail-meta-k">抄送</span>
            <span className="mail-meta-v">{addrList(msg.cc)}</span>
          </div>
        ) : null}
        <div className="mail-meta-row">
          <span className="mail-meta-k">时间</span>
          <span className="mail-meta-v">{fullTime(msg.date)}</span>
        </div>
        <div className="mail-meta-row">
          <span className="mail-meta-k">邮箱</span>
          <span className="mail-meta-v">
            {msg.accountLabel}
            {msg.accountEmail ? ' · ' + msg.accountEmail : ''}
            {folderLabel ? ' · ' + folderLabel : ''}
          </span>
        </div>
      </div>
    </div>
  )
}
