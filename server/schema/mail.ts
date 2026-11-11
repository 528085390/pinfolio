// 邮件只读缓存：账号配置 + 「本页已读」本地标记（绝不回写 IMAP）。
export const MAIL_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS mail_accounts (',
  '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
  '  label TEXT NOT NULL DEFAULT \'\',',
  '  email TEXT NOT NULL DEFAULT \'\',',
  '  host TEXT NOT NULL,',
  '  port INTEGER NOT NULL DEFAULT 993,',
  '  username TEXT NOT NULL,',
  '  password TEXT NOT NULL DEFAULT \'\',',
  '  security TEXT NOT NULL DEFAULT \'ssl\',',
  '  proxy TEXT NOT NULL DEFAULT \'\',',
  '  enabled INTEGER NOT NULL DEFAULT 1,',
  '  sort INTEGER NOT NULL DEFAULT 0,',
  '  created_at TEXT NOT NULL,',
  '  updated_at TEXT NOT NULL',
  ');',
  'CREATE TABLE IF NOT EXISTS mail_local_read (',
  '  account_id INTEGER NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,',
  '  folder TEXT NOT NULL DEFAULT \'INBOX\',',
  '  uid INTEGER NOT NULL,',
  '  read_at TEXT NOT NULL,',
  '  PRIMARY KEY (account_id, folder, uid)',
  ');',
  'CREATE INDEX IF NOT EXISTS idx_mail_local_read_lookup ON mail_local_read(folder, account_id);',
].join('\n')

// 本地邮件库（2026-11-12 起增量同步落库）。三张表各管一件事：
//   mail_messages   列表元数据（发件人/主题/摘要/时间/未读），进页面直接读库、不打 IMAP；
//   mail_bodies     正文（HTML + 纯文本 + 附件清单），只有用户点开那一封时才写；
//   mail_sync_state 每个账号-文件夹的同步游标（uidValidity / uidNext / 总数 / 未读 / 状态）。
// 附件字节仍不落库：点下载时再回源，免得库和备份被附件撑爆。
// 老库由 migrations.ts 的 v6 建这三张表。
export const MAIL_CACHE_SCHEMA = `
CREATE TABLE IF NOT EXISTS mail_messages (
  account_id INTEGER NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
  folder     TEXT NOT NULL DEFAULT 'INBOX',
  uid        INTEGER NOT NULL,
  subject    TEXT NOT NULL DEFAULT '',
  from_name  TEXT NOT NULL DEFAULT '',
  from_addr  TEXT NOT NULL DEFAULT '',
  to_json    TEXT NOT NULL DEFAULT '[]',
  date       TEXT,
  ts         INTEGER NOT NULL DEFAULT 0,
  snippet    TEXT NOT NULL DEFAULT '',
  unread     INTEGER NOT NULL DEFAULT 1,
  flagged    INTEGER NOT NULL DEFAULT 0,
  size       INTEGER NOT NULL DEFAULT 0,
  synced_at  TEXT NOT NULL,
  PRIMARY KEY (account_id, folder, uid)
);
CREATE INDEX IF NOT EXISTS idx_mail_messages_list ON mail_messages(folder, ts DESC, uid DESC);
CREATE INDEX IF NOT EXISTS idx_mail_messages_acct ON mail_messages(account_id, folder, ts DESC, uid DESC);

CREATE TABLE IF NOT EXISTS mail_bodies (
  account_id       INTEGER NOT NULL,
  folder           TEXT NOT NULL DEFAULT 'INBOX',
  uid              INTEGER NOT NULL,
  subject          TEXT NOT NULL DEFAULT '',
  from_json        TEXT,
  to_json          TEXT NOT NULL DEFAULT '[]',
  cc_json          TEXT NOT NULL DEFAULT '[]',
  date             TEXT,
  message_id       TEXT,
  text             TEXT NOT NULL DEFAULT '',
  html             TEXT,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  bytes            INTEGER NOT NULL DEFAULT 0,
  fetched_at       TEXT NOT NULL,
  PRIMARY KEY (account_id, folder, uid)
);

CREATE TABLE IF NOT EXISTS mail_sync_state (
  account_id   INTEGER NOT NULL,
  folder       TEXT NOT NULL DEFAULT 'INBOX',
  uid_validity TEXT NOT NULL DEFAULT '',
  uid_next     INTEGER NOT NULL DEFAULT 0,
  total        INTEGER NOT NULL DEFAULT 0,
  unseen       INTEGER NOT NULL DEFAULT 0,
  done         INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'idle',
  error        TEXT NOT NULL DEFAULT '',
  last_sync_at TEXT,
  ms           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, folder)
);
`
