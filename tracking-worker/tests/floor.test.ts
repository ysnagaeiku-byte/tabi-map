import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { clearShareCache, type Env } from "../src/app";
import { ORIGIN_OK, VIEW_TOKEN } from "./fixtures";

const E = env as unknown as Env;
const B = "https://tracking.example/api/v1/floor/";
const H = (t: string, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${t}`, ...extra });
const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(B + path, init), E);
// テスト用の小さな架空の画像（WebP の形だけ）
const webp = (n: number) => { const b = new Uint8Array(32 + n); b.set(new TextEncoder().encode("RIFF"), 0); b.set(new TextEncoder().encode("WEBPVP8L"), 8); return b; };
const SRC = "https://www.senshu-u.ac.jp/albums/abm.php?d=73&f=test.pdf";
const put = (bld: string, page: number, body: Uint8Array, token = VIEW_TOKEN, q = `label=1%E9%9A%8E&w=10&h=20&src=${encodeURIComponent(SRC)}`, ct = "image/webp") =>
  call(`${bld}/${page}?${q}`, { method: "PUT", headers: H(token, { "Content-Type": ct }), body });
async function share() {
  const r = await worker.fetch(new Request("https://tracking.example/api/v1/shares", { method: "POST", headers: H(VIEW_TOKEN, { "Content-Type": "application/json" }), body: JSON.stringify({ label: "配布", perms: { settings: true, pins: true, edit: true } }) }), E);
  return ((await r.json()) as { token: string }).token;
}

beforeEach(async () => {
  await E.DB.exec("DELETE FROM fest_floor");
  await E.DB.exec("DELETE FROM fest_shares");
  clearShareCache();
});

describe("構内図（/api/v1/floor）", () => {
  it("本部版のキーで入れ、閲覧キーで一覧と画像を読める", async () => {
    expect((await put("b10", 1, webp(100))).status).toBe(200);
    expect((await put("b10", 2, webp(50), VIEW_TOKEN, `label=2%E9%9A%8E&w=11&h=22&src=${encodeURIComponent(SRC)}`)).status).toBe(200);
    const t = await share();   // 配布版でも読める（構内図は公開されている情報）
    const ix = await call("b10", { headers: H(t, { Origin: ORIGIN_OK }) });
    expect(ix.status).toBe(200);
    expect(ix.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN_OK);
    const j = (await ix.json()) as { src: string; pages: { page: number; label: string; w: number; h: number; mime: string }[] };
    expect(j.src).toBe(SRC);
    expect(j.pages.map((p) => [p.page, p.label, p.w, p.h, p.mime])).toEqual([[1, "1階", 10, 20, "image/webp"], [2, "2階", 11, 22, "image/webp"]]);
    const im = await call("b10/2", { headers: H(t) });
    expect(im.status).toBe(200);
    expect(im.headers.get("Content-Type")).toBe("image/webp");
    expect(new Uint8Array(await im.arrayBuffer())).toEqual(webp(50));
  });

  it("入れ替え・削除は本部版のキーだけ。配布版は 403", async () => {
    const t = await share();
    expect((await put("b9", 1, webp(10), t)).status).toBe(403);
    expect((await call("b9", { method: "DELETE", headers: H(t) })).status).toBe(403);
    expect((await put("b9", 1, webp(10))).status).toBe(200);
    const d = await call("b9", { method: "DELETE", headers: H(VIEW_TOKEN) });
    expect(await d.json()).toMatchObject({ ok: true, deleted: 1 });
    expect((await call("b9", { headers: H(VIEW_TOKEN) })).status).toBe(404);
  });

  it("閲覧キーなし 401・知らない号館やページ 404・形の違う画像や値は拒否", async () => {
    expect((await call("b10")).status).toBe(401);
    expect((await call("b1", { headers: H(VIEW_TOKEN) })).status).toBe(404);
    expect((await call("b10/0", { headers: H(VIEW_TOKEN) })).status).toBe(404);
    expect((await call("b10/x", { headers: H(VIEW_TOKEN) })).status).toBe(404);
    expect((await call("b10/1", { headers: H(VIEW_TOKEN) })).status).toBe(404);   // まだ無い
    expect((await put("b10", 1, webp(10), VIEW_TOKEN, undefined, "image/gif")).status).toBe(415);
    expect((await put("b10", 1, new TextEncoder().encode("not an image at all........"))).status).toBe(400);
    expect((await put("b10", 1, webp(10), VIEW_TOKEN, "label=&w=10&h=20&src=" + encodeURIComponent(SRC))).status).toBe(400);
    expect((await put("b10", 1, webp(10), VIEW_TOKEN, "label=a&w=10&h=20&src=" + encodeURIComponent("https://evil.example/x.pdf"))).status).toBe(400);
    expect((await put("b10", 1, webp(1600 * 1024))).status).toBe(413);
    expect((await call("b10/1", { headers: H(VIEW_TOKEN, { Origin: "https://evil.example" }) })).status).toBe(403);
  });
});
