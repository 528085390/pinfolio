// 便签附件（2026-10-26 建表，2026-11-10 支持任意类型 + 对象存储）。
// 正文里用标准 Markdown 引用：图片 `![](/api/attachments/<id>)`，其它文件 `[文件名](/api/attachments/<id>)`。
// 真身在本地 data/uploads/<id>.<ext> 或对象存储 <prefix><id>.<ext>；这张表只记元数据。
// 「谁在用这个附件」的唯一真相是便签正文 —— note_id 只是缓存，正文里没引用就解绑（见 attachments/store.ts）。
export const ATTACHMENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS attachments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id    INTEGER REFERENCES notes(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL DEFAULT 'image',
  mime       TEXT NOT NULL,
  ext        TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  storage    TEXT NOT NULL DEFAULT 'local',
  object_key TEXT,
  sha256     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_note ON attachments(note_id);
`
