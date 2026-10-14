-- 配布版のキー（本部版＝全権限のキーは Worker Secret の VIEW_TOKEN_SHA256。ここは本部が発行する制限つきのキー）
-- 実際のキーは保存せず SHA-256 だけを持つ。取り消し・期限切れのキーは受け付けない
CREATE TABLE fest_shares (
  id TEXT PRIMARY KEY,               -- 一覧・取り消し用の短いID（秘密ではない）
  token_sha256 TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,               -- 配布先の名前（例：〇〇係）
  perms TEXT NOT NULL,               -- JSON {"settings":bool,"pins":bool,"edit":bool}（true＝許可）
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER,             -- NULL＝期限なし
  revoked_at_ms INTEGER              -- 取り消した時刻（NULL＝有効）
);
