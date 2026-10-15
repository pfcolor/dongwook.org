-- 답글(한 단계)과 글쓴이 표시. 이미 운영 중인 DB에 한 번만 적용한다.
ALTER TABLE comments ADD COLUMN parent_id TEXT;
ALTER TABLE comments ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments (parent_id);
