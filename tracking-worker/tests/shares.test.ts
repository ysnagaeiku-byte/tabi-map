import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { clearShareCache, handle, normalizeShareInput, type Env } from "../src/app";
import { VIEW_TOKEN, WRITE_TOKENS } from "./fixtures";

const E = env as unknown as Env;
const B = "https://tracking.example";
const H = (t: string, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${t}`, ...extra });
const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(B + path, init), E);
async function issue(body: unknown, token = VIEW_TOKEN) {
  const r = await call("/api/v1/shares", { method: "POST", headers: H(token, { "Content-Type": "application/json" }), body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as { id: string; token: string; perms: Record<string, boolean>; expiresAtMs: number | null } };
}

beforeEach(async () => {
  await E.DB.exec("DELETE FROM fest_shares");
  await E.DB.exec("DELETE FROM fest_settings");
  clearShareCache();
});

describe("本部版（全権限）", () => {
  it("/me は full・全部許可", async () => {
    const r = await call("/api/v1/me", { headers: H(VIEW_TOKEN) });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ role: "full", perms: { settings: true, pins: true, edit: true } });
  });

  it("配布版を発行・一覧（キーは一覧に出さない）・取り消し", async () => {
    const a = await issue({ label: "受付係", perms: { settings: false, pins: false, edit: false } });
    expect(a.status).toBe(201);
    expect(a.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.body.id).toMatch(/^[A-Za-z0-9_-]{10}$/);
    const list = await call("/api/v1/shares", { headers: H(VIEW_TOKEN) });
    const text = await list.text();
    expect(text).not.toContain(a.body.token);
    expect(JSON.parse(text).shares[0]).toMatchObject({ id: a.body.id, label: "受付係", active: true, revokedAtMs: null });
    const del = await call("/api/v1/shares/" + a.body.id, { method: "DELETE", headers: H(VIEW_TOKEN) });
    expect(del.status).toBe(200);
    expect((await call("/api/v1/me", { headers: H(a.body.token) })).status).toBe(401); // 取り消し後は使えない
    expect((await call("/api/v1/shares/" + a.body.id, { method: "DELETE", headers: H(VIEW_TOKEN) })).status).toBe(404);
    const l2 = (await (await call("/api/v1/shares", { headers: H(VIEW_TOKEN) })).json()) as { shares: { active: boolean }[] };
    expect(l2.shares[0].active).toBe(false);
  });

  it("発行の入力チェック", async () => {
    const now = Date.now();
    expect(normalizeShareInput({ label: "", perms: {} }, now)).toBe("bad_label");
    expect(normalizeShareInput({ label: "x".repeat(41), perms: {} }, now)).toBe("bad_label");
    expect(normalizeShareInput({ label: "a", perms: { edit: "yes" } }, now)).toBe("bad_perms");
    expect(normalizeShareInput({ label: "a", perms: {}, expiresAtMs: now - 1 }, now)).toBe("bad_expiry");
    expect(normalizeShareInput({ label: "a", perms: {}, expiresAtMs: now + 401 * 86400_000 }, now)).toBe("bad_expiry");
    expect(normalizeShareInput({ label: " 係 ", perms: { pins: true } }, now)).toEqual({ label: "係", perms: { settings: false, pins: true, edit: false }, expiresAtMs: null });
    expect((await issue({ label: "" })).status).toBe(400);
    const r = await call("/api/v1/shares", { method: "POST", headers: H(VIEW_TOKEN, { "Content-Type": "text/plain" }), body: "{}" });
    expect(r.status).toBe(415);
  });
});

describe("配布版（制限つき）", () => {
  it("車両・時刻表は読める。権限どおりの /me", async () => {
    const a = await issue({ label: "見回り", perms: { settings: false, pins: true, edit: false } });
    const me = await call("/api/v1/me", { headers: H(a.body.token) });
    expect(await me.json()).toMatchObject({ role: "share", label: "見回り", perms: { settings: false, pins: true, edit: false }, expiresAtMs: null });
    expect((await call("/api/v1/vehicles", { headers: H(a.body.token) })).status).toBe(200);
    expect((await call("/api/v1/schedule", { headers: H(a.body.token) })).status).toBe(200);
  });

  it("編集の権限がなければ時刻表を保存できない（403）、あれば保存できる", async () => {
    const ro = await issue({ label: "閲覧のみ", perms: { edit: false } });
    const rw = await issue({ label: "編集可", perms: { edit: true } });
    const put = (t: string) =>
      call("/api/v1/schedule", { method: "PUT", headers: H(t, { "Content-Type": "application/json" }), body: JSON.stringify({ schedule: { days: [] } }) });
    expect((await put(ro.body.token)).status).toBe(403);
    expect((await put(rw.body.token)).status).toBe(200);
  });

  it("配布版のキーでは配布版の発行・一覧・取り消しができない", async () => {
    const a = await issue({ label: "a", perms: { settings: true, pins: true, edit: true } });
    expect((await issue({ label: "b" }, a.body.token)).status).toBe(403);
    expect((await call("/api/v1/shares", { headers: H(a.body.token) })).status).toBe(403);
    expect((await call("/api/v1/shares/" + a.body.id, { method: "DELETE", headers: H(a.body.token) })).status).toBe(403);
  });

  it("期限が過ぎたら使えない", async () => {
    const now = Date.now();
    const a = await issue({ label: "期限つき", perms: {}, expiresAtMs: now + 60_000 });
    const me = (t: number) => handle(new Request(B + "/api/v1/me", { headers: H(a.body.token) }), E, t);
    expect((await me(now + 1000)).status).toBe(200);
    clearShareCache();
    expect((await me(now + 61_000)).status).toBe(401);
  });

  it("知らないキー・送信キーは 401", async () => {
    expect((await call("/api/v1/me", { headers: H("z".repeat(43)) })).status).toBe(401);
    expect((await call("/api/v1/me", { headers: H(WRITE_TOKENS["vehicle-1"]) })).status).toBe(401);
    expect((await call("/api/v1/me")).status).toBe(401);
  });
});
