// 本祭支援ツール：車両の位置の受信API（Cloudflare Workers + D1）の処理本体（入口は index.ts）
//
//   POST /ingest/v1/<vehicle-id>/<送信トークン>   Traccar Client の送信先（フォーム形式。互換用に GET クエリも受ける）
//   GET  /api/v1/vehicles                       閲覧トークン（Authorization: Bearer）で3台の最新位置を返す
//   OPTIONS /api/v1/vehicles                    許可した Origin のプリフライトだけ 204（DBは読まない）
//   GET  /health                                稼働の真偽だけ
//
// 秘密値は Worker Secret（DEVICE_AUTH_JSON・VIEW_TOKEN_SHA256）にハッシュだけを置く。実トークン・URL・座標はログに出さない。

import { normalizeReport, readDeviceId, type Report } from "./normalize";
import { MAX_SCHEDULE_BYTES, normalizeSchedule, ScheduleError } from "./schedule";

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

function corsHeaders(origin: string, methods = "GET, OPTIONS", headers = "Authorization"): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": headers,
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

/** 閲覧キーで守る API の入口：Origin・プリフライト・メソッド・認証。通れば CORS ヘッダーを返す */
// ---------- 閲覧キーの種類（本部版＝全権限／配布版＝本部が発行した制限つきのキー） ----------

export interface Perms {
  settings: boolean; // 設定画面の閲覧
  pins: boolean; // ピンの保存
  edit: boolean; // 時刻表の編集
}
export interface Who {
  role: "full" | "share";
  id?: string;
  label?: string;
  perms: Perms;
  expiresAtMs?: number | null;
}
const FULL: Who = { role: "full", perms: { settings: true, pins: true, edit: true } };
interface ShareRow {
  id: string;
  label: string;
  perms: string;
  expires_at_ms: number | null;
  revoked_at_ms: number | null;
  lock: number;
  lock_on_expiry: number;
}
// 配布版のキーの照会を少しの間覚えておく（D1 の読み取りを減らす。取り消しは最大30秒で効く）
const shareCache = new Map<string, { at: number; row: ShareRow | null }>();
const SHARE_CACHE_MS = 30_000;
export function clearShareCache() {
  shareCache.clear();
}
function hex(b: Uint8Array) {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
async function shareLookup(env: Env, token: string, nowMs: number): Promise<ShareRow | null> {
  const h = hex(await sha256(token));
  const c = shareCache.get(h);
  if (c && nowMs - c.at < SHARE_CACHE_MS) return c.row;
  const row = await env.DB.prepare("SELECT id, label, perms, expires_at_ms, revoked_at_ms, lock, lock_on_expiry FROM fest_shares WHERE token_sha256 = ?1").bind(h).first<ShareRow>();
  if (shareCache.size > 500) shareCache.clear();
  shareCache.set(h, { at: nowMs, row: row ?? null });
  return row ?? null;
}
function parsePerms(s: string): Perms {
  try {
    const o = JSON.parse(s) as Partial<Perms>;
    return { settings: o.settings === true, pins: o.pins === true, edit: o.edit === true };
  } catch {
    return { settings: false, pins: false, edit: false };
  }
}

async function viewGate(
  req: Request,
  env: Env,
  route: string,
  methods: string[],
  allowHeaders = "Authorization",
  nowMs = Date.now(),
): Promise<Response | { cors: Record<string, string>; who: Who }> {
  const origin = req.headers.get("Origin");
  const allowList = [...methods, "OPTIONS"].join(", ");
  let cors: Record<string, string> = {};
  if (origin !== null) {
    if (!allowedOrigins(env).has(origin)) return json(403, { error: "origin_not_allowed" });
    cors = corsHeaders(origin, allowList, allowHeaders);
  }
  if (req.method === "OPTIONS") {
    if (origin === null) return json(403, { error: "origin_not_allowed" });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store, private", ...cors } });
  }
  if (!methods.includes(req.method)) return json(405, { error: "method_not_allowed" }, { Allow: allowList, ...cors });
  const expected = viewHash(env);
  if (!expected) {
    logResult(route, "not_configured");
    return json(503, { error: "not_configured" }, cors);
  }
  const m = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.get("Authorization") ?? "");
  const unauthorized = () => {
    logResult(route, "unauthorized");
    return json(401, { error: "unauthorized" }, { "WWW-Authenticate": "Bearer", ...cors });
  };
  if (!m || !TOKEN_RE.test(m[1])) return unauthorized();
  if (await tokenMatches(m[1], expected)) return { cors, who: FULL };
  let row: ShareRow | null;
  try {
    row = await shareLookup(env, m[1], nowMs);
  } catch {
    logResult(route, "storage_error");
    return json(503, { error: "storage_unavailable" }, cors);
  }
  if (!row) return unauthorized();
  // 取り消し・期限切れは理由と「地図も止めるか」を返す（入力違いとは区別する。端末側はこれで画面を閉じる）
  const ended = (error: string, lock: boolean) => {
    logResult(route, error);
    return json(401, { error, lock }, { "WWW-Authenticate": "Bearer", ...cors });
  };
  if (row.revoked_at_ms !== null) return ended("revoked", row.lock === 1);
  if (row.expires_at_ms !== null && row.expires_at_ms <= nowMs) return ended("expired", row.lock_on_expiry === 1);
  return { cors, who: { role: "share", id: row.id, label: row.label, perms: parsePerms(row.perms), expiresAtMs: row.expires_at_ms } };
}

async function handleVehicles(req: Request, env: Env, nowMs: number): Promise<Response> {
  const g = await viewGate(req, env, "vehicles", ["GET"], "Authorization", nowMs);
  if (g instanceof Response) return g;
  const { cors } = g;

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

// ---------- 本部の時刻表（開錠・施錠時刻・EV） ----------

async function handleSchedule(req: Request, env: Env, nowMs: number): Promise<Response> {
  const g = await viewGate(req, env, "schedule", ["GET", "PUT"], "Authorization, Content-Type", nowMs);
  if (g instanceof Response) return g;
  const { cors, who } = g;
  type SRow = { value: string; updated_at_ms: number };
  const read = async () => env.DB.prepare("SELECT value, updated_at_ms FROM fest_settings WHERE key = 'schedule'").first<SRow>();
  if (req.method === "GET") {
    let row: SRow | null;
    try {
      row = await read();
    } catch {
      logResult("schedule", "storage_error");
      return json(503, { error: "storage_unavailable" }, cors);
    }
    return json(200, { schemaVersion: 1, serverNowMs: nowMs, updatedAtMs: row?.updated_at_ms ?? null, schedule: row ? JSON.parse(row.value) : null }, cors);
  }
  // PUT：{ schedule, baseUpdatedAtMs }。baseUpdatedAtMs が今の値と違えば 409（ほかの端末が先に保存した）
  if (!who.perms.edit) {
    logResult("schedule", "forbidden");
    return json(403, { error: "forbidden" }, cors);
  }
  const ct = (req.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  if (ct !== "application/json") return json(415, { error: "unsupported_media_type" }, cors);
  let body: { schedule?: unknown; baseUpdatedAtMs?: unknown };
  try {
    body = JSON.parse(await readBodyLimited(req, MAX_SCHEDULE_BYTES));
  } catch (e) {
    if (e instanceof TooLarge) return json(413, { error: "payload_too_large" }, cors);
    return json(400, { error: "bad_json" }, cors);
  }
  let sch;
  try {
    sch = normalizeSchedule(body?.schedule);
  } catch (e) {
    if (e instanceof ScheduleError) return json(400, { error: "bad_schedule", detail: e.message }, cors);
    throw e;
  }
  const base = body.baseUpdatedAtMs;
  if (base !== undefined && base !== null && !(typeof base === "number" && Number.isFinite(base))) return json(400, { error: "bad_base" }, cors);
  const value = JSON.stringify(sch);
  try {
    let res;
    if (base === undefined || base === null) {
      // 初回（まだ無い）だけ作る。既にあれば衝突として扱う
      res = await env.DB.prepare("INSERT OR IGNORE INTO fest_settings (key, value, updated_at_ms) VALUES ('schedule', ?1, ?2)").bind(value, nowMs).run();
    } else {
      res = await env.DB.prepare("UPDATE fest_settings SET value = ?1, updated_at_ms = ?2 WHERE key = 'schedule' AND updated_at_ms = ?3").bind(value, nowMs, base).run();
    }
    if (!res.meta.changes) {
      const row = await read();
      logResult("schedule", "conflict");
      return json(409, { error: "conflict", updatedAtMs: row?.updated_at_ms ?? null }, cors);
    }
  } catch {
    logResult("schedule", "storage_error");
    return json(503, { error: "storage_unavailable" }, cors);
  }
  logResult("schedule", "saved");
  return json(200, { ok: true, updatedAtMs: nowMs, schedule: sch }, cors);
}

// ---------- 自分の権限（GET /api/v1/me） ----------

async function handleMe(req: Request, env: Env, nowMs: number): Promise<Response> {
  const g = await viewGate(req, env, "me", ["GET"], "Authorization", nowMs);
  if (g instanceof Response) return g;
  const { cors, who } = g;
  return json(200, { schemaVersion: 1, serverNowMs: nowMs, role: who.role, label: who.label ?? null, perms: who.perms, expiresAtMs: who.expiresAtMs ?? null }, cors);
}

// ---------- 配布版のキーの発行・一覧・取り消し（本部版のキーだけ） ----------

const SHARE_ID_RE = /^[A-Za-z0-9_-]{10}$/;
const MAX_SHARES = 200;
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function normalizeShareInput(o: unknown, nowMs: number): { label: string; perms: Perms; expiresAtMs: number | null; lockOnExpiry: boolean } | string {
  if (!o || typeof o !== "object") return "bad_body";
  const r = o as Record<string, unknown>;
  const label = typeof r.label === "string" ? r.label.trim().replace(/[\u0000-\u001f]/g, "") : "";
  if (!label || label.length > 40) return "bad_label";
  const p = (r.perms ?? {}) as Record<string, unknown>;
  if (typeof p !== "object") return "bad_perms";
  for (const k of ["settings", "pins", "edit"]) if (p[k] !== undefined && typeof p[k] !== "boolean") return "bad_perms";
  const perms = { settings: p.settings === true, pins: p.pins === true, edit: p.edit === true };
  let expiresAtMs: number | null = null;
  if (r.expiresAtMs !== undefined && r.expiresAtMs !== null) {
    if (typeof r.expiresAtMs !== "number" || !Number.isFinite(r.expiresAtMs) || r.expiresAtMs <= nowMs || r.expiresAtMs > nowMs + 400 * 86400_000) return "bad_expiry";
    expiresAtMs = Math.round(r.expiresAtMs);
  }
  if (r.lockOnExpiry !== undefined && typeof r.lockOnExpiry !== "boolean") return "bad_lock";
  return { label, perms, expiresAtMs, lockOnExpiry: r.lockOnExpiry === true && expiresAtMs !== null };
}

async function handleShares(req: Request, env: Env, nowMs: number, id: string | null): Promise<Response> {
  const g = await viewGate(req, env, "shares", id ? ["DELETE"] : ["GET", "POST"], "Authorization, Content-Type", nowMs);
  if (g instanceof Response) return g;
  const { cors, who } = g;
  if (who.role !== "full") {
    logResult("shares", "forbidden");
    return json(403, { error: "forbidden" }, cors);
  }
  try {
    if (req.method === "GET") {
      const res = await env.DB.prepare("SELECT id, label, perms, created_at_ms, expires_at_ms, revoked_at_ms, lock, lock_on_expiry FROM fest_shares ORDER BY created_at_ms DESC").all<
        ShareRow & { created_at_ms: number }
      >();
      const shares = (res.results ?? []).map((r) => ({
        id: r.id,
        label: r.label,
        perms: parsePerms(r.perms),
        createdAtMs: r.created_at_ms,
        expiresAtMs: r.expires_at_ms,
        revokedAtMs: r.revoked_at_ms,
        lock: r.lock === 1,
        lockOnExpiry: r.lock_on_expiry === 1,
        active: r.revoked_at_ms === null && (r.expires_at_ms === null || r.expires_at_ms > nowMs),
      }));
      return json(200, { schemaVersion: 1, serverNowMs: nowMs, shares }, cors);
    }
    if (req.method === "DELETE") {
      // ?lock=1：地図も止める（取り消し済みの配布版にも後から付けられる）
      if (!SHARE_ID_RE.test(id!)) return json(404, { error: "not_found" }, cors);
      const lock = new URL(req.url).searchParams.get("lock") === "1";
      const res = lock
        ? await env.DB.prepare("UPDATE fest_shares SET revoked_at_ms = COALESCE(revoked_at_ms, ?2), lock = 1 WHERE id = ?1 AND (revoked_at_ms IS NULL OR lock = 0)").bind(id, nowMs).run()
        : await env.DB.prepare("UPDATE fest_shares SET revoked_at_ms = ?2 WHERE id = ?1 AND revoked_at_ms IS NULL").bind(id, nowMs).run();
      clearShareCache();
      if (!res.meta.changes) return json(404, { error: "not_found" }, cors);
      logResult("shares", lock ? "revoked_lock" : "revoked");
      return json(200, { ok: true, id, lock }, cors);
    }
    // POST：発行（実際のキーはこの応答でだけ返す）
    const ct = (req.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
    if (ct !== "application/json") return json(415, { error: "unsupported_media_type" }, cors);
    let body: unknown;
    try {
      body = JSON.parse(await readBodyLimited(req, 4096));
    } catch (e) {
      if (e instanceof TooLarge) return json(413, { error: "payload_too_large" }, cors);
      return json(400, { error: "bad_json" }, cors);
    }
    const n = normalizeShareInput(body, nowMs);
    if (typeof n === "string") return json(400, { error: n }, cors);
    const cnt = await env.DB.prepare("SELECT COUNT(*) AS c FROM fest_shares WHERE revoked_at_ms IS NULL").first<{ c: number }>();
    if ((cnt?.c ?? 0) >= MAX_SHARES) return json(409, { error: "too_many_shares" }, cors);
    const token = b64u(crypto.getRandomValues(new Uint8Array(32)));
    const sid = b64u(crypto.getRandomValues(new Uint8Array(8))).slice(0, 10);
    await env.DB.prepare("INSERT INTO fest_shares (id, token_sha256, label, perms, created_at_ms, expires_at_ms, lock_on_expiry) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
      .bind(sid, hex(await sha256(token)), n.label, JSON.stringify(n.perms), nowMs, n.expiresAtMs, n.lockOnExpiry ? 1 : 0)
      .run();
    logResult("shares", "issued");
    return json(201, { ok: true, id: sid, token, label: n.label, perms: n.perms, createdAtMs: nowMs, expiresAtMs: n.expiresAtMs, lockOnExpiry: n.lockOnExpiry }, cors);
  } catch {
    logResult("shares", "storage_error");
    return json(503, { error: "storage_unavailable" }, cors);
  }
}

// ---------- 振り分け ----------

export async function handle(req: Request, env: Env, nowMs: number): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (pathname === "/api/v1/vehicles") return handleVehicles(req, env, nowMs);
  if (pathname === "/api/v1/schedule") return handleSchedule(req, env, nowMs);
  if (pathname === "/api/v1/me") return handleMe(req, env, nowMs);
  if (pathname === "/api/v1/shares") return handleShares(req, env, nowMs, null);
  const sm = /^\/api\/v1\/shares\/([^/]+)$/.exec(pathname);
  if (sm) return handleShares(req, env, nowMs, sm[1]);
  const m = INGEST_RE.exec(pathname);
  if (m) return handleIngest(req, env, m[1], m[2], nowMs);
  if (pathname === "/health") {
    if (req.method !== "GET") return json(405, { error: "method_not_allowed" }, { Allow: "GET" });
    return json(200, { ok: true });
  }
  return json(404, { error: "not_found" });
}
