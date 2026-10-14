#!/usr/bin/env node
// deploy 前の確認：仮の database_id のまま・ローカル用 Origin の混入・URL を記録するログ設定を止める
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const raw = readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8");
// JSONC のコメントを除く（文字列中の // は残す）
const cfg = JSON.parse(raw.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, s) => s ?? ""));

const errors = [];
const db = (cfg.d1_databases ?? []).find((d) => d.binding === "DB");
if (!db) errors.push("d1_databases に binding \"DB\" がありません");
else if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(db.database_id) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(db.database_id))
  errors.push("database_id が仮値のままです。`npx wrangler d1 create festival-vehicle-tracking --location=apac` で出た UUID に置き換えてください");
const origins = String(cfg.vars?.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!origins.length) errors.push("vars.ALLOWED_ORIGINS が空です");
for (const o of origins) {
  if (!/^https:\/\/[^/]+$/.test(o)) errors.push(`ALLOWED_ORIGINS に https 以外・パス付きの値があります: ${o}`);
  if (/localhost|127\.0\.0\.1|^null$/.test(o)) errors.push(`本番の ALLOWED_ORIGINS にローカル用の値があります: ${o}`);
}
if (cfg.observability?.logs?.invocation_logs !== false) errors.push("observability.logs.invocation_logs を false にしてください（送信URLに秘密キーが含まれるため）");

if (errors.length) {
  console.error("deploy を中止しました:\n- " + errors.join("\n- "));
  process.exit(1);
}
console.log("deploy 前の確認: OK");
