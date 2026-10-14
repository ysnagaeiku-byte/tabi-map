// 本部の時刻表（各号館の開錠・施錠時刻、エレベーターの使用可否）の形をそろえる。副作用なし。
// 地図は公開されているため、この値は受信APIに置き、閲覧キーを持つ本部の端末だけが読み書きする。

export const FACILITIES = [
  ["b1", "1号館"],
  ["b2", "2号館"],
  ["b4", "4号館"],
  ["b5", "5号館"],
  ["b7", "7号館"],
  ["b10", "10号館"],
  ["gym1", "第一体育館"],
  ["ikuta", "生田会館"],
] as const;
export const EV_UNITS = ["9", "10"] as const;
export const EV_MODES = ["auto", "ok", "ng", "none"] as const; // auto＝時間帯から判定、ok＝○、ng＝×、none＝ー
export const MAX_SCHEDULE_BYTES = 16 * 1024;

type FacilityKey = (typeof FACILITIES)[number][0];
type EvUnit = (typeof EV_UNITS)[number];
type EvMode = (typeof EV_MODES)[number];

export interface ScheduleItem {
  f: FacilityKey;
  o: string; // 開錠 "H:MM"（空＝記載なし）
  c: string; // 施錠
}
export interface ScheduleDay {
  d: string; // "YYYY-MM-DD"
  items: ScheduleItem[];
}
export interface EvSlot {
  from: string;
  to: string;
}
export interface EvUnitData {
  mode: EvMode;
  days: Record<string, EvSlot[]>; // その日の使用不可の時間帯。キーがある日＝データあり（空なら終日○）
}
export interface Schedule {
  v: 1;
  days: ScheduleDay[];
  ev: Record<EvUnit, EvUnitData>;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function validDate(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** "07:00"・"7:00" → "7:00"。空は ""。不正は null */
export function normTime(s: unknown): string | null {
  if (s === undefined || s === null || s === "") return "";
  if (typeof s !== "string") return null;
  const m = TIME_RE.exec(s.trim());
  return m ? `${+m[1]}:${m[2]}` : null;
}

export class ScheduleError extends Error {}

/** 受け取った値を検査して、決まった形だけを残す。不正なら ScheduleError */
export function normalizeSchedule(input: unknown): Schedule {
  const fail = (msg: string): never => {
    throw new ScheduleError(msg);
  };
  if (!input || typeof input !== "object") fail("schedule must be an object");
  const o = input as Record<string, unknown>;
  const rawDays = Array.isArray(o.days) ? o.days : fail("days must be an array");
  if (rawDays.length > 14) fail("too many days");
  const seen = new Set<string>();
  const days: ScheduleDay[] = rawDays.map((rd) => {
    const r = (rd ?? {}) as Record<string, unknown>;
    if (!validDate(r.d)) fail("bad date");
    const d = r.d as string;
    if (seen.has(d)) fail("duplicate date");
    seen.add(d);
    const rawItems = Array.isArray(r.items) ? r.items : fail("items must be an array");
    const fs = new Set<string>();
    const items: ScheduleItem[] = [];
    for (const ri of rawItems) {
      const it = (ri ?? {}) as Record<string, unknown>;
      const f = it.f;
      if (typeof f !== "string" || !FACILITIES.some(([k]) => k === f) || fs.has(f)) fail("bad facility");
      fs.add(f as string);
      const op = normTime(it.o), cl = normTime(it.c);
      if (op === null || cl === null) fail("bad time");
      if (op === "" && cl === "") continue; // 両方空の行は持たない
      items.push({ f: f as FacilityKey, o: op as string, c: cl as string });
    }
    items.sort((a, b) => FACILITIES.findIndex(([k]) => k === a.f) - FACILITIES.findIndex(([k]) => k === b.f));
    return { d, items };
  });
  days.sort((a, b) => (a.d < b.d ? -1 : 1));

  const rawEv = (o.ev ?? {}) as Record<string, unknown>;
  if (typeof rawEv !== "object") fail("ev must be an object");
  const ev = {} as Record<EvUnit, EvUnitData>;
  for (const u of EV_UNITS) {
    const ru = (rawEv[u] ?? {}) as Record<string, unknown>;
    const mode = (ru.mode ?? "auto") as string;
    if (!EV_MODES.includes(mode as EvMode)) fail("bad ev mode");
    const rd = (ru.days ?? {}) as Record<string, unknown>;
    if (typeof rd !== "object" || Array.isArray(rd)) fail("bad ev days");
    const keys = Object.keys(rd);
    if (keys.length > 14) fail("too many ev days");
    const outDays: Record<string, EvSlot[]> = {};
    for (const d of keys.sort()) {
      if (!validDate(d)) fail("bad ev date");
      const rs = rd[d];
      if (!Array.isArray(rs) || rs.length > 20) fail("bad ev slots");
      outDays[d] = (rs as unknown[]).map((x) => {
        const s = (x ?? {}) as Record<string, unknown>;
        const from = normTime(s.from), to = normTime(s.to);
        if (!from || !to) fail("bad ev slot");
        return { from: from as string, to: to as string };
      });
    }
    ev[u] = { mode: mode as EvMode, days: outDays };
  }
  return { v: 1, days, ev };
}
