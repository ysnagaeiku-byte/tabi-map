// 本祭支援ツール：車両の位置の受信API（Cloudflare Workers + D1）の処理本体（入口は index.ts）
//
//   POST /ingest/v1/<vehicle-id>/<送信トークン>   Traccar Client の送信先（フォーム形式。互換用に GET クエリも受ける）
//   GET  /api/v1/vehicles                       閲覧トークン（Authorization: Bearer）で3台の最新位置を返す
//   OPTIONS /api/v1/vehicles                    許可した Origin のプリフライトだけ 204（DBは読まない）
//   GET  /health                                稼働の真偽だけ
//
// 秘密値は Worker Secret（DEVICE_AUTH_JSON・VIEW_TOKEN_SHA256）にハッシュだけを置く。実トークン・URL・座標はログに出さない。

import { normalizeReport, readDeviceId, type Report } from "./normalize";

export interface Env {
  DB: D1Database;
  DEVICE_AUTH_JSON?: string;
  VIEW_TOKEN_SHA256?: string;
  ALLOWED_ORIGINS?: string;
}

export const VEHICLES = [
  { id: "vehicle-1", name: "1号車" },
  { id: "vehicle-2", name: "2号車" },
  { id: "vehicle-3", name: "3号車" },
] as const;
type VehicleId = (typeof VEHICLES)[number]["id"];

export const MAX_BODY_BYTES = 8 * 1024;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 256bit を base64url（パディングなし）にした長さ
const HASH_RE = /^[0-9a-f]{64}$/;
const INGEST_RE = /^\/ingest\/v1\/([^/]+)\/([^/]+)$/;

const BASE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, private",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

export function json(status: number, body: unknown, extra?: Record<string, string>): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, ...(extra ?? {}) },
  });
}

// ログは車両ID・結果の分類だけ（URL・トークン・座標・端末IDは出さない）
export function logResult(route: string, result: string, vehicle?: string) {
  console.log(JSON.stringify(vehicle ? { route, vehicle, result } : { route, result }));
}

// ---------- 認証 ----------

const enc = new TextEncoder();

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** 同じ長さ（32バイト）のハッシュどうしを定時間で比較する */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (x: ArrayBufferView, y: ArrayBufferView) => boolean };
  if (typeof subtle.timingSafeEqual === "function") return subtle.timingSafeEqual(a, b);
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

async function tokenMatches(token: string, expectedHex: string): Promise<boolean> {
  return sameBytes(await sha256(token), hexToBytes(expectedHex));
}

interface DeviceAuth {
  deviceId: string;
  tokenSha256: string;
}
type DeviceAuthMap = Partial<Record<VehicleId, DeviceAuth>>;

let authCache: { raw: string; map: DeviceAuthMap | null } | null = null;

/** DEVICE_AUTH_JSON を読む。形式が崩れていれば null（＝未設定扱いで 503） */
export function parseDeviceAuth(raw: string | undefined): DeviceAuthMap | null {
  if (!raw) return null;
  if (authCache && authCache.raw === raw) return authCache.map;
  let map: DeviceAuthMap | null = null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const out: DeviceAuthMap = {};
    let n = 0;
    for (const v of VEHICLES) {
      const e = o?.[v.id] as Record<string, unknown> | undefined;
      if (e == null) continue;
      const deviceId = typeof e.deviceId === "string" ? e.deviceId.trim() : "";
      const hash = typeof e.tokenSha256 === "string" ? e.tokenSha256.toLowerCase() : "";
      if (!deviceId || deviceId.length > 64 || !HASH_RE.test(hash)) throw new Error("bad entry");
      out[v.id] = { deviceId, tokenSha256: hash };
      n++;
    }
    map = n > 0 ? out : null;
  } catch {
    map = null;
  }
  authCache = { raw, map };
  return map;
}

function viewHash(env: Env): string | null {
  const h = (env.VIEW_TOKEN_SHA256 ?? "").trim().toLowerCase();
  return HASH_RE.test(h) ? h : null;
}

// ---------- CORS（閲覧APIだけ） ----------

function allowedOrigins(env: Env): Set<string> {
  return new Set(
    (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "null" && /^https?:\/\/[^/]+$/.test(s)),
  );
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

// ---------- 本文の読み取り（Content-Length に頼らず読み取り量も制限） ----------

class TooLarge extends Error {}

async function readBodyLimited(req: Request, limit: number): Promise<string> {
  const len = req.headers.get("Content-Length");
  if (len !== null && Number(len) > limit) throw new TooLarge();
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new TooLarge();
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

// ---------- 受信 ----------

// 1行の UPDATE（書込1行）で、位置・通信時刻・電池をそれぞれの条件で更新する。
// SQLite の UPDATE は右辺をすべて更新前の値で評価するため、条件（fix_at_ms < 新しい時刻）は列の並び順に左右されない。
// 位置は「より新しい測位」のときだけ置き換え、通信時刻は MAX で進める。同時に届いても行単位で原子的に処理される。
const UPSERT_SQL = `
UPDATE vehicles_latest SET
  lat                = CASE WHEN ?2 = 1 AND (fix_at_ms IS NULL OR fix_at_ms < ?3) THEN ?4 ELSE lat END,
  lon                = CASE WHEN ?2 = 1 AND (fix_at_ms IS NULL OR fix_at_ms < ?3) THEN ?5 ELSE lon END,
  accuracy_m         = CASE WHEN ?2 = 1 AND (fix_at_ms IS NULL OR fix_at_ms < ?3) THEN ?6 ELSE accuracy_m END,
  speed_kmh          = CASE WHEN ?2 = 1 AND (fix_at_ms IS NULL OR fix_at_ms < ?3) THEN ?7 ELSE speed_kmh END,
  heading_deg        = CASE WHEN ?2 = 1 AND (fix_at_ms IS NULL OR fix_at_ms < ?3) THEN ?8 ELSE heading_deg END,
  fix_received_at_ms = CASE WHEN ?2 = 1 AND (fix_at_ms IS NULL OR fix_at_ms < ?3) THEN ?9 ELSE fix_received_at_ms END,
  fix_at_ms          = CASE WHEN ?2 = 1 AND (fix_at_ms IS NULL OR fix_at_ms < ?3) THEN ?3 ELSE fix_at_ms END,
  last_contact_at_ms = MAX(COALESCE(last_contact_at_ms, 0), ?9),
  battery_pct        = CASE WHEN ?10 IS NOT NULL AND (telemetry_at_ms IS NULL OR telemetry_at_ms < ?3) THEN ?10 ELSE battery_pct END,
  charging           = CASE WHEN ?11 IS NOT NULL AND (telemetry_at_ms IS NULL OR telemetry_at_ms < ?3) THEN ?11 ELSE charging END,
  telemetry_at_ms    = CASE WHEN (?10 IS NOT NULL OR ?11 IS NOT NULL) AND (telemetry_at_ms IS NULL OR telemetry_at_ms < ?3) THEN ?3 ELSE telemetry_at_ms END
WHERE vehicle_id = ?1
RETURNING fix_at_ms`;

async function store(env: Env, vehicleId: VehicleId, r: Exclude<Report, { kind: "reject" }>, nowMs: number): Promise<"fix" | "old" | "heartbeat"> {
  const isFix = r.kind === "fix";
  const atMs = r.kind === "fix" ? r.fixAtMs : r.atMs;
  const tel = r;
  const stmt = env.DB.prepare(UPSERT_SQL).bind(
    vehicleId,
    isFix ? 1 : 0,
    atMs,
    isFix ? r.lat : null,
    isFix ? r.lon : null,
    isFix ? r.accuracyM : null,
    isFix ? r.speedKmh : null,
    isFix ? r.headingDeg : null,
    nowMs,
    tel.batteryPct,
    tel.charging === null ? null : tel.charging ? 1 : 0,
  );
  // 行が消されていても復旧できるように、先に3台の行を用意（既にあれば書込なし）
  const ensure = env.DB.prepare("INSERT OR IGNORE INTO vehicles_latest (vehicle_id) VALUES (?1)").bind(vehicleId);
  const [, res] = await env.DB.batch<{ fix_at_ms: number | null }>([ensure, stmt]);
  if (!res.success || !res.results?.length) throw new Error("update failed");
  if (r.kind === "fix") return res.results[0].fix_at_ms === r.fixAtMs ? "fix" : "old";
  return "heartbeat";
}

async function handleIngest(req: Request, env: Env, vehicleRaw: string, token: string, nowMs: number): Promise<Response> {
  const vehicle = VEHICLES.find((v) => v.id === vehicleRaw);
  if (!vehicle || !TOKEN_RE.test(token)) return json(404, { error: "not_found" });
  if (req.method !== "POST" && req.method !== "GET") return json(405, { error: "method_not_allowed" }, { Allow: "POST, GET" });

  const auth = parseDeviceAuth(env.DEVICE_AUTH_JSON);
  if (!auth) {
    logResult("ingest", "not_configured", vehicle.id);
    return json(503, { error: "not_configured" });
  }
  const entry = auth[vehicle.id];
  if (!entry || !(await tokenMatches(token, entry.tokenSha256))) {
    logResult("ingest", "forbidden", vehicle.id);
    return json(403, { error: "forbidden" });
  }

  // 本文（フォーム）＋URLのクエリ。同じ項目は本文を優先
  const url = new URL(req.url);
  const params = new URLSearchParams(url.search);
  if (req.method === "POST") {
    const ct = (req.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
    let text: string;
    try {
      text = await readBodyLimited(req, MAX_BODY_BYTES);
    } catch (e) {
      if (e instanceof TooLarge) return json(413, { error: "payload_too_large" });
      return json(400, { error: "bad_request" });
    }
    if (text.length > 0 && ct !== "application/x-www-form-urlencoded") return json(415, { error: "unsupported_media_type" });
    for (const [k, v] of new URLSearchParams(text)) params.set(k, v);
  }

  const deviceId = readDeviceId(params);
  if (deviceId === null) return json(400, { error: "missing_id" });
  if (deviceId !== entry.deviceId) {
    logResult("ingest", "device_mismatch", vehicle.id);
    return json(403, { error: "forbidden" });
  }

  const report = normalizeReport(params, nowMs);
  if (report.kind === "reject") {
    // 認証済みだが壊れた測位：何も保存せず 200 で確定破棄（4xx にすると端末の再送キューが詰まる）。
    // 通信時刻も進めない（設定用QRをカメラで読んでブラウザで開いた場合などを「通信あり」と見せない）
    logResult("ingest", "rejected_" + report.reason, vehicle.id);
    return json(200, { ok: true, accepted: false, reason: report.reason });
  }
  let result: string;
  try {
    result = await store(env, vehicle.id, report, nowMs);
  } catch {
    logResult("ingest", "storage_error", vehicle.id);
    return json(503, { error: "storage_unavailable" });
  }
  logResult("ingest", result, vehicle.id);
  return json(200, { ok: true, accepted: true });
}

// ---------- 閲覧 ----------

interface Row {
  vehicle_id: string;
  lat: number | null;
  lon: number | null;
  fix_at_ms: number | null;
  fix_received_at_ms: number | null;
  last_contact_at_ms: number | null;
  telemetry_at_ms: number | null;
  accuracy_m: number | null;
  speed_kmh: number | null;
  heading_deg: number | null;
  battery_pct: number | null;
  charging: number | null;
}

export function vehiclesBody(rows: Row[], nowMs: number) {
  const byId = new Map(rows.map((r) => [r.vehicle_id, r]));
  return {
    schemaVersion: 1,
    serverNowMs: nowMs,
    vehicles: VEHICLES.map((v) => {
      const r = byId.get(v.id);
      const hasPos = !!r && r.lat !== null && r.lon !== null && r.fix_at_ms !== null;
      return {
        vehicleId: v.id,
        name: v.name,
        position: hasPos
          ? {
              lat: r!.lat,
              lon: r!.lon,
              fixAtMs: r!.fix_at_ms,
              receivedAtMs: r!.fix_received_at_ms,
              accuracyM: r!.accuracy_m,
              speedKmh: r!.speed_kmh,
              headingDeg: r!.heading_deg,
            }
          : null,
        lastContactAtMs: r?.last_contact_at_ms ?? null,
        batteryPct: r?.battery_pct ?? null,
        charging: r?.charging == null ? null : r.charging === 1,
        telemetryAtMs: r?.telemetry_at_ms ?? null,
      };
    }),
  };
}

async function handleVehicles(req: Request, env: Env, nowMs: number): Promise<Response> {
  const origin = req.headers.get("Origin");
  let cors: Record<string, string> = {};
  if (origin !== null) {
    if (!allowedOrigins(env).has(origin)) return json(403, { error: "origin_not_allowed" });
    cors = corsHeaders(origin);
  }
  if (req.method === "OPTIONS") {
    if (origin === null) return json(403, { error: "origin_not_allowed" });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store, private", ...cors } });
  }
  if (req.method !== "GET") return json(405, { error: "method_not_allowed" }, { Allow: "GET, OPTIONS", ...cors });

  const expected = viewHash(env);
  if (!expected) {
    logResult("vehicles", "not_configured");
    return json(503, { error: "not_configured" }, cors);
  }
  const m = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.get("Authorization") ?? "");
  if (!m || !TOKEN_RE.test(m[1]) || !(await tokenMatches(m[1], expected))) {
    logResult("vehicles", "unauthorized");
    return json(401, { error: "unauthorized" }, { "WWW-Authenticate": "Bearer", ...cors });
  }

  let rows: Row[];
  try {
    const res = await env.DB.prepare(
      "SELECT vehicle_id, lat, lon, fix_at_ms, fix_received_at_ms, last_contact_at_ms, telemetry_at_ms, accuracy_m, speed_kmh, heading_deg, battery_pct, charging FROM vehicles_latest",
    ).all<Row>();
    rows = res.results ?? [];
  } catch {
    logResult("vehicles", "storage_error");
    return json(503, { error: "storage_unavailable" }, cors);
  }
  return json(200, vehiclesBody(rows, nowMs), cors);
}

// ---------- 振り分け ----------

export async function handle(req: Request, env: Env, nowMs: number): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (pathname === "/api/v1/vehicles") return handleVehicles(req, env, nowMs);
  const m = INGEST_RE.exec(pathname);
  if (m) return handleIngest(req, env, m[1], m[2], nowMs);
  if (pathname === "/health") {
    if (req.method !== "GET") return json(405, { error: "method_not_allowed" }, { Allow: "GET" });
    return json(200, { ok: true });
  }
  return json(404, { error: "not_found" });
}
