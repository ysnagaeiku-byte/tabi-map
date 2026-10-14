#!/usr/bin/env node
// 本番の受信APIを読み取りだけで確かめる（位置は書き込まない）。キーは .secrets/production.json から読み、画面には出さない。
//   node scripts/check-prod.mjs
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const s = JSON.parse(readFileSync(path.join(ROOT, ".secrets", "production.json"), "utf8"));
const BASE = s.base;
const ORIGIN = "https://ysnagaeiku-byte.github.io";
let ng = 0;
const check = (label, ok, extra = "") => {
  if (!ok) ng++;
  console.log(`${ok ? "OK " : "NG "} ${label}${extra ? "  " + extra : ""}`);
};
const req = (p, o = {}) => fetch(BASE + p, { ...o, redirect: "manual" });

const h = await req("/health");
check("/health 200 {ok:true}", h.status === 200 && JSON.stringify(await h.json()) === '{"ok":true}');
check("閲覧キーなし → 401", (await req("/api/v1/vehicles")).status === 401);
check("違う閲覧キー → 401", (await req("/api/v1/vehicles", { headers: { Authorization: "Bearer " + "x".repeat(43) } })).status === 401);
check("許可外の Origin → 403", (await req("/api/v1/vehicles", { headers: { Origin: "https://example.com", Authorization: "Bearer " + s.viewToken } })).status === 403);
const pf = await req("/api/v1/vehicles", { method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" } });
check("地図の Origin のプリフライト → 204", pf.status === 204 && pf.headers.get("access-control-allow-origin") === ORIGIN);
check("違う送信キー → 403", (await req("/ingest/v1/vehicle-1/" + "y".repeat(43), { method: "POST" })).status === 403);
check("送信キーの形が違う → 404", (await req("/ingest/v1/vehicle-1/short", { method: "POST" })).status === 404);
const v = await req("/api/v1/vehicles", { headers: { Origin: ORIGIN, Authorization: "Bearer " + s.viewToken } });
const body = v.status === 200 ? await v.json() : null;
check("閲覧キーで3台を返す", !!body && body.schemaVersion === 1 && body.vehicles.map((x) => x.vehicleId).join() === "vehicle-1,vehicle-2,vehicle-3", `status ${v.status}`);
check("応答は no-store・CORS は地図の Origin", v.headers.get("cache-control") === "no-store, private" && v.headers.get("access-control-allow-origin") === ORIGIN);
if (body) {
  const skew = Math.round((body.serverNowMs - Date.now()) / 1000);
  for (const x of body.vehicles)
    console.log(`    ${x.name}: ${x.position ? "測位あり（" + Math.round((body.serverNowMs - x.position.fixAtMs) / 1000) + "秒前）" : "未測位"}・通信${x.lastContactAtMs ? "あり" : "なし"}`);
  console.log(`    サーバーとこのMacの時計の差: 約${skew}秒`);
}
process.exit(ng ? 1 : 0);
