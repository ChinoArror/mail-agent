CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mailboxes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  local_part TEXT UNIQUE NOT NULL,
  domain TEXT NOT NULL DEFAULT '112327.xyz',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  mailbox_id TEXT,
  direction TEXT NOT NULL,
  from_addr TEXT,
  to_addr TEXT,
  cc TEXT,
  bcc TEXT,
  subject TEXT,
  text_body TEXT,
  html_body TEXT,
  raw_r2_key TEXT,
  status TEXT NOT NULL,
  resend_id TEXT,
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id)
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email_id TEXT,
  draft_id TEXT,
  direction TEXT,
  filename TEXT NOT NULL,
  content_type TEXT,
  size_bytes INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  mailbox_id TEXT,
  to_addr TEXT,
  cc TEXT,
  bcc TEXT,
  subject TEXT,
  text_body TEXT,
  html_body TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id)
);

CREATE TABLE IF NOT EXISTS usage_limits (
  user_id TEXT PRIMARY KEY,
  max_mailboxes INTEGER,
  max_send_per_day INTEGER,
  max_receive_per_day INTEGER,
  max_attachment_total_bytes INTEGER,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS usage_counters (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, type, period_start, period_end),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS agent_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  draft_id TEXT,
  command TEXT NOT NULL,
  input TEXT,
  output TEXT,
  model TEXT,
  estimated_tokens INTEGER,
  actual_tokens INTEGER,
  quota_reported INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS send_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'resend',
  provider_message_id TEXT,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (email_id) REFERENCES emails(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  actor_username TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mailboxes_email ON mailboxes(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mailboxes_local_part ON mailboxes(local_part);
CREATE INDEX IF NOT EXISTS idx_mailboxes_user_id ON mailboxes(user_id);
CREATE INDEX IF NOT EXISTS idx_emails_user_id_created_at ON emails(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_emails_mailbox_id_created_at ON emails(mailbox_id, created_at);
CREATE INDEX IF NOT EXISTS idx_drafts_user_id_updated_at ON drafts(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_attachments_user_id ON attachments(user_id);
CREATE INDEX IF NOT EXISTS idx_attachments_email_id ON attachments(email_id);
CREATE INDEX IF NOT EXISTS idx_attachments_draft_id ON attachments(draft_id);
CREATE INDEX IF NOT EXISTS idx_usage_counters_user_type_period ON usage_counters(user_id, type, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_user_id_created_at ON agent_jobs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
