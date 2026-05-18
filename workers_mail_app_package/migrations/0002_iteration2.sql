ALTER TABLE mailboxes ADD COLUMN alias TEXT;

ALTER TABLE emails ADD COLUMN is_read INTEGER NOT NULL DEFAULT 0;
ALTER TABLE emails ADD COLUMN folder TEXT NOT NULL DEFAULT 'mail';
ALTER TABLE emails ADD COLUMN archived_at TEXT;
ALTER TABLE emails ADD COLUMN deleted_at TEXT;

ALTER TABLE attachments ADD COLUMN file_type TEXT;
ALTER TABLE attachments ADD COLUMN preview_r2_key TEXT;
ALTER TABLE attachments ADD COLUMN scan_status TEXT NOT NULL DEFAULT 'passed';
ALTER TABLE attachments ADD COLUMN scan_error TEXT;

ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN avatar_object_key TEXT;
ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'zh';
ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'system';

CREATE TABLE IF NOT EXISTS draft_versions (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  mailbox_id TEXT,
  to_addr TEXT,
  cc TEXT,
  bcc TEXT,
  subject TEXT,
  text_body TEXT,
  html_body TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (draft_id) REFERENCES drafts(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_mailboxes_alias ON mailboxes(alias);
CREATE INDEX IF NOT EXISTS idx_emails_user_folder_created_at ON emails(user_id, folder, created_at);
CREATE INDEX IF NOT EXISTS idx_emails_user_read_created_at ON emails(user_id, is_read, created_at);
CREATE INDEX IF NOT EXISTS idx_emails_created_at ON emails(created_at);
CREATE INDEX IF NOT EXISTS idx_attachments_created_at ON attachments(created_at);
CREATE INDEX IF NOT EXISTS idx_attachments_file_type ON attachments(file_type);
CREATE INDEX IF NOT EXISTS idx_draft_versions_draft_created ON draft_versions(draft_id, created_at);
