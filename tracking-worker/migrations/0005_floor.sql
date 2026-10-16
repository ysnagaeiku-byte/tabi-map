-- 構内図（各号館の配置図）。大学公式サイトが公開している PDF をページごとの画像（WebP）にしたもの。
-- 公開リポジトリには置かず、ここに置いて閲覧キーで守る。入れ替えは本部版のキーだけ（scripts/upload-floor.mjs）
CREATE TABLE fest_floor (
  bld TEXT NOT NULL,                 -- b8・b9・b10
  page INTEGER NOT NULL,             -- 1〜
  label TEXT NOT NULL,               -- タブの名前（例：1階〜M3階）
  mime TEXT NOT NULL,                -- image/webp・image/png
  w INTEGER NOT NULL,
  h INTEGER NOT NULL,
  data BLOB NOT NULL,
  src TEXT NOT NULL,                 -- 元の PDF（出典）
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (bld, page)
);
