// 原生多协议观测台表结构（monitors 与 heartbeats）
// 2026-11-08 原生多协议探针引擎全面内化后引入；2026-11-09 纳入 migrations v4 演进管线。
export const MONITOR_SCHEMA = `
CREATE TABLE IF NOT EXISTS monitors (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT NOT NULL,
  type                 TEXT NOT NULL,
  group_name           TEXT NOT NULL DEFAULT '',
  active               INTEGER NOT NULL DEFAULT 1,
  interval             INTEGER NOT NULL DEFAULT 60,
  timeout              INTEGER NOT NULL DEFAULT 20,
  maxretries           INTEGER NOT NULL DEFAULT 1,
  url                  TEXT,
  keyword              TEXT,
  invert_keyword       INTEGER NOT NULL DEFAULT 0,
  accepted_statuscodes TEXT NOT NULL DEFAULT '200-299',
  hostname             TEXT,
  port                 INTEGER,
  ssh_username         TEXT,
  ssh_password         TEXT,
  ssh_private_key      TEXT,
  ssh_passphrase       TEXT,
  ssh_auth_method      TEXT DEFAULT 'privateKey',
  ssh_command          TEXT,
  push_token           TEXT,
  outbound_mode        TEXT,
  policy_json          TEXT,
  description          TEXT NOT NULL DEFAULT '',
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS heartbeats (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id  INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  status      INTEGER NOT NULL,
  ping        INTEGER,
  msg         TEXT NOT NULL DEFAULT '',
  time        TEXT NOT NULL,
  duration    INTEGER NOT NULL DEFAULT 0,
  down_count  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_heartbeats_monitor_time ON heartbeats(monitor_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_heartbeats_time ON heartbeats(time DESC);
`
