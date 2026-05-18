ALTER TABLE emails ADD COLUMN is_starred INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_login_at TEXT;
ALTER TABLE users ADD COLUMN last_login_ip TEXT;
ALTER TABLE users ADD COLUMN last_login_user_agent TEXT;

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  role_key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0,
  permissions TEXT NOT NULL DEFAULT '[]',
  limits_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  type TEXT NOT NULL DEFAULT 'string',
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_emails_user_starred_created_at ON emails(user_id, is_starred, created_at);
CREATE INDEX IF NOT EXISTS idx_roles_sort_order ON roles(sort_order);
