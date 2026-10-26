// 便签图片（2026-10-26）。正文里用标准 Markdown `![](/api/attachments/<id>)` 引用，
// 真身落在 data/uploads/<id>.<ext>；这张表只记元数据。
// 「谁在用这张图」的唯一真相是便签正文 —— note_id 只是缓存，正文里没引用就解绑（见 attachments/store.ts）。
export const ATTACHMENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS attachments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id    INTEGER REFERENCES notes(id) ON DELETE SET NULL,
  mime       TEXT NOT NULL,
  ext        TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_note ON attachments(note_id);
`
