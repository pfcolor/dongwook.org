-- 관리 링크 메일 요청 횟수 제한 같은 작은 상태값을 담는다.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
