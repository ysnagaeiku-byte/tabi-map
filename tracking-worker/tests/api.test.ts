import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { handle, MAX_BODY_BYTES, type Env } from "../src/app";
import { DEVICE_IDS, ORIGIN_OK, ORIGIN_PROD, VIEW_TOKEN, WRITE_TOKENS } from "./fixtures";

type V = keyof typeof WRITE_TOKENS;
const BASE = "https://tracking.example";
const E = env as unknown as Env;

function form(o: Record<string, string | number>) {
  return new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();
}
function ingest(v: V, o: Record<string, string | number>, opt: { token?: string; method?: string; ct?: string; body?: BodyInit | null } = {}) {
  const method = opt.method ?? "POST";
  const url = `${BASE}/ingest/v1/${v}/${opt.token ?? WRITE_TOKENS[v]}` + (method === "GET" ? "?" + form(o) : "");
  return worker.fetch(
    new Request(url, {
      method,
      headers: method === "GET" ? {} : { "Content-Type": opt.ct ?? "application/x-www-form-urlencoded" },
      body: method === "GET" ? undefined : opt.body !== undefined ? opt.body : form(o),
    }),
    E,
  );
}
function view(headers: Record<string, string> = { Authorization: `Bearer ${VIEW_TOKEN}` }, method = "GET") {
  return worker.fetch(new Request(`${BASE}/api/v1/vehicles`, { method, headers }), E);
}
async function vehicles() {
  const r = await view();
  expect(r.status).toBe(200);
  return (await r.json()) as {
    schemaVersion: number;
    serverNowMs: number;
    vehicles: {
      vehicleId: string;
      name: string;
      position: null | { lat: number; lon: number; fixAtMs: number; receivedAtMs: number; accuracyM: number | null; speedKmh: number | null; headingDeg: number | null };
      lastContactAtMs: number | null;
      batteryPct: number | null;
      charging: boolean | null;
      telemetryAtMs: number | null;
    }[];
  };
}
const one = async (v: V) => (await vehicles()).vehicles.find((x) => x.vehicleId === v)!;
const sec = (ms: number) => Math.floor(ms / 1000);
const fix = (v: V, tsSec: number, extra: Record<string, string | number> = {}) =>
  ingest(v, { id: DEVICE_IDS[v], timestamp: tsSec, lat: 35.61, lon: 139.555, ...extra });

beforeEach(async () => {
  await E.DB.exec(
    "UPDATE vehicles_latest SET lat=NULL, lon=NULL, fix_at_ms=NULL, fix_received_at_ms=NULL, last_contact_at_ms=NULL, telemetry_at_ms=NULL, accuracy_m=NULL, speed_kmh=NULL, heading_deg=NULL, battery_pct=NULL, charging=NULL",
  );
});

describe("POST フォーム / GET 互換", () => {
  it("現行の Traccar Client と同じ POST フォームを受けて保存する", async () => {
    const t = sec(Date.now()) - 5;
    const r = await fix("vehicle-1", t, { accuracy: 12.5, speed: 10, bearing: 90, altitude: 40, batt: 72, charge: "true" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, accepted: true });
    const v = await one("vehicle-1");
    expect(v.name).toBe("1号車");
    expect(v.position).toMatchObject({ lat: 35.61, lon: 139.555, fixAtMs: t * 1000, accuracyM: 12.5, speedKmh: 18.52, headingDeg: 90 });
    expect(v.batteryPct).toBe(72);
    expect(v.charging).toBe(true);
    expect(v.lastContactAtMs).toBeGreaterThan(0);
    expect(v.position!.receivedAtMs).toBe(v.lastContactAtMs);
  });

  it("GET クエリでも同じ正規化結果になる", async () => {
    const t = sec(Date.now()) - 5;
    const r = await ingest("vehicle-2", { id: DEVICE_IDS["vehicle-2"], timestamp: t, lat: 35.6, lon: 139.5, speed: 10 }, { method: "GET" });
    expect(r.status).toBe(200);
    expect((await one("vehicle-2")).position).toMatchObject({ lat: 35.6, lon: 139.5, fixAtMs: t * 1000, speedKmh: 18.52 });
  });

  it("deviceid（互換名）でも受ける・先頭ゼロの端末IDを数値化しない", async () => {
    const t = sec(Date.now());
    expect((await ingest("vehicle-1", { deviceid: "0123456", timestamp: t, lat: 1, lon: 2 })).status).toBe(200);
    expect((await ingest("vehicle-1", { id: "123456", timestamp: t + 1, lat: 1, lon: 2 })).status).toBe(403);
  });

  it("ミリ秒の timestamp も同じ時刻として扱う", async () => {
    const ms = Date.now() - 3000;
    await ingest("vehicle-3", { id: DEVICE_IDS["vehicle-3"], timestamp: ms, lat: 0, lon: 0, batt: 0 });
    const v = await one("vehicle-3");
    expect(v.position).toMatchObject({ lat: 0, lon: 0, fixAtMs: ms });
    expect(v.batteryPct).toBe(0);
  });
});

describe("認証・車両の分離", () => {
  const t = () => sec(Date.now());
  it("キーなし・形式違いのパスは 404", async () => {
    const r = await worker.fetch(new Request(`${BASE}/ingest/v1/vehicle-1`, { method: "POST" }), E);
    expect(r.status).toBe(404);
    expect((await ingest("vehicle-1", { id: "0123456", timestamp: t(), lat: 1, lon: 1 }, { token: "short" })).status).toBe(404);
    const r2 = await worker.fetch(new Request(`${BASE}/ingest/v1/vehicle-9/${WRITE_TOKENS["vehicle-1"]}`, { method: "POST" }), E);
    expect(r2.status).toBe(404);
  });

  it("別の車両の送信キーでは書けない", async () => {
    const r = await ingest("vehicle-1", { id: DEVICE_IDS["vehicle-1"], timestamp: t(), lat: 1, lon: 1 }, { token: WRITE_TOKENS["vehicle-2"] });
    expect(r.status).toBe(403);
    expect((await one("vehicle-1")).position).toBeNull();
    expect((await one("vehicle-1")).lastContactAtMs).toBeNull();
  });

  it("登録した端末IDと違う送信は拒否（通信時刻も進めない）", async () => {
    const r = await ingest("vehicle-2", { id: DEVICE_IDS["vehicle-3"], timestamp: t(), lat: 1, lon: 1 });
    expect(r.status).toBe(403);
    expect((await one("vehicle-2")).lastContactAtMs).toBeNull();
    expect((await ingest("vehicle-2", { timestamp: t(), lat: 1, lon: 1 })).status).toBe(400);
  });

  it("閲覧キーでは書けない・送信キーでは閲覧できない", async () => {
    expect((await ingest("vehicle-1", { id: DEVICE_IDS["vehicle-1"], timestamp: t(), lat: 1, lon: 1 }, { token: VIEW_TOKEN })).status).toBe(403);
    expect((await view({ Authorization: `Bearer ${WRITE_TOKENS["vehicle-1"]}` })).status).toBe(401);
    expect((await view({})).status).toBe(401);
    expect((await view({ Authorization: `Basic ${VIEW_TOKEN}` })).status).toBe(401);
  });

  it("閲覧の応答に端末ID・ハッシュ・トークンを含めない", async () => {
    await fix("vehicle-1", t());
    const text = await (await view()).text();
    for (const s of [...Object.values(DEVICE_IDS), ...Object.values(WRITE_TOKENS), VIEW_TOKEN, E.VIEW_TOKEN_SHA256]) expect(text).not.toContain(s);
    const body = JSON.parse(text);
    expect(body.schemaVersion).toBe(1);
    expect(body.vehicles.map((v: { vehicleId: string }) => v.vehicleId)).toEqual(["vehicle-1", "vehicle-2", "vehicle-3"]);
    expect(body.vehicles[1].position).toBeNull();
    expect(body.vehicles[1].lastContactAtMs).toBeNull();
  });
});

describe("heartbeat・再送・同時到着", () => {
  it("座標なしの heartbeat は 2xx。通信時刻だけ進み、位置と測位時刻は変わらない", async () => {
    const t0 = sec(Date.now()) - 60;
    await fix("vehicle-1", t0, { batt: 80 });
    const before = await one("vehicle-1");
    await new Promise((r) => setTimeout(r, 5));
    const r = await ingest("vehicle-1", { id: DEVICE_IDS["vehicle-1"], timestamp: t0 + 30, batt: 79, charge: "false" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, accepted: true });
    const after = await one("vehicle-1");
    expect(after.position).toEqual(before.position);
    expect(after.lastContactAtMs!).toBeGreaterThan(before.lastContactAtMs!);
    expect(after.batteryPct).toBe(79);
    expect(after.charging).toBe(false);
  });

  it("逆順・重複（200→100→200→300）でも最後は300", async () => {
    const b = sec(Date.now()) - 1000;
    for (const [dt, lat] of [[200, 35.2], [100, 35.1], [200, 35.25], [300, 35.3]] as const) {
      const r = await fix("vehicle-2", b + dt, { lat });
      expect(r.status).toBe(200); // 古い再送も 2xx（端末の再送キューを詰まらせない）
    }
    const v = await one("vehicle-2");
    expect(v.position!.fixAtMs).toBe((b + 300) * 1000);
    expect(v.position!.lat).toBe(35.3);
  });

  it("古い再送で位置も電池も戻らない", async () => {
    const b = sec(Date.now()) - 1000;
    await fix("vehicle-3", b + 50, { lat: 35.5, batt: 40 });
    await fix("vehicle-3", b + 10, { lat: 35.1, batt: 90 });
    const v = await one("vehicle-3");
    expect(v.position!.lat).toBe(35.5);
    expect(v.batteryPct).toBe(40);
  });

  it("同時到着でも一番新しい fix が残る", async () => {
    const b = sec(Date.now()) - 500;
    const order = [3, 9, 1, 7, 5, 2, 8, 4, 6];
    const rs = await Promise.all(order.map((k) => fix("vehicle-1", b + k * 10, { lat: 35 + k / 100 })));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    const v = await one("vehicle-1");
    expect(v.position!.fixAtMs).toBe((b + 90) * 1000);
    expect(v.position!.lat).toBe(35.09);
  });
});

describe("不正値・未来時刻・形式", () => {
  const t = () => sec(Date.now());
  it("NaN・片方欠落・範囲外・未来すぎる時刻は位置へ反映せず 200 accepted:false", async () => {
    await fix("vehicle-1", t() - 100, { lat: 35.5 });
    const cases: [Record<string, string | number>, string][] = [
      [{ lat: "NaN", lon: 139 }, "bad_coords"],
      [{ lat: 35.7 }, "partial_coords"],
      [{ lat: 91, lon: 139 }, "bad_coords"],
      [{ lat: 35.7, lon: 139, timestamp: t() + 600 }, "future_timestamp"],
      [{ lat: 35.7, lon: 139, timestamp: "" }, "bad_timestamp"],
    ];
    for (const [o, reason] of cases) {
      const r = await ingest("vehicle-1", { id: DEVICE_IDS["vehicle-1"], timestamp: t(), ...o });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true, accepted: false, reason });
    }
    const v = await one("vehicle-1");
    expect(v.position!.lat).toBe(35.5);
    expect(v.lastContactAtMs).toBe(v.position!.receivedAtMs); // 破棄した送信では通信時刻も進めない
  });

  it("設定用QRをブラウザで開いた（時刻なしの GET）だけでは何も変わらない", async () => {
    const r = await ingest("vehicle-2", { id: DEVICE_IDS["vehicle-2"], accuracy: "high", interval: 10 }, { method: "GET" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, accepted: false, reason: "bad_timestamp" });
    expect((await one("vehicle-2")).lastContactAtMs).toBeNull();
  });

  it("JSON は 415、8KB 超は 413、PUT は 405", async () => {
    expect((await ingest("vehicle-1", {}, { ct: "application/json", body: JSON.stringify({ id: "0123456" }) })).status).toBe(415);
    const big = "id=0123456&pad=" + "x".repeat(MAX_BODY_BYTES);
    expect((await ingest("vehicle-1", {}, { body: big })).status).toBe(413);
    // Content-Length を付けずに流し込まれても読み取り量で止める
    const stream = new ReadableStream({
      start(c) {
        for (let i = 0; i < 10; i++) c.enqueue(new TextEncoder().encode("x".repeat(1024)));
        c.close();
      },
    });
    const req = new Request(`${BASE}/ingest/v1/vehicle-1/${WRITE_TOKENS["vehicle-1"]}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect((await handle(req, E, Date.now())).status).toBe(413);
    expect((await ingest("vehicle-1", {}, { method: "PUT" })).status).toBe(405);
  });
});

describe("設定不足・DB障害", () => {
  it("送信用 Secret が未設定・壊れているときは 503（成功を返さない）", async () => {
    const body = form({ id: "0123456", timestamp: sec(Date.now()), lat: 1, lon: 1 });
    const mk = () =>
      new Request(`${BASE}/ingest/v1/vehicle-1/${WRITE_TOKENS["vehicle-1"]}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
    expect((await handle(mk(), { ...E, DEVICE_AUTH_JSON: undefined }, Date.now())).status).toBe(503);
    expect((await handle(mk(), { ...E, DEVICE_AUTH_JSON: '{"vehicle-1":{"deviceId":"a","tokenSha256":"zz"}}' }, Date.now())).status).toBe(503);
    const r = await handle(new Request(`${BASE}/api/v1/vehicles`, { headers: { Authorization: `Bearer ${VIEW_TOKEN}` } }), { ...E, VIEW_TOKEN_SHA256: "" }, Date.now());
    expect(r.status).toBe(503);
  });

  it("DB に保存できないときは 503。復旧後の再送で保存される", async () => {
    const broken = {
      prepare: () => ({ bind: () => ({}), all: () => Promise.reject(new Error("db down")) }),
      batch: () => Promise.reject(new Error("db down")),
    } as unknown as D1Database;
    const t = sec(Date.now()) - 10;
    const body = form({ id: "0123456", timestamp: t, lat: 35.42, lon: 139.1 });
    const mk = () =>
      new Request(`${BASE}/ingest/v1/vehicle-1/${WRITE_TOKENS["vehicle-1"]}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
    const r = await handle(mk(), { ...E, DB: broken }, Date.now());
    expect(r.status).toBe(503);
    expect((await one("vehicle-1")).position).toBeNull();
    const rv = await handle(new Request(`${BASE}/api/v1/vehicles`, { headers: { Authorization: `Bearer ${VIEW_TOKEN}` } }), { ...E, DB: broken }, Date.now());
    expect(rv.status).toBe(503);
    expect((await worker.fetch(mk(), E)).status).toBe(200); // 端末の再送で回復
    expect((await one("vehicle-1")).position!.lat).toBe(35.42);
  });
});

describe("閲覧・CORS・キャッシュ", () => {
  it("許可した Origin のプリフライトは 204（DB を読まない）", async () => {
    const noDb = {
      prepare: () => {
        throw new Error("DB must not be used");
      },
    } as unknown as D1Database;
    const r = await handle(
      new Request(`${BASE}/api/v1/vehicles`, {
        method: "OPTIONS",
        headers: { Origin: ORIGIN_PROD, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" },
      }),
      { ...E, DB: noDb },
      Date.now(),
    );
    expect(r.status).toBe(204);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN_PROD);
    expect(r.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
    expect(r.headers.get("Access-Control-Allow-Headers")).toBe("Authorization");
    expect(r.headers.get("Access-Control-Max-Age")).toBe("600");
    expect(r.headers.get("Vary")).toBe("Origin");
  });

  it("許可外の Origin・Origin:null・パス付き Origin には CORS を返さない", async () => {
    for (const o of ["https://evil.example", "null", ORIGIN_PROD + "/tabi-map", "http://localhost:8080"]) {
      const r = await view({ Origin: o, Authorization: `Bearer ${VIEW_TOKEN}` });
      expect(r.status).toBe(403);
      expect(r.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
  });

  it("許可した Origin の取得は Origin と完全一致で返す。認証失敗も読めるよう CORS 付き", async () => {
    const r = await view({ Origin: ORIGIN_OK, Authorization: `Bearer ${VIEW_TOKEN}` });
    expect(r.status).toBe(200);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN_OK);
    const bad = await view({ Origin: ORIGIN_OK, Authorization: "Bearer " + "x".repeat(43) });
    expect(bad.status).toBe(401);
    expect(bad.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN_OK);
  });

  it("成功・失敗とも Cache-Control: no-store, private", async () => {
    const rs = [
      await view(),
      await view({}),
      await fix("vehicle-1", sec(Date.now())),
      await ingest("vehicle-1", {}, { token: WRITE_TOKENS["vehicle-2"] }),
      await worker.fetch(new Request(`${BASE}/health`), E),
      await worker.fetch(new Request(`${BASE}/nothing`), E),
    ];
    for (const r of rs) expect(r.headers.get("Cache-Control")).toBe("no-store, private");
  });

  it("/health は稼働の真偽だけ", async () => {
    const r = await worker.fetch(new Request(`${BASE}/health`), E);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it("serverNowMs を返す（閲覧端末の時計ずれ補正用）", async () => {
    const a = Date.now();
    const b = await vehicles();
    expect(b.serverNowMs).toBeGreaterThanOrEqual(a - 5);
    expect(b.serverNowMs).toBeLessThanOrEqual(Date.now() + 5);
  });
});

describe("入口ファイル", () => {
  it("Workers の入口は既定の書き出しだけ（定数を書き出すと実行環境が起動しない）", async () => {
    expect(Object.keys(await import("../src/index"))).toEqual(["default"]);
  });
});
