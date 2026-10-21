// 本部の時刻表（各号館の開錠・施錠時刻、エレベーターの使用可否）と、黒帯に流す情報（学内施設の営業時間・イベント時間・
// インフォメーション・黒帯の表示設定）の形をそろえる。副作用なし。
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
export const EV_MODES = ["auto", "ok", "soon", "ng", "none"] as const; // auto＝時間帯から判定（始まる30分前から△）、ok＝○、soon＝△（まもなく使用不可）、ng＝×、none＝ー
export const MAX_SCHEDULE_BYTES = 64 * 1024;
export const BAND_SRC = ["lock", "fac", "evt", "act", "info"] as const; // 開錠・施錠／学内施設時間／イベント時間／ステージ出演／インフォメーション

type FacilityKey = (typeof FACILITIES)[number][0];
type EvUnit = (typeof EV_UNITS)[number];
type EvMode = (typeof EV_MODES)[number];
export type BandSrcKey = (typeof BAND_SRC)[number];

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
export interface FacHours {
  days: string[]; // 列にする日
  items: { n: string; h: Record<string, string> }[]; // 施設名と、日ごとの営業時間（"8:00-20:00"・"休業"・自由記載。空＝記載なし）
}
export interface EventAct {
  n: string; // 出演者・団体
  from: string;
  to: string;
  note: string; // 例：開場15:00・チケット制
}
export interface EventItem {
  n: string; // 名称（例：出店グランプリ、LIVE STAGE）
  from: string;
  to: string;
  note: string;
  acts: EventAct[]; // ステージの出演ごとの時間（黒帯では「ステージ出演」として流す）
}
export interface EventDay {
  d: string;
  items: EventItem[];
}
export interface InfoMsg {
  id: string;
  t: string; // 黒帯に流す文
  on: boolean; // 流す
  d: string; // 流す日（空＝毎日）
  u: number; // 「今すぐ1回流す」を押した時刻（0＝なし）。各端末は新しい値を見たら次に1回はさむ
}
export interface BandSrc {
  on: boolean;
  col: string; // 文字の色 #rrggbb
  sec: number; // 1ページの表示秒数
}
export interface BandSettings {
  dateOnly: boolean; // 期間中はその日の情報だけを流す
  from: string; // 期間（空＝情報のある日の最初〜最後）
  to: string;
  src: Record<BandSrcKey, BandSrc>;
  seq: { s: BandSrcKey; n: number }[]; // 流す順番と回数（例：開錠・施錠を3回 → イベントを1回）
}
export interface Schedule {
  v: 1;
  days: ScheduleDay[];
  ev: Record<EvUnit, EvUnitData>;
  fac: FacHours;
  evt: EventDay[];
  info: InfoMsg[];
  band: BandSettings;
}

export const BAND_DEFAULT_COL: Record<BandSrcKey, string> = { lock: "#ffffff", fac: "#c3fae8", evt: "#ffe8cc", act: "#d0ebff", info: "#ffffff" };
export function defaultBand(): BandSettings {
  return {
    dateOnly: true,
    from: "",
    to: "",
    src: Object.fromEntries(BAND_SRC.map((k) => [k, { on: true, col: BAND_DEFAULT_COL[k], sec: 7.5 }])) as Record<BandSrcKey, BandSrc>,
    seq: BAND_SRC.map((s) => ({ s, n: 1 })),
  };
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

/** 文の検査：制御文字を除いて前後の空白を取る。長すぎ・型違いは null */
function text(s: unknown, max: number): string | null {
  if (s === undefined || s === null) return "";
  if (typeof s !== "string") return null;
  const t = s.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return t.length > max ? null : t;
}
/** 営業時間："08:00-20:00" → "8:00-20:00"。それ以外は自由記載（24文字まで） */
function hours(s: unknown): string | null {
  const t = text(s, 24);
  if (t === null) return null;
  const m = /^(\d{1,2}:\d{2})\s*[-〜~ー–]\s*(\d{1,2}:\d{2})$/.exec(t);
  if (m) {
    const a = normTime(m[1]), b = normTime(m[2]);
    if (a && b) return `${a}-${b}`;
  }
  return t;
}

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

  // 学内施設時間
  const rf = (o.fac ?? {}) as Record<string, unknown>;
  if (typeof rf !== "object" || Array.isArray(rf)) fail("bad fac");
  const fdays = Array.isArray(rf.days) ? (rf.days as unknown[]) : rf.days === undefined ? [] : fail("bad fac days");
  if (fdays.length > 14 || !fdays.every(validDate) || new Set(fdays).size !== fdays.length) fail("bad fac days");
  const facDays = (fdays as string[]).slice().sort();
  const fitems = Array.isArray(rf.items) ? (rf.items as unknown[]) : rf.items === undefined ? [] : fail("bad fac items");
  if (fitems.length > 20) fail("too many fac items");
  const fac: FacHours = {
    days: facDays,
    items: fitems.map((x) => {
      const it = (x ?? {}) as Record<string, unknown>;
      const n = text(it.n, 30);
      if (!n) fail("bad fac name");
      const rh = (it.h ?? {}) as Record<string, unknown>;
      if (typeof rh !== "object" || Array.isArray(rh)) fail("bad fac hours");
      const h: Record<string, string> = {};
      for (const d of facDays) {
        const v = hours(rh[d]);
        if (v === null) fail("bad fac hours");
        if (v) h[d] = v as string;
      }
      return { n: n as string, h };
    }),
  };

  // イベント時間
  const re = o.evt === undefined ? [] : Array.isArray(o.evt) ? (o.evt as unknown[]) : fail("bad evt");
  if (re.length > 14) fail("too many evt days");
  const eseen = new Set<string>();
  const evt: EventDay[] = re.map((x) => {
    const r = (x ?? {}) as Record<string, unknown>;
    if (!validDate(r.d) || eseen.has(r.d as string)) fail("bad evt date");
    eseen.add(r.d as string);
    const ri = Array.isArray(r.items) ? (r.items as unknown[]) : fail("bad evt items");
    if (ri.length > 30) fail("too many evt items");
    return {
      d: r.d as string,
      items: ri.map((y) => {
        const it = (y ?? {}) as Record<string, unknown>;
        const n = text(it.n, 30), note = text(it.note, 40), from = normTime(it.from), to = normTime(it.to);
        if (!n || note === null || from === null || to === null) fail("bad evt item");
        const ra = it.acts === undefined ? [] : Array.isArray(it.acts) ? (it.acts as unknown[]) : fail("bad evt acts");
        if (ra.length > 20) fail("too many acts");
        const acts = ra.map((z) => {
          const a = (z ?? {}) as Record<string, unknown>;
          const an = text(a.n, 40), anote = text(a.note, 30), af = normTime(a.from), at = normTime(a.to);
          if (!an || anote === null || af === null || at === null) fail("bad act");
          return { n: an as string, from: af as string, to: at as string, note: anote as string };
        });
        return { n: n as string, from: from as string, to: to as string, note: note as string, acts };
      }),
    };
  });
  evt.sort((a, b) => (a.d < b.d ? -1 : 1));

  // インフォメーション
  const ri = o.info === undefined ? [] : Array.isArray(o.info) ? (o.info as unknown[]) : fail("bad info");
  if (ri.length > 30) fail("too many info");
  const iseen = new Set<string>();
  const info: InfoMsg[] = ri.map((x) => {
    const m = (x ?? {}) as Record<string, unknown>;
    const id = typeof m.id === "string" && /^[A-Za-z0-9]{1,16}$/.test(m.id) && !iseen.has(m.id) ? m.id : fail("bad info id");
    iseen.add(id as string);
    const t = text(m.t, 120);
    if (!t) fail("bad info text");
    if (m.on !== undefined && typeof m.on !== "boolean") fail("bad info on");
    const d = m.d === undefined || m.d === "" ? "" : validDate(m.d) ? (m.d as string) : fail("bad info date");
    const u = m.u === undefined ? 0 : typeof m.u === "number" && Number.isFinite(m.u) && m.u >= 0 ? Math.floor(m.u) : fail("bad info u");
    return { id: id as string, t: t as string, on: m.on !== false, d: d as string, u: u as number };
  });

  // 黒帯の表示設定
  const rb = (o.band ?? {}) as Record<string, unknown>;
  if (typeof rb !== "object" || Array.isArray(rb)) fail("bad band");
  const band = defaultBand();
  if (rb.dateOnly !== undefined) band.dateOnly = typeof rb.dateOnly === "boolean" ? rb.dateOnly : fail("bad band dateOnly");
  for (const k of ["from", "to"] as const) {
    const v = rb[k];
    if (v !== undefined && v !== "") band[k] = validDate(v) ? (v as string) : fail("bad band period");
  }
  if (band.from && band.to && band.from > band.to) fail("bad band period");
  const rs = (rb.src ?? {}) as Record<string, unknown>;
  if (typeof rs !== "object" || Array.isArray(rs)) fail("bad band src");
  for (const k of BAND_SRC) {
    const x = (rs[k] ?? {}) as Record<string, unknown>;
    const b = band.src[k];
    if (x.on !== undefined) b.on = typeof x.on === "boolean" ? x.on : fail("bad band on");
    if (x.col !== undefined) b.col = typeof x.col === "string" && /^#[0-9a-fA-F]{6}$/.test(x.col) ? x.col.toLowerCase() : fail("bad band col");
    if (x.sec !== undefined) b.sec = typeof x.sec === "number" && x.sec >= 2 && x.sec <= 60 ? Math.round(x.sec * 2) / 2 : fail("bad band sec");
  }
  if (rb.seq !== undefined) {
    if (!Array.isArray(rb.seq) || rb.seq.length > 12) fail("bad band seq");
    band.seq = (rb.seq as unknown[]).map((x) => {
      const q = (x ?? {}) as Record<string, unknown>;
      if (!BAND_SRC.includes(q.s as BandSrcKey) || !Number.isInteger(q.n) || (q.n as number) < 1 || (q.n as number) > 20) fail("bad band seq");
      return { s: q.s as BandSrcKey, n: q.n as number };
    });
  }
  return { v: 1, days, ev, fac, evt, info, band };
}
