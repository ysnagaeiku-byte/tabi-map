-- 本部の時刻表（開錠・施錠時刻、エレベーターの使用可否）。地図は公開のため、値は受信APIに置いて閲覧キーで守る
CREATE TABLE fest_settings (
  key TEXT PRIMARY KEY CHECK (key IN ('schedule')),
  value TEXT NOT NULL,          -- JSON（src/schedule.ts の形）
  updated_at_ms INTEGER NOT NULL
);
