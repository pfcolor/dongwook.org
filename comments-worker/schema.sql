CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL,
  name       TEXT NOT NULL,
  body       TEXT NOT NULL,
  -- visible: 공개, hidden: 숨김(복원 가능)
  status     TEXT NOT NULL DEFAULT 'visible',
  reason     TEXT,
  ip_hash    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_slug ON comments (slug, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_ip ON comments (ip_hash, created_at);
