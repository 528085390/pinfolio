// 主机指标表：每台机每 5 分钟一行，整条 JSON 原样存。
// 采集脚本的字段还在长（将来可能加网卡、温度），所以不拆列，读的时候再解析。
export const METRICS_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS host_metrics (',
  '  host TEXT NOT NULL,',
  '  ts INTEGER NOT NULL,',
  '  data TEXT NOT NULL,',
  '  received_at TEXT NOT NULL,',
  '  PRIMARY KEY (host, ts)',
  ');',
  'CREATE INDEX IF NOT EXISTS idx_host_metrics_host_ts ON host_metrics (host, ts DESC);',
].join('\n')
