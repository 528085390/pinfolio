// 邮件页（工具栏、列表、阅读器、账号表单）的英文译文。
// 只收本区域的文案；公共词在 common.ts，外壳在 shell.ts。
import type { Dict } from '../core'

export const mail: Dict = {
  // 工具条
  '选择文件夹（只读）': 'Choose a folder (read-only)',
  '收件箱': 'Inbox',
  '每 {n} 秒自动刷新；页面切到后台时暂停。这个时间是数据从邮箱服务器取回的时刻（可能命中 60 秒缓存）。':
    'Auto-refreshes every {n}s and pauses while the page is in the background. This is when the data was fetched from the mail server (it may hit the 60-second cache).',
  '数据截至 {time}': 'Data as of {time}',
  '立即刷新（绕过 60 秒缓存）': 'Refresh now (bypasses the 60-second cache)',
  '刷新中': 'Refreshing',
  '管理邮箱账号': 'Manage mailbox accounts',
  '邮箱': 'Mailbox',
  '在当前已加载的 {n} 封里筛选（发件人 / 主题 / 摘要）': 'Filter the {n} loaded messages (sender / subject / snippet)',
  '只看未读': 'Unread only',

  // 列表
  '（无发件人）': '(no sender)',
  '（无主题）': '(no subject)',
  '（没有可预览的正文）': '(no preview text)',
  '服务器上是未读': 'Unread on the server',
  '正在取信…': 'Fetching mail…',
  '没有符合筛选条件的邮件': 'No messages match the filters',
  '{folder} 里没有邮件': '{folder} is empty',
  '清空筛选条件或取消「只看未读」试试。': 'Try clearing the filters or turning off “unread only”.',
  '换个文件夹看看，或者点右上角刷新。': 'Try another folder, or hit refresh in the top-right corner.',
  '上一页': 'Previous',
  '下一页': 'Next',
  '{from}–{to} / 共 {total} 封': (v) => `${v.from}–${v.to} / ${v.total}`,
  '筛选出 {n} 封': (v) => `${v.n} filtered`,

  // 空态
  '还没有添加邮箱': 'No mailbox added yet',
  '支持 Gmail / QQ / 163 等任意 IMAP 邮箱，只收信、不改变服务器上的任何状态。':
    'Works with any IMAP mailbox such as Gmail / QQ / 163; it only reads and never changes anything on the server.',
  'Gmail 用「应用专用密码」，QQ 和 163 用「授权码」。': 'Use an app password for Gmail, and an auth code for QQ and 163.',
  '选一封邮件': 'Select a message',
  '点左边的邮件，正文就显示在这里（不会把服务器上的邮件标成已读）。':
    'Click a message on the left and its body shows up here (nothing on the server is marked as read).',
  '返回列表': 'Back to list',

  // 阅读器
  '发件人': 'From',
  '收件人': 'To',
  '抄送': 'Cc',
  '时间': 'Date',
  '（无）': '(none)',
  '这封邮件打不开': 'This message cannot be opened',
  '已拦截 {n} 张外部图片（防止追踪像素，不影响邮箱里的已读状态）':
    (v) => `${v.n} remote ${Number(v.n) === 1 ? 'image' : 'images'} blocked (stops tracking pixels; does not affect the read state in the mailbox)`,
  '显示图片': 'Show images',
  '显示图片（{n}）': (v) => `Show images (${v.n})`,
  '隐藏图片': 'Hide images',
  '不再请求发件人的图片': 'Stop requesting the sender’s images',
  '加载邮件里的远程图片': 'Load the remote images in this message',
  '（这封邮件没有纯文本正文）': '(this message has no plain-text body)',
  '显示 HTML 排版': 'Show the HTML layout',
  '这封邮件只有纯文本': 'This message is plain text only',
  '纯文本': 'Plain text',
  '附件 {n} 个': (v) => `${v.n} ${Number(v.n) === 1 ? 'attachment' : 'attachments'}`,
  '，': ', ',
  '；': '; ',

  // 账号抽屉
  '邮箱账号': 'Mailbox accounts',
  '添加邮箱': 'Add mailbox',
  '编辑邮箱': 'Edit mailbox',
  '添加': 'Add',
  '返回': 'Back',
  '测试连接': 'Test connection',
  '测试中…': 'Testing…',
  '保存中…': 'Saving…',
  '清理中…': 'Clearing…',
  '清除本地已读标记': 'Clear local read marks',
  '已清除本机全部已读标记（服务器上的邮件状态从未被改动）':
    'Cleared every local read mark (nothing on the server was ever changed)',
  '连接成功：{server}，看到 {folders} 个文件夹{enc}': 'Connected: {server}, {folders} folders found{enc}',
  '，连接已加密': ', connection encrypted',

  // 账号列表
  '还没有邮箱。点下面的「添加邮箱」，Gmail 用应用专用密码，QQ / 163 用授权码。':
    'No mailbox yet. Click “Add mailbox” below; use an app password for Gmail and an auth code for QQ / 163.',
  '密码解不开（主密钥换过或数据被改），请点编辑重填一次':
    'The password cannot be decrypted (the master key changed or the data was altered); click Edit and enter it again',
  '确认删除': 'Confirm delete',
  '删除账号（同时清掉它的本地缓存和已读标记）': 'Delete the account (also clears its local cache and read marks)',

  // 账号表单
  '常用': 'Common',
  '列表和账号筛选里显示，随便写': 'Shown in the list and the account filter; anything you like',
  '比如：个人 Gmail': 'e.g. Personal Gmail',
  '邮箱地址': 'Email address',
  '选填，只是给你自己看的': 'Optional, only for your own reference',
  'IMAP 服务器': 'IMAP server',
  '收信服务器，不是 SMTP': 'The incoming server, not SMTP',
  '端口': 'Port',
  '用户名': 'Username',
  '一般就是完整邮箱地址': 'Usually the full email address',
  '密码 / 授权码': 'Password / auth code',
  '不会显示在任何接口返回值里': 'Never returned by any API',
  '留空表示不修改': 'Leave blank to keep the current one',
  '应用专用密码 / 授权码': 'App password / auth code',
  '（不修改就留空）': '(leave blank to keep it)',
  '加密方式': 'Encryption',
  'SSL/TLS（993，推荐）': 'SSL/TLS (993, recommended)',
  'STARTTLS（143）': 'STARTTLS (143)',
  '不加密（仅本机调试）': 'No encryption (local debugging only)',
  '代理（可选）': 'Proxy (optional)',
  '国内直连 imap.gmail.com 常超时：填本机 SOCKS5 代理，如 socks5://127.0.0.1:10808；QQ/163 留空直连':
    'Direct connections to imap.gmail.com often time out in mainland China: enter a local SOCKS5 proxy such as socks5://127.0.0.1:10808; leave it blank to connect directly for QQ/163',
  '只做收信阅读：本程序只用 SELECT/SEARCH/FETCH（BODY.PEEK），不会把邮件标成已读，也不会删信、移动、发信。':
    'Read-only: this app only ever issues SELECT/SEARCH/FETCH (BODY.PEEK); it never marks mail as read, and never deletes, moves or sends anything.',
  'QQ 邮箱': 'QQ Mail',
  '163 邮箱': '163 Mail',
  '密码要填「应用专用密码」：Google 账号 → 安全性 → 两步验证 → 应用专用密码。普通密码一定登录失败。':
    'The password must be an “app password”: Google Account → Security → 2-Step Verification → App passwords. A normal password will always fail.',
  '密码要填「授权码」：QQ 邮箱设置 → 账号 → 开启 IMAP 服务后生成。':
    'The password must be an “auth code”: QQ Mail settings → Account → enable the IMAP service, then generate one.',
  '密码要填「授权码」；163 要求客户端发 IMAP ID，本程序已自动处理。':
    'The password must be an “auth code”; 163 requires clients to send an IMAP ID, which this app handles automatically.',

  // 列表接口的错误汇总（useInbox）
  '账号': 'Account',
  '{label}：{error}': '{label}: {error}',
}
