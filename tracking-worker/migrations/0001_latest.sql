-- 本祭支援ツール：3台の最新位置だけを持つ（走行履歴は保存しない）
-- 未測位の lat / lon / fix_at_ms は NULL（0,0 のダミー位置は入れない）
CREATE TABLE vehicles_latest (
  vehicle_id TEXT PRIMARY KEY
    CHECK (vehicle_id IN ('vehicle-1', 'vehicle-2', 'vehicle-3')),
  lat REAL,
  lon REAL,
  fix_at_ms INTEGER,           -- 端末が測位した時刻（Unixミリ秒）。位置の古さの唯一の基準
  fix_received_at_ms INTEGER,  -- その測位をサーバーが受け取った時刻
  last_contact_at_ms INTEGER,  -- 端末から最後に正しく届いた時刻（座標なしの通信確認も含む）
  telemetry_at_ms INTEGER,     -- 電池・充電の情報の時刻（端末の時刻）
  accuracy_m REAL,
  speed_kmh REAL,
  heading_deg REAL,
  battery_pct REAL,
  charging INTEGER
);
INSERT INTO vehicles_latest (vehicle_id)
  VALUES ('vehicle-1'), ('vehicle-2'), ('vehicle-3');
