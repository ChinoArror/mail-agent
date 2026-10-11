-- Per-account interface preferences (theme color, display mode, animations), synced across devices.
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY,
  prefs TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
