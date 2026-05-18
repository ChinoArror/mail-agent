ALTER TABLE users ADD COLUMN app_role_id TEXT;
ALTER TABLE users ADD COLUMN draft_retention_days INTEGER NOT NULL DEFAULT 7;

ALTER TABLE app_settings ADD COLUMN r2_key TEXT;

CREATE INDEX IF NOT EXISTS idx_users_app_role_id ON users(app_role_id);
CREATE INDEX IF NOT EXISTS idx_drafts_user_status_updated_at ON drafts(user_id, status, updated_at);
