# 車両の位置の受信API（本祭支援ツール）

Traccar Client（無料の位置送信アプリ）から 1〜3号車の位置を受け取り、最新位置だけを D1 に保存して、本祭支援ツールの地図へ返す Cloudflare Worker です。スマホのアプリが送るので、地図のページを閉じても共有が続きます。

```
Traccar Client ──POST（送信キー付きURL）──▶ Worker ──▶ D1（3行：最新位置のみ）
本祭支援ツール ◀──GET（閲覧キー・10秒ごと）── Worker
```

- 走行履歴は保存しません（最新3行だけ）。
- 秘密値は Worker Secret にハッシュだけを置きます。実トークンは `tracking-worker/.secrets/`（git 対象外）にだけ保存します。
- このフォルダは GitHub Pages に載りません（公開は許可リストの地図資産のみ。`.github/workflows/deploy.yml`）。

## API

| メソッド・パス | 内容 |
| --- | --- |
| `POST /ingest/v1/<vehicle-id>/<送信キー>` | Traccar Client の送信先。`application/x-www-form-urlencoded`。互換用に GET クエリも受ける |
| `GET /api/v1/vehicles` | `Authorization: Bearer <閲覧キー>` で3台の最新位置（`schemaVersion: 1`）を返す |
| `OPTIONS /api/v1/vehicles` | 許可した Origin のプリフライトだけ 204（DB は読まない） |
| `GET /health` | `{"ok":true}` のみ |
| `GET /api/v1/schedule` | 閲覧キーで本部の時刻表（各号館の開錠・施錠時刻、9号館・10号館のエレベーターの可否）を返す |
| `PUT /api/v1/schedule` | 時刻表を保存（`{schedule, baseUpdatedAtMs}`。編集の権限が要る。ほかの端末が先に保存していれば 409） |
| `GET /api/v1/me` | このキーの種類と権限（`role: full｜share`、`perms: {settings, pins, edit}`、期限） |
| `GET・POST /api/v1/shares` | 本部版のキーだけ：配布版の一覧・発行（発行の応答でだけ実際のキーを返す） |
| `DELETE /api/v1/shares/<id>` | 本部版のキーだけ：配布版の取り消し（30秒ほどで反映） |

- 車両ID は `vehicle-1`〜`vehicle-3` 固定（表示名 1号車〜3号車）。
- 時刻表は警備に関わる内部資料に由来するため、公開の地図・リポジトリには書かず、受信API（D1 の `fest_settings`）に置いて閲覧キーで守ります。初期値は本番へ直接登録し、リポジトリには入れていません。
- 受信の扱い：
  - 新しい測位：位置を更新します。
  - 古い再送・重複：位置は戻さず 200 を返します。
  - 座標なし（通信確認）：通信時刻と電池だけを更新します。
  - 壊れた値・未来すぎる時刻：保存せず `200 accepted:false` を返します。
  - 保存失敗：503 を返し、端末に再送させます。
- 4xx は認証・形式の誤りだけに使います（現行の Traccar Client は先頭の送信が 2xx になるまで後続を送らないため）。

## 版

| もの | 版 |
| --- | --- |
| Node.js | 24.18.0（`brew install node@24`。keg-only のため `PATH=/opt/homebrew/opt/node@24/bin:$PATH`） |
| wrangler | 4.151.0（同梱 workerd 1.20261012.1 → `compatibility_date` 2026-10-12） |
| vitest / @cloudflare/vitest-plugin | 4.1.11 / 1.4.2 |
| typescript | 5.9.3 |
| Traccar Client（ソースで仕様確認） | アプリ 10.1.6、traccar_client_sdk ^1.1.2（2026-10-14 時点）。実機の版は導入時に記録する |

## ローカル開発

```sh
cd tracking-worker
npm ci
npm run secrets:local      # .dev.vars と .secrets/local.json（ダミー値）を作る
npm run db:local           # ローカル D1 に migration を適用
npm run dev                # http://127.0.0.1:8787
sh scripts/smoke-local.sh  # curl で受信・閲覧・CORS を確認（値は表示しない）
npm test                   # 自動テスト（Workers 実行環境＋ローカル D1）
npm run typecheck
```

地図は別の端末で `python3 -m http.server 8790 --bind 127.0.0.1`（リポジトリ直下）を起動し、`http://127.0.0.1:8790/index-google.html?m=senshu` で開きます。

1. ブラウザの開発者ツールで `localStorage.setItem('fest_track_cfg','{"apiBase":"http://127.0.0.1:8787"}')` を実行し、再読み込みします。受信APIの差し替えは localhost / 127.0.0.1 のページだけで効きます。
2. メニュー「位置情報共有設定」→「閲覧キー」に、`.secrets/local.json` の `viewToken` を入れます。

> **iCloud の注意**：このフォルダがデスクトップ（iCloud 同期）にあり、ディスクの空きが少ないと、`node_modules` の中身が Mac から退避されてテストが止まります。その場合は `node_modules` と `.wrangler` を iCloud 外（例：`~/.local/share/tabimap/tracking-worker/`）へ移し、シンボリックリンクにしてください。`npm ci` はリンクを消すため、実行後にもう一度移します。

## 本番の初回準備（本人の Cloudflare アカウントで実施）

無料プランのまま進めます。独自ドメインは不要です。

```sh
cd tracking-worker
npx wrangler login
npx wrangler d1 create festival-vehicle-tracking --location=apac
```

1. 表示された `database_id`（UUID）を `wrangler.jsonc` の仮値（`00000000-…`）と置き換えます。UUID は秘密ではありません。仮値のままでは `npm run deploy` が止まります。
2. migration と配置を行います。

   ```sh
   npx wrangler d1 migrations apply festival-vehicle-tracking --remote   # 0001（最新位置）・0002（時刻表）・0003（配布版のキー）
   npm run deploy            # 事前確認（scripts/check-deploy.mjs）→ wrangler deploy
   ```

   表示された `https://festival-vehicle-tracking.<アカウントのサブドメイン>.workers.dev` を控えます。Secret を入れるまでは、受信・閲覧とも 503 になります。
3. 秘密値を作って登録します。値は画面に出ません。

   ```sh
   npm run secrets:prod -- --base https://festival-vehicle-tracking.<サブドメイン>.workers.dev
   ```

   - Secret `DEVICE_AUTH_JSON`（車両ごとの端末ID＋送信キーのハッシュ）と `VIEW_TOKEN_SHA256` を `wrangler secret put` で登録します。
   - `tracking-worker/.secrets/production-setup.html`（設定シート：車両ごとのQRコード・本部の閲覧キー）を作ります。本部は地図の「位置情報共有設定」に閲覧キーを入れます。
4. 確認します。

   ```sh
   curl -s https://festival-vehicle-tracking.<サブドメイン>.workers.dev/health   # {"ok":true}
   ```

5. 受信APIの URL は公開してよい値です。`fest-vehicle-tracking.js` の `API_DEFAULT` に入れると、本部は閲覧キーの入力だけで使えます（設定済み：`https://festival-vehicle-tracking.festival-vehicle-tracking.workers.dev`。workers.dev のサブドメインは初回 deploy で自動登録された `festival-vehicle-tracking`）。
6. 地図の公開 URL（GitHub Pages）が変わったら、`wrangler.jsonc` の `vars.ALLOWED_ORIGINS`（scheme＋host のみ）を直して再配置します。

## スマホの設定（運転する人）

| 手順 | iPhone | Android |
| --- | --- | --- |
| 1. 導入 | App Store の「Traccar Client」（無料） | Google Play の「Traccar Client」（無料） |
| 2. 設定の読み込み | アプリの「設定を変更」→ 右上の QR ボタン → 設定シートの自分の車両の QR を読む →「新しい設定を適用しますか？」で OK | 同左 |
| 3. 権限 | 位置情報「常に」・「正確な位置情報」ON | 正確な位置・バックグラウンドの位置（常に許可）・通知を許可。電池の最適化を「制限なし」にする |
| 4. 開始 | 「継続追跡」を ON にしてから画面をロック。アプリを上にスワイプして終了しない | 「継続追跡」を ON。常駐通知を消さない・強制停止しない |
| 5. 確認 | 「ステータスを表示」に `Upload response 200` が出ること | 同左 |

QR に入る送信設定は `npm run secrets:prod` のオプションで変えられます。既定値は次のとおりです。
- 精度：`high`
- 間隔：10 秒
- 距離：0
- 静止時の送信間隔：60 秒
- 静止状態の検出：OFF
- オフラインバッファリング：ON
- CPU のスリープを防止：ON（Android）

公式ソースで確認した事実：
- 送信の間引きは「間隔・距離・角度のどれかを満たしたら送る」です。
- 静止状態の検出が ON のとき、止まっている間は「静止時の送信間隔」ごとに送ります。
- iPhone の設定画面では、精度「高」のとき間隔欄が表示されません。ただし QR で入れた間隔は間引きに使われます。

既定値は出発点で、保証値ではありません。実機で送信数・遅延・電池を測って決めます。代替の設定例を2つ挙げます。
- 電池を節約する：`--stop-detection true`
- 距離基準にする：`--distance 20 --interval 0`

## Secret・設定の一覧

| 名前 | 種類 | 内容 |
| --- | --- | --- |
| `DEVICE_AUTH_JSON` | Secret | `{"vehicle-1":{"deviceId":"…","tokenSha256":"<64hex>"}, …}` |
| `VIEW_TOKEN_SHA256` | Secret | 本部版（全権限）の閲覧キーの SHA-256。配布版のキーは D1 の `fest_shares` に SHA-256 だけを保存 |
| `ALLOWED_ORIGINS` | vars（公開） | 閲覧APIを読める地図の Origin（本番：`https://ysnagaeiku-byte.github.io`） |
| `DB` | D1 | `festival-vehicle-tracking` |

運用（開始・終了・端末交代・キーの失効・撤回）は [docs/festival-tracking-operations.md](../docs/festival-tracking-operations.md) を参照してください。
