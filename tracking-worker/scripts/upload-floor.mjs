#!/usr/bin/env node
// 構内図：大学公式サイトの各号館の配置図（PDF）を取り寄せ、ページ（階）ごとの画像（WebP・可逆）にして受信APIへ入れる。
// 画像はリポジトリには置かない（受信APIのデータベースに置き、閲覧キーで守る）。キーは .secrets から読み、画面には出さない。
//   node scripts/upload-floor.mjs local   … ローカル（wrangler dev）
//   node scripts/upload-floor.mjs prod    … 本番
// 必要なもの：poppler（pdftoppm・pdftotext）と webp（cwebp）。macOS なら brew install poppler webp
// 大学が配置図を新しくしたら、下の PDF の URL を生田キャンパスのページ（OFFICIAL）の「配置図」のリンクに合わせて直し、もう一度実行する。
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const OFFICIAL = "https://www.senshu-u.ac.jp/about/campus/ikuta.html";
const PDF = {
  b8: "https://www.senshu-u.ac.jp/albums/abm.php?d=73&f=abm00048548.pdf", // 8号館
  b9: "https://www.senshu-u.ac.jp/albums/abm.php?d=73&f=abm00066210.pdf", // 9号館（120年記念館）R7版
  b10: "https://www.senshu-u.ac.jp/albums/abm.php?d=73&f=abm00049296.pdf", // 10号館（130年記念館）
};
const DPI = 250;

const target = process.argv[2];
if (target !== "local" && target !== "prod") {
  console.error("使い方: node scripts/upload-floor.mjs local|prod");
  process.exit(2);
}
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const S = JSON.parse(readFileSync(path.join(ROOT, ".secrets", target === "prod" ? "production.json" : "local.json"), "utf8"));
const BASE = target === "prod" ? S.base : "http://127.0.0.1:8787";
const H = { Authorization: "Bearer " + S.viewToken };
for (const c of ["pdftoppm", "pdftotext", "cwebp"]) {
  try { execFileSync("which", [c], { stdio: "ignore" }); } catch { console.error(c + " がありません（brew install poppler webp）"); process.exit(1); }
}
const half = (s) => s.replace(/[０-９Ｍ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
const pngSize = (b) => [b.readUInt32BE(16), b.readUInt32BE(20)];

const tmp = mkdtempSync(path.join(tmpdir(), "floor-"));
try {
  for (const [bld, url] of Object.entries(PDF)) {
    const r = await fetch(url);
    const ct = (r.headers.get("content-type") || "").split(";")[0];
    const pdf = Buffer.from(await r.arrayBuffer());
    if (!r.ok || ct !== "application/pdf" || pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error(bld + ": PDF を取得できません（" + r.status + " " + ct + "）");
    const f = path.join(tmp, bld + ".pdf");
    writeFileSync(f, pdf);
    execFileSync("pdftoppm", ["-r", String(DPI), "-png", f, path.join(tmp, bld)]);
    const pages = readdirSync(tmp).filter((n) => n.startsWith(bld + "-") && n.endsWith(".png")).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
    const d = await fetch(BASE + "/api/v1/floor/" + bld, { method: "DELETE", headers: H });
    if (!d.ok) throw new Error(bld + ": 削除できません（" + d.status + "）");
    for (let i = 0; i < pages.length; i++) {
      const png = path.join(tmp, pages[i]), webp = png.replace(/\.png$/, ".webp");
      execFileSync("cwebp", ["-quiet", "-lossless", "-z", "9", png, "-o", webp]);
      const [w, h] = pngSize(readFileSync(png));
      const t = execFileSync("pdftotext", ["-f", String(i + 1), "-l", String(i + 1), f, "-"]).toString().replace(/\s+/g, "");
      const m = /号館）?([０-９0-9ＭM]+階(?:[〜~・][０-９0-9ＭM]+階)?)/.exec(t);
      const label = m ? half(m[1]) : i + 1 + "ページ";
      const body = readFileSync(webp);
      const q = new URLSearchParams({ label, w: String(w), h: String(h), src: url });
      const p = await fetch(BASE + "/api/v1/floor/" + bld + "/" + (i + 1) + "?" + q, { method: "PUT", headers: { ...H, "Content-Type": "image/webp" }, body });
      if (!p.ok) throw new Error(bld + " p" + (i + 1) + ": 入れられません（" + p.status + " " + (await p.text()) + "）");
      console.log(bld, "p" + (i + 1), label, w + "x" + h, Math.round(body.length / 1024) + "KB");
    }
  }
  console.log("完了（出典: " + OFFICIAL + "）");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
