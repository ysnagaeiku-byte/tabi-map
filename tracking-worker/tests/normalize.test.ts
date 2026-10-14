import { describe, expect, it } from "vitest";
import { normalizeReport, parseTimestamp, readNumber } from "../src/normalize";

const NOW = Date.UTC(2026, 9, 14, 3, 0, 0); // 固定のサーバー時刻（依存注入）
const p = (o: Record<string, string>) => new URLSearchParams(o);
const base = { id: "x", timestamp: String(NOW / 1000), lat: "35.61", lon: "139.555" };

describe("単位・境界", () => {
  it("speed は knots → km/h（10 knots = 18.52 km/h）", () => {
    const r = normalizeReport(p({ ...base, speed: "10" }), NOW);
    expect(r.kind).toBe("fix");
    if (r.kind === "fix") expect(r.speedKmh).toBe(18.52);
  });

  it("timestamp は秒・ミリ秒のどちらも同じ時刻になる", () => {
    expect(parseTimestamp(String(NOW / 1000))).toBe(NOW);
    expect(parseTimestamp(String(NOW))).toBe(NOW);
    expect(parseTimestamp("1791936000.5")).toBe(1791936000500);
    expect(parseTimestamp("2026-10-14T03:00:00Z")).toBe(NOW);
    expect(parseTimestamp("")).toBeNull();
    expect(parseTimestamp("abc")).toBeNull();
    expect(parseTimestamp("-5")).toBeNull();
  });

  it("lat=0・lon=0・batt=0 は有効な値", () => {
    const r = normalizeReport(p({ ...base, lat: "0", lon: "0", batt: "0", charge: "false" }), NOW);
    expect(r).toMatchObject({ kind: "fix", lat: 0, lon: 0, batteryPct: 0, charging: false });
  });

  it("空文字は 0 にしない", () => {
    expect(readNumber("")).toBeNull();
    expect(readNumber("  ")).toBeNull();
    const r = normalizeReport(p({ ...base, accuracy: "", speed: "", bearing: "", batt: "" }), NOW);
    expect(r).toMatchObject({ kind: "fix", accuracyM: null, speedKmh: null, headingDeg: null, batteryPct: null });
  });

  it("負数・範囲外の付帯値は null（位置は有効）", () => {
    const r = normalizeReport(p({ ...base, accuracy: "-1", speed: "-3", bearing: "360", batt: "101", charge: "maybe" }), NOW);
    expect(r).toMatchObject({ kind: "fix", accuracyM: null, speedKmh: null, headingDeg: null, batteryPct: null, charging: null });
    const r2 = normalizeReport(p({ ...base, bearing: "0", batt: "100", charge: "true" }), NOW);
    expect(r2).toMatchObject({ headingDeg: 0, batteryPct: 100, charging: true });
  });

  it("緯度 ±90・経度 ±180 の境界", () => {
    expect(normalizeReport(p({ ...base, lat: "90", lon: "-180" }), NOW).kind).toBe("fix");
    expect(normalizeReport(p({ ...base, lat: "90.0001" }), NOW)).toEqual({ kind: "reject", reason: "bad_coords" });
    expect(normalizeReport(p({ ...base, lon: "180.1" }), NOW)).toEqual({ kind: "reject", reason: "bad_coords" });
  });
});

describe("heartbeat・不正値", () => {
  it("lat / lon が両方ないものは heartbeat（電池は反映）", () => {
    const r = normalizeReport(p({ id: "x", timestamp: String(NOW / 1000), batt: "55" }), NOW);
    expect(r).toEqual({ kind: "heartbeat", atMs: NOW, batteryPct: 55, charging: null });
  });

  it("片方だけの座標・NaN・無限大は位置へ反映しない", () => {
    expect(normalizeReport(p({ id: "x", timestamp: String(NOW / 1000), lat: "35.6" }), NOW)).toEqual({ kind: "reject", reason: "partial_coords" });
    expect(normalizeReport(p({ ...base, lat: "NaN" }), NOW)).toEqual({ kind: "reject", reason: "bad_coords" });
    expect(normalizeReport(p({ ...base, lon: "Infinity" }), NOW)).toEqual({ kind: "reject", reason: "bad_coords" });
    expect(normalizeReport(p({ ...base, lat: "1e400" }), NOW)).toEqual({ kind: "reject", reason: "bad_coords" });
  });

  it("未来すぎる時刻（サーバー時刻＋120秒超）は破棄、120秒以内は受ける", () => {
    expect(normalizeReport(p({ ...base, timestamp: String((NOW + 121_000) / 1000) }), NOW)).toEqual({ kind: "reject", reason: "future_timestamp" });
    expect(normalizeReport(p({ ...base, timestamp: String((NOW + 120_000) / 1000) }), NOW).kind).toBe("fix");
  });

  it("時刻の欠落・過去すぎる時刻は破棄", () => {
    expect(normalizeReport(p({ id: "x", lat: "35", lon: "139" }), NOW)).toEqual({ kind: "reject", reason: "bad_timestamp" });
    expect(normalizeReport(p({ ...base, timestamp: "1000" }), NOW)).toEqual({ kind: "reject", reason: "bad_timestamp" });
  });
});
