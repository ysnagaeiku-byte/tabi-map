import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { handle, type Env } from "../src/app";
import { normalizeSchedule, normTime, ScheduleError } from "../src/schedule";
import { ORIGIN_OK, VIEW_TOKEN, WRITE_TOKENS } from "./fixtures";

const E = env as unknown as Env;
const URL_S = "https://tracking.example/api/v1/schedule";
const auth = { Authorization: `Bearer ${VIEW_TOKEN}` };
// テスト用の架空の時刻表（実際の開錠・施錠時刻ではない）
const sample = () => ({
  v: 1,
  days: [
    { d: "2030-01-07", items: [{ f: "b10", o: "06:10", c: "20:50" }, { f: "b5", o: "6:40", c: "19:20" }] },
    { d: "2030-01-04", items: [{ f: "ikuta", o: "", c: "22:10" }, { f: "gym1", o: "18:20", c: "22:10" }] },
  ],
  ev: { "9": { mode: "auto", days: { "2030-01-07": [{ from: "10:00", to: "11:30" }] } } },
});
const get = (headers: Record<string, string> = auth) => worker.fetch(new Request(URL_S, { headers }), E);
const put = (body: unknown, headers: Record<string, string> = { ...auth, "Content-Type": "application/json" }) =>
  worker.fetch(new Request(URL_S, { method: "PUT", headers, body: typeof body === "string" ? body : JSON.stringify(body) }), E);

beforeEach(async () => {
  await E.DB.exec("DELETE FROM fest_settings");
});

describe("時刻表の形（normalizeSchedule）", () => {
  it("時刻を H:MM にそろえ、日付順・施設の順に並べる", () => {
    const s = normalizeSchedule(sample());
    expect(s.days.map((d) => d.d)).toEqual(["2030-01-04", "2030-01-07"]);
    expect(s.days[1].items).toEqual([{ f: "b5", o: "6:40", c: "19:20" }, { f: "b10", o: "6:10", c: "20:50" }]);
    expect(s.days[0].items).toEqual([{ f: "gym1", o: "18:20", c: "22:10" }, { f: "ikuta", o: "", c: "22:10" }]);
    expect(s.ev["9"]).toEqual({ mode: "auto", days: { "2030-01-07": [{ from: "10:00", to: "11:30" }] } });
    expect(s.ev["10"]).toEqual({ mode: "auto", days: {} });
  });

  it("EVは手動で△（まもなく使用不可）にもできる", () => {
    const s = normalizeSchedule({ days: [], ev: { "9": { mode: "soon" }, "10": { mode: "ng" } } });
    expect(s.ev["9"]).toEqual({ mode: "soon", days: {} });
    expect(s.ev["10"]).toEqual({ mode: "ng", days: {} });
  });

  it("開錠・施錠が両方空の行は持たない", () => {
    const s = normalizeSchedule({ days: [{ d: "2030-01-05", items: [{ f: "b1", o: "", c: "" }, { f: "b2", o: "8:00", c: "" }] }] });
    expect(s.days[0].items).toEqual([{ f: "b2", o: "8:00", c: "" }]);
  });

  it("不正な日付・施設・時刻・重複・EVの値を拒否する", () => {
    const bad: unknown[] = [
      null,
      { days: "x" },
      { days: [{ d: "2030-02-30", items: [] }] },
      { days: [{ d: "2030-01-05", items: [{ f: "b3", o: "8:00", c: "21:00" }] }] },
      { days: [{ d: "2030-01-05", items: [{ f: "b1", o: "25:00", c: "21:00" }] }] },
      { days: [{ d: "2030-01-05", items: [{ f: "b1", o: "8:00", c: "21:00" }, { f: "b1", o: "9:00", c: "21:00" }] }] },
      { days: [{ d: "2030-01-05", items: [] }, { d: "2030-01-05", items: [] }] },
      { days: [], ev: { "9": { mode: "maybe" } } },
      { days: [], ev: { "9": { days: { "2030-01-05": [{ from: "10:00", to: "" }] } } } },
    ];
    for (const b of bad) expect(() => normalizeSchedule(b)).toThrow(ScheduleError);
    expect(normTime("07:05")).toBe("7:05");
    expect(normTime("")).toBe("");
    expect(normTime("7:5")).toBeNull();
  });
});

describe("黒帯に流す情報（学内施設・イベント・インフォメーション・表示設定）", () => {
  // テスト用の架空の値（実際の営業時間・イベントではない）
  const extra = () => ({
    fac: { days: ["2030-01-05", "2030-01-04"], items: [{ n: " 売店 ", h: { "2030-01-04": "07:30-19:00", "2030-01-05": "休業", "2030-01-09": "9:00-10:00" } }] },
    evt: [
      { d: "2030-01-05", items: [{ n: "ステージ", from: "13:00", to: "15:30", note: "", acts: [{ n: "出演A", from: "13:00", to: "13:30" }, { n: " 出演B ", from: "14:05", to: "15:00", note: "整理券" }] }] },
      { d: "2030-01-04", items: [{ n: "屋台", from: "09:15", to: "", note: "雨天中止" }] },
    ],
    info: [{ id: "a1", t: "  案内の文  ", d: "", u: 5 }],
    band: { dateOnly: false, from: "2030-01-04", to: "2030-01-06", src: { evt: { col: "#ABCDEF", sec: 9.3 }, info: { on: false } }, seq: [{ s: "lock", n: 3 }, { s: "evt", n: 1 }] },
  });

  it("形をそろえる（時刻・並び順・既定値）", () => {
    const s = normalizeSchedule({ ...sample(), ...extra() });
    expect(s.fac).toEqual({ days: ["2030-01-04", "2030-01-05"], items: [{ n: "売店", h: { "2030-01-04": "7:30-19:00", "2030-01-05": "休業" } }] });
    expect(s.evt.map((d) => d.d)).toEqual(["2030-01-04", "2030-01-05"]);
    expect(s.evt[0].items[0]).toEqual({ n: "屋台", from: "9:15", to: "", note: "雨天中止", acts: [] });
    expect(s.evt[1].items[0].acts).toEqual([{ n: "出演A", from: "13:00", to: "13:30", note: "" }, { n: "出演B", from: "14:05", to: "15:00", note: "整理券" }]);
    expect(s.info).toEqual([{ id: "a1", t: "案内の文", on: true, d: "", u: 5 }]);
    expect(s.band.dateOnly).toBe(false);
    expect(s.band.src.evt).toEqual({ on: true, col: "#abcdef", sec: 9.5 });
    expect(s.band.src.info.on).toBe(false);
    expect(s.band.src.lock).toEqual({ on: true, col: "#ffffff", sec: 7.5 });
    expect(s.band.seq).toEqual([{ s: "lock", n: 3 }, { s: "evt", n: 1 }]);
  });

  it("新しい項目がない以前の時刻表は既定値で補う", () => {
    const s = normalizeSchedule(sample());
    expect(s.fac).toEqual({ days: [], items: [] });
    expect(s.evt).toEqual([]);
    expect(s.info).toEqual([]);
    expect(s.band.dateOnly).toBe(true);
    expect(s.band.seq.map((q) => q.s)).toEqual(["lock", "fac", "evt", "act", "info"]);
    expect(s.band.src.act).toEqual({ on: true, col: "#d0ebff", sec: 7.5 });
  });

  it("不正な値を拒否する", () => {
    const base = () => ({ ...sample(), ...extra() });
    const bad: ((x: ReturnType<typeof base>) => void)[] = [
      (x) => { x.band.src.evt.sec = 1; },
      (x) => { x.band.src.evt.col = "red"; },
      (x) => { (x.band.seq[0] as { s: string }).s = "other"; },
      (x) => { x.band.seq[0].n = 0; },
      (x) => { x.band.from = "2030-01-07"; },
      (x) => { x.info.push({ id: "a1", t: "重複", d: "", u: 0 }); },
      (x) => { x.info[0].t = "あ".repeat(121); },
      (x) => { x.info[0].d = "2030-02-30"; },
      (x) => { x.fac.items[0].n = " "; },
      (x) => { x.evt[0].items[0].from = "25:00"; },
      (x) => { x.evt.push({ d: "2030-01-05", items: [] }); },
      (x) => { (x.evt[0].items[0] as { acts: unknown[] }).acts[0] = { n: "", from: "13:00", to: "13:30" }; },
      (x) => { (x.evt[0].items[0] as { acts: unknown[] }).acts[0] = { n: "出演", from: "13:60", to: "" }; },
    ];
    for (const f of bad) {
      const x = base();
      f(x);
      expect(() => normalizeSchedule(x)).toThrow(ScheduleError);
    }
  });
});

describe("時刻表の API", () => {
  it("閲覧キーなし・送信キーでは読めない／保存できない", async () => {
    expect((await get({})).status).toBe(401);
    expect((await get({ Authorization: `Bearer ${WRITE_TOKENS["vehicle-1"]}` })).status).toBe(401);
    expect((await put(sample(), { Authorization: `Bearer ${WRITE_TOKENS["vehicle-1"]}`, "Content-Type": "application/json" })).status).toBe(401);
  });

  it("初回は未設定（null）→ 保存 → 読める", async () => {
    const r0 = await get();
    expect(r0.status).toBe(200);
    expect(await r0.json()).toMatchObject({ schemaVersion: 1, schedule: null, updatedAtMs: null });
    const r1 = await put({ schedule: sample() });
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as { updatedAtMs: number };
    const r2 = await get();
    const b2 = (await r2.json()) as { updatedAtMs: number; schedule: { days: { d: string }[] } };
    expect(b2.updatedAtMs).toBe(b1.updatedAtMs);
    expect(b2.schedule.days.map((d) => d.d)).toEqual(["2030-01-04", "2030-01-07"]);
    expect(r2.headers.get("Cache-Control")).toBe("no-store, private");
  });

  it("ほかの端末が先に保存していたら 409（上書きしない）", async () => {
    const a = (await (await put({ schedule: sample() })).json()) as { updatedAtMs: number };
    expect((await put({ schedule: sample() })).status).toBe(409); // 基準なしの2回目
    expect((await put({ schedule: sample(), baseUpdatedAtMs: a.updatedAtMs - 1 })).status).toBe(409);
    await new Promise((r) => setTimeout(r, 3));
    const ok = await put({ schedule: { ...sample(), days: [] }, baseUpdatedAtMs: a.updatedAtMs });
    expect(ok.status).toBe(200);
    const b = (await (await get()).json()) as { schedule: { days: unknown[] } };
    expect(b.schedule.days).toEqual([]);
  });

  it("形式の誤り：JSON 以外 415・壊れた JSON 400・不正な値 400・64KB 超 413", async () => {
    expect((await put({ schedule: sample() }, { ...auth, "Content-Type": "text/plain" })).status).toBe(415);
    expect((await put("{", { ...auth, "Content-Type": "application/json" })).status).toBe(400);
    const bad = await put({ schedule: { days: [{ d: "x", items: [] }] } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("bad_schedule");
    expect((await put({ schedule: sample(), pad: "x".repeat(70000) })).status).toBe(413);
    expect((await put({ schedule: sample(), baseUpdatedAtMs: "1" })).status).toBe(400);
  });

  it("プリフライトは GET・PUT と Content-Type を許可（DB は読まない）", async () => {
    const noDb = { prepare: () => { throw new Error("no db"); } } as unknown as D1Database;
    const r = await handle(new Request(URL_S, { method: "OPTIONS", headers: { Origin: ORIGIN_OK, "Access-Control-Request-Method": "PUT" } }), { ...E, DB: noDb }, Date.now());
    expect(r.status).toBe(204);
    expect(r.headers.get("Access-Control-Allow-Methods")).toBe("GET, PUT, OPTIONS");
    expect(r.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type");
    expect((await get({ ...auth, Origin: "https://evil.example" })).status).toBe(403);
    expect((await worker.fetch(new Request(URL_S, { method: "DELETE", headers: auth }), E)).status).toBe(405);
  });

  it("DB 障害は 503", async () => {
    const broken = { prepare: () => ({ first: () => Promise.reject(new Error("x")), bind: () => ({ run: () => Promise.reject(new Error("x")) }) }) } as unknown as D1Database;
    expect((await handle(new Request(URL_S, { headers: auth }), { ...E, DB: broken }, Date.now())).status).toBe(503);
    const pr = new Request(URL_S, { method: "PUT", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ schedule: sample() }) });
    expect((await handle(pr, { ...E, DB: broken }, Date.now())).status).toBe(503);
  });
});
