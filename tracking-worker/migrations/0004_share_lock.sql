-- 取り消し・期限切れの配布版で、地図ごと止めるか（端末の画面を閉じる）。データ（車両・時刻表）はどちらでも止まる
ALTER TABLE fest_shares ADD COLUMN lock INTEGER NOT NULL DEFAULT 0;            -- 取り消し時に「地図も止める」を選んだ
ALTER TABLE fest_shares ADD COLUMN lock_on_expiry INTEGER NOT NULL DEFAULT 0;  -- 発行時に「期限が来たら地図も止める」を選んだ
