#!/usr/bin/env node
// 送信トークン（車両ごと）と閲覧トークンを作り、Worker にはハッシュだけを渡す。
// 実トークンは tracking-worker/.secrets/（gitignore 済み・権限600）にだけ保存し、画面・ログには出さない。
//
//   node scripts/make-secrets.mjs local
//     ローカル開発用のダミー値を作る → .dev.vars（wrangler dev 用）と .secrets/local.json
//
//   node scripts/make-secrets.mjs prod --base https://<worker>.workers.dev [オプション]
//     本番用の値を作り（2回目以降は保持）、wrangler secret put で登録し、
//     .secrets/production-setup.html（運転する人ごとの設定QRコード・本部の閲覧キー）を作る
//     --rotate vehicle-2   その車両だけ送信キーと端末IDを作り直す（スマホの交代・紛失時）
//     --rotate view        閲覧キーだけ作り直す
//     --rotate all         すべて作り直す（本祭の終了時の失効にも使う）
//     --device vehicle-1=12345678   端末IDを自分で決める（既定は自動で作り、QRで端末に入れる）
//     --interval 10 --distance 0 --heartbeat 60 --stop-detection false --accuracy high   QRに入れる送信設定
//     --no-upload          Secret の登録をしない（設定シートだけ作り直す）

import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SECRETS = path.join(ROOT, ".secrets");
const VEHICLES = [
  ["vehicle-1", "1号車"],
  ["vehicle-2", "2号車"],
  ["vehicle-3", "3号車"],
];
const LOCAL_ORIGINS = "http://127.0.0.1:8790,http://localhost:8790";

const token = () => randomBytes(32).toString("base64url"); // 43文字
const sha = (s) => createHash("sha256").update(s).digest("hex");
const autoDeviceId = (n) => `tabimap-${n}-${randomBytes(4).toString("hex")}`;

function fail(msg) {
  console.error("エラー: " + msg);
  process.exit(1);
}

function writePrivate(file, text) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, text, { mode: 0o600 });
  chmodSync(file, 0o600);
}

function authJson(state) {
  return JSON.stringify(
    Object.fromEntries(Object.entries(state.vehicles).map(([v, e]) => [v, { deviceId: e.deviceId, tokenSha256: sha(e.token) }])),
  );
}

function parseArgs(argv) {
  const o = { rotate: [], device: {}, upload: true, base: "", qr: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(a + " の値がありません");
      return v;
    };
    if (a === "--base") o.base = next().replace(/\/+$/, "");
    else if (a === "--rotate") o.rotate.push(next());
    else if (a === "--device") {
      const [k, ...rest] = next().split("=");
      const id = rest.join("=").trim();
      if (!VEHICLES.some(([v]) => v === k) || !id || id.length > 64) fail("--device は vehicle-1=端末ID の形で指定してください");
      o.device[k] = id;
    } else if (a === "--no-upload") o.upload = false;
    else if (["--interval", "--distance", "--heartbeat", "--angle"].includes(a)) {
      const n = Number(next());
      if (!Number.isInteger(n) || n < 0) fail(a + " は0以上の整数");
      o.qr[a.slice(2)] = n;
    } else if (a === "--stop-detection") {
      const v = next();
      if (v !== "true" && v !== "false") fail("--stop-detection は true か false");
      o.qr.stop_detection = v;
    } else if (a === "--accuracy") {
      const v = next();
      if (!["highest", "high", "medium", "low"].includes(v)) fail("--accuracy は highest / high / medium / low");
      o.qr.accuracy = v;
    } else fail("不明なオプション: " + a);
  }
  return o;
}

// ---------- local ----------

function makeLocal() {
  const state = {
    vehicles: Object.fromEntries(VEHICLES.map(([v], i) => [v, { deviceId: `test-device-${i + 1}`, token: token() }])),
    viewToken: token(),
  };
  writePrivate(path.join(SECRETS, "local.json"), JSON.stringify(state, null, 2) + "\n");
  // dotenv 形式。値は単一引用符で囲む（JSON の " をそのまま入れるため）
  const vars =
    "# make-secrets.mjs local が作ったローカル開発専用のダミー値（コミットしない）\n" +
    `DEVICE_AUTH_JSON='${authJson(state)}'\n` +
    `VIEW_TOKEN_SHA256='${sha(state.viewToken)}'\n` +
    `ALLOWED_ORIGINS='${LOCAL_ORIGINS}'\n`;
  writePrivate(path.join(ROOT, ".dev.vars"), vars);
  console.log("作成しました: .dev.vars と .secrets/local.json（ローカル開発専用。値は表示しません）");
}

// ---------- prod ----------

const QR_DEFAULTS = { accuracy: "high", interval: 10, distance: 0, angle: 0, heartbeat: 60, stop_detection: "false", buffer: "true", wakelock: "true" };

function setupHtml(state, base, qr) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const cards = VEHICLES.map(([v, name]) => {
    const e = state.vehicles[v];
    const server = `${base}/ingest/v1/${v}/${e.token}`;
    const q = new URLSearchParams({ id: e.deviceId, ...Object.fromEntries(Object.entries(qr).map(([k, x]) => [k, String(x)])) });
    const link = `${server}?${q}`;
    return `<section><h2>${esc(name)}</h2><div class="qr" data-text="${esc(link)}"></div>
<p>Traccar Client の「設定」→ QRコードの読み取りで、このコードを読む。</p>
<dl><dt>端末ID</dt><dd>${esc(e.deviceId)}</dd><dt>サーバーURL（手入力する場合）</dt><dd class="u">${esc(server)}</dd></dl></section>`;
  }).join("\n");
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>車両の位置 設定シート（秘密）</title>
<style>body{font-family:-apple-system,"Hiragino Kaku Gothic ProN",sans-serif;margin:24px;color:#16181d}h1{font-size:20px}
.warn{background:#fff3bf;padding:10px 12px;border-radius:8px;font-size:14px}section{border:1px solid #d0d5dc;border-radius:10px;padding:14px;margin:14px 0;break-inside:avoid}
h2{margin:0 0 8px;font-size:18px}.qr svg{width:220px;height:220px}dl{font-size:13px}dt{font-weight:700;margin-top:6px}dd{margin:0;word-break:break-all}
.u{font-family:ui-monospace,monospace}.view{font-family:ui-monospace,monospace;font-size:15px;word-break:break-all;background:#f1f3f5;padding:8px;border-radius:6px}</style></head><body>
<h1>車両の位置（Traccar Client）設定シート</h1>
<p class="warn">このページの QRコード・URL・閲覧キーは秘密です。運転する人には自分の車両の QRコードだけを見せ、写真やチャットで広く共有しないでください。作成: ${esc(new Date().toISOString())}</p>
<p>QRコードには送信設定（精度 ${esc(qr.accuracy)}・間隔 ${esc(qr.interval)} 秒・距離 ${esc(qr.distance)} m・停止検知 ${esc(qr.stop_detection)}・通信確認 ${esc(qr.heartbeat)} 秒）も入っています。読み取り後、アプリで送信を ON にしてください。</p>
${cards}
<section><h2>本部の閲覧キー</h2><p>本祭支援ツールの「位置の共有（車両）」→「接続の設定」に入力する。</p><div class="view">${esc(state.viewToken)}</div></section>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js" integrity="sha384-mZT2gIty7ZDdOGkxfP6joZcYdMW1Jvj9dRlfpTmaJAKKXTqzygtB22k7FLe+KZC1" crossorigin="anonymous"></script>
<script>document.querySelectorAll('.qr').forEach(function(el){try{var q=qrcode(0,'M');q.addData(el.dataset.text);q.make();el.innerHTML=q.createSvgTag({cellSize:4,margin:2,scalable:true});}catch(e){el.textContent='QRコードを作れませんでした（下のURLと端末IDを手入力してください）';}});</script>
</body></html>
`;
}

function putSecret(name, value) {
  const r = spawnSync("npx", ["wrangler", "secret", "put", name], { cwd: ROOT, input: value, stdio: ["pipe", "inherit", "inherit"] });
  if (r.status !== 0) fail(`wrangler secret put ${name} に失敗しました（wrangler login・deploy 済みか確認）`);
}

function makeProd(args) {
  if (!/^https:\/\/[^/]+$/.test(args.base)) fail("--base に Worker の URL（https://…workers.dev、パスなし）を指定してください");
  const file = path.join(SECRETS, "production.json");
  let state = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  const all = !state || args.rotate.includes("all");
  if (all) state = { vehicles: {}, viewToken: "" };
  VEHICLES.forEach(([v], i) => {
    const cur = state.vehicles[v];
    if (all || !cur || args.rotate.includes(v)) state.vehicles[v] = { deviceId: args.device[v] ?? autoDeviceId(i + 1), token: token() };
    else if (args.device[v]) state.vehicles[v].deviceId = args.device[v];
  });
  if (all || !state.viewToken || args.rotate.includes("view")) state.viewToken = token();
  state.base = args.base;
  state.qr = { ...QR_DEFAULTS, ...(state.qr ?? {}), ...args.qr };
  writePrivate(file, JSON.stringify(state, null, 2) + "\n");
  writePrivate(path.join(SECRETS, "production-setup.html"), setupHtml(state, args.base, state.qr));
  if (args.upload) {
    putSecret("DEVICE_AUTH_JSON", authJson(state));
    putSecret("VIEW_TOKEN_SHA256", sha(state.viewToken));
  }
  console.log(
    (args.upload ? "Secret を登録しました（値は表示しません）。" : "Secret は登録していません（--no-upload）。") +
      "\n設定シート: tracking-worker/.secrets/production-setup.html（秘密。ブラウザで開いて運転する人ごとに QR を読ませる）",
  );
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === "local") makeLocal();
else if (mode === "prod") makeProd(parseArgs(rest));
else fail("使い方: node scripts/make-secrets.mjs local | prod --base https://<worker>.workers.dev");
