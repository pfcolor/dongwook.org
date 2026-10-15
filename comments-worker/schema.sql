CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL,
  name       TEXT NOT NULL,
  body       TEXT NOT NULL,
  -- visible: 공개, hidden: 숨김(복원 가능)
  status     TEXT NOT NULL DEFAULT 'visible',
  reason     TEXT,
  -- 답글이면 맨 위 댓글의 id(답글에 대한 답글도 같은 묶음에 붙는다)
  parent_id  TEXT,
  -- 1이면 글쓴이(동욱)가 쓴 답글
  is_owner   INTEGER NOT NULL DEFAULT 0,
  ip_hash    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_slug ON comments (slug, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_ip ON comments (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments (parent_id);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
