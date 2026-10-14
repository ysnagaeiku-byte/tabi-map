// Traccar Client（OsmAnd互換のPOSTフォーム）の値を、保存する形にそろえる。副作用なし・時刻は引数で受け取る。
//
// 現行の Traccar Client（traccar-client-sdk の HttpUploader）が送る項目：
//   id, lat, lon, timestamp（Unix秒）, accuracy（m）, altitude, speed（knots）, bearing（度）, batt（0〜100）, charge（true/false）, alarm
// 座標のない送信（lat / lon が両方ない）は、停車中の通信確認（heartbeat）として扱う。

export const FUTURE_LIMIT_MS = 120_000; // 端末の時計がサーバーより2分以上先なら破棄
export const MIN_VALID_MS = Date.UTC(2020, 0, 1); // これより前の時刻は端末の時計の異常とみなす
const MS_THRESHOLD = 100_000_000_000; // これ以上の数値はミリ秒、未満は秒（秒なら西暦5138年まで）
const KNOTS_TO_KMH = 1.852;

export type RejectReason =
  | "bad_timestamp"
  | "future_timestamp"
  | "partial_coords"
  | "bad_coords";

export interface Telemetry {
  batteryPct: number | null;
  charging: boolean | null;
}

export type Report =
  | ({
      kind: "fix";
      fixAtMs: number;
      lat: number;
      lon: number;
      accuracyM: number | null;
      speedKmh: number | null;
      headingDeg: number | null;
    } & Telemetry)
  | ({ kind: "heartbeat"; atMs: number } & Telemetry)
  | { kind: "reject"; reason: RejectReason };

/** 空欄・欠落は null、数値として読めないものは NaN（空文字を0にしない） */
export function readNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (s === "") return null;
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s)) return NaN;
  return Number(s);
}

/** timestamp：Unix秒・Unixミリ秒（数値の大きさで判別）または ISO 8601。読めなければ null */
export function parseTimestamp(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (s === "") return null;
  const n = readNumber(s);
  if (n !== null && !Number.isNaN(n)) {
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n >= MS_THRESHOLD ? n : n * 1000);
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function optionalRange(
  raw: string | null,
  min: number,
  maxExclusive: number | null,
  maxInclusive: number | null,
): number | null {
  const n = readNumber(raw);
  if (n === null || !Number.isFinite(n)) return null; // 欠落・NaN・無限大
  if (n < min) return null;
  if (maxExclusive !== null && n >= maxExclusive) return null;
  if (maxInclusive !== null && n > maxInclusive) return null;
  return n;
}

function parseBool(raw: string | null): boolean | null {
  if (raw == null) return null;
  const s = raw.trim().toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;
  return null;
}

const round = (n: number, digits: number) => {
  const k = 10 ** digits;
  return Math.round(n * k) / k;
};

/** 端末ID（id、互換の deviceid）。無ければ null */
export function readDeviceId(params: URLSearchParams): string | null {
  const v = params.get("id") ?? params.get("deviceid");
  if (v == null) return null;
  const s = v.trim();
  return s === "" ? null : s;
}

export function normalizeReport(params: URLSearchParams, nowMs: number): Report {
  const t = parseTimestamp(params.get("timestamp"));
  if (t === null || t < MIN_VALID_MS) return { kind: "reject", reason: "bad_timestamp" };
  if (t > nowMs + FUTURE_LIMIT_MS) return { kind: "reject", reason: "future_timestamp" };

  const batteryRaw = optionalRange(params.get("batt"), 0, null, 100);
  const telemetry: Telemetry = {
    batteryPct: batteryRaw === null ? null : round(batteryRaw, 1),
    charging: parseBool(params.get("charge")),
  };

  const lat = readNumber(params.get("lat"));
  const lon = readNumber(params.get("lon"));
  if (lat === null && lon === null) return { kind: "heartbeat", atMs: t, ...telemetry };
  if (lat === null || lon === null) return { kind: "reject", reason: "partial_coords" };
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return { kind: "reject", reason: "bad_coords" };
  }

  const accuracy = optionalRange(params.get("accuracy"), 0, null, null);
  const knots = optionalRange(params.get("speed"), 0, null, null);
  const heading = optionalRange(params.get("bearing") ?? params.get("heading"), 0, 360, null);
  return {
    kind: "fix",
    fixAtMs: t,
    lat,
    lon,
    accuracyM: accuracy === null ? null : round(accuracy, 1),
    speedKmh: knots === null ? null : round(knots * KNOTS_TO_KMH, 2),
    headingDeg: heading === null ? null : round(heading, 1),
    ...telemetry,
  };
}
