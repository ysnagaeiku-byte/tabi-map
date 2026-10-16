// たびマップ 本祭支援ツール：本部の時刻表と、画面最上部の黒帯に流す情報
// index-google.html?m=senshu のときだけ fest-vehicle-tracking.js の後に読み込む（編集画面「高度な設定」は fest-advanced.js）。
// 値は受信API（/api/v1/schedule）に置き、閲覧キーを持つ端末だけが読む（地図は公開のため、時刻や営業時間はコードに書かない）。
//  - 黒帯：開錠・施錠時刻／学内施設時間／イベント時間／ステージ出演／インフォメーションを、本部が決めた順番・回数・秒数・色で流す
//    期間中（既定は情報のある日の最初〜最後）はその日の情報だけ。期間外と、日付で絞るのをOFFにしたときは全日程を順に
//  - 時計の右側：9号館・10号館のエレベーター（9-EV・10-EV）の使用可否 ○／×／ー。15秒ごとに7秒間、今日の天気（専修大学周辺）と入れ替える
//    G倉庫IN：車両がG倉庫の中・外周から8m以内にいれば×、いなければ○。22時〜6時と、車両の位置を取得していないときはー
//  - 時計を押すとエレベーターの編集（時刻表の編集の権限があるキーだけ）。黒帯の情報と設定は本部版の「高度な設定」で編集
//  - 最後に取得した時刻表は端末に残し、通信できないときも表示する（キーが無効になったら消す）
(function () {
  'use strict';
  if (window.festSched) return;

  const FAC = [['b1', '1号館'], ['b2', '2号館'], ['b4', '4号館'], ['b5', '5号館'], ['b7', '7号館'], ['b10', '10号館'], ['gym1', '第一体育館'], ['ikuta', '生田会館']];
  const FAC_NOTE = { b4: '420教室', b10: '10101教室' };   // 開錠・施錠の基準
  const EVU = [['9', '9-EV', '9号館'], ['10', '10-EV', '10号館']];
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const SRC = ['lock', 'fac', 'evt', 'act', 'info'];
  const SRC_NAME = { lock: '開錠・施錠', fac: '学内施設', evt: 'イベント', act: 'ステージ', info: 'お知らせ' };
  const DEF_COL = { lock: '#ffffff', fac: '#c3fae8', evt: '#ffe8cc', act: '#d0ebff', info: '#ffffff' };
  const SLIDE_MS = 600, POLL_MS = 60000, SCROLL_PX_S = 45, URGENT_MAX_MS = 30 * 60000;
  const CACHE_KEY = 'fest_sched_cache', SEEN_U_KEY = 'fest_band_seen_u';

  const S = window.festSched = { data: null, updatedAtMs: null, error: '', loading: false, timer: null, draft: null, initialized: false, cached: false,
    loaded: false, draftBase: null, dirty: false,   // loaded：このキーで受信APIから読めた。draftBase：下書きの元にした版（保存時の照合に使う）
    preview: null, hooks: [] };   // preview：高度な設定で編集中の内容（この端末の黒帯で試す）。hooks：新しい版が届いたときに呼ぶ
  function cacheSave() { festStore.set(CACHE_KEY, JSON.stringify({ data: S.data, updatedAtMs: S.updatedAtMs })); }
  function cacheLoad() { try { const c = JSON.parse(festStore.get(CACHE_KEY) || 'null'); if (c && c.data) { S.data = c.data; S.updatedAtMs = c.updatedAtMs || null; S.cached = true; } } catch (e) {} }
  function cacheClear() { festStore.del(CACHE_KEY); S.data = null; S.updatedAtMs = null; S.cached = false; S.loaded = false; }
  const canEdit = () => (typeof festPerms === 'undefined') || !!festPerms.edit;
  const isFull = () => !!(window.festHttp && festHttp.isFull && festHttp.isFull()) && !festStore.preview;
  const $ = id => document.getElementById(id);
  const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(String(s)) : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]));
  const clone = o => JSON.parse(JSON.stringify(o));

  // ---------- 時刻（時計と同じくNTPで補正した日本時間） ----------
  const nowMs = () => (typeof window.festClockNow === 'function' ? window.festClockNow() : Date.now());
  function jst() { const d = new Date(nowMs() + 9 * 3600000); return { ymd: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() }; }
  const toMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; };
  function dayLabel(ymd, withMonth) { const [y, m, d] = ymd.split('-').map(Number), w = WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; return (withMonth ? m + '/' : '') + d + '(' + w + ')'; }
  const facName = f => (FAC.find(x => x[0] === f) || [f, f])[1];

  // ---------- 時刻表の形（受信APIの形に既定値を補う。以前の版の時刻表にも対応） ----------
  function emptySchedule() { return normDoc(null); }
  function normDoc(src) {
    const d = src ? clone(src) : { v: 1, days: [] };
    d.v = 1; d.days = Array.isArray(d.days) ? d.days : [];
    d.ev = d.ev && typeof d.ev === 'object' ? d.ev : {};
    EVU.forEach(([u]) => { const e = d.ev[u] && typeof d.ev[u] === 'object' ? d.ev[u] : {}; d.ev[u] = { mode: e.mode || 'auto', days: e.days && typeof e.days === 'object' ? e.days : {} }; });
    const f = d.fac && typeof d.fac === 'object' ? d.fac : {};
    d.fac = { days: Array.isArray(f.days) ? f.days : [], items: Array.isArray(f.items) ? f.items.map(x => ({ n: x.n || '', h: x.h && typeof x.h === 'object' ? x.h : {} })) : [] };
    d.evt = Array.isArray(d.evt) ? d.evt.map(x => ({ d: x.d, items: (Array.isArray(x.items) ? x.items : []).map(it => Object.assign({}, it, { acts: Array.isArray(it.acts) ? it.acts : [] })) })) : [];
    d.info = Array.isArray(d.info) ? d.info.map(m => ({ id: m.id, t: m.t || '', on: m.on !== false, d: m.d || '', u: m.u || 0 })) : [];
    const b = d.band && typeof d.band === 'object' ? d.band : {}, bs = b.src && typeof b.src === 'object' ? b.src : {};
    d.band = { dateOnly: b.dateOnly !== false, from: b.from || '', to: b.to || '', src: {}, seq: Array.isArray(b.seq) ? b.seq.map(q => ({ s: q.s, n: q.n })) : SRC.map(s => ({ s, n: 1 })) };
    SRC.forEach(k => { const x = bs[k] || {}; d.band.src[k] = { on: x.on !== false, col: /^#[0-9a-f]{6}$/i.test(x.col || '') ? x.col : DEF_COL[k], sec: typeof x.sec === 'number' ? x.sec : 7.5 }; });
    return d;
  }

  // ---------- 受信API ----------
  function cfg() { const h = window.festHttp; return h ? h.config : { apiBase: '', viewerToken: '' }; }
  function hasKey() { const c = cfg(); return !!(c.apiBase && c.viewerToken); }
  async function api(method, body) {
    const c = cfg();
    const r = await fetch(c.apiBase + '/api/v1/schedule', {
      method, cache: 'no-store', credentials: 'omit', mode: 'cors', referrerPolicy: 'no-referrer',
      headers: Object.assign({ Authorization: 'Bearer ' + c.viewerToken }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    let j = null; try { j = await r.json(); } catch (e) {}
    return { status: r.status, body: j };
  }
  async function load() {
    clearTimeout(S.timer); S.timer = null;
    if (!hasKey()) { S.error = ''; render(); return; }
    if (document.visibilityState === 'hidden') return;
    S.loading = true;
    try {
      const r = await api('GET');
      if (r.status === 200 && r.body && r.body.schemaVersion === 1) { S.data = r.body.schedule; S.updatedAtMs = r.body.updatedAtMs; S.error = ''; S.cached = false; S.loaded = true; cacheSave(); }
      else if (r.status === 401) { S.error = 'auth'; cacheClear(); try { if (window.festHttp && festHttp.fetchMe) festHttp.fetchMe(); } catch (e) {} }   // 取り消し・期限切れ：端末に残した時刻表も消し、権限を確かめ直す
      else S.error = 'http';
    } catch (e) { S.error = 'network'; }   // 通信できない：前回取得した時刻表のまま
    S.loading = false;
    render();
    S.timer = setTimeout(load, POLL_MS);
  }
  S.reload = load;
  /** 下書きを保存する。base：下書きの元にした版（違えば 409 で上書きしない）。結果 { ok, status, text } */
  async function saveDoc(doc, base) {
    try {
      const r = await api('PUT', { schedule: doc, baseUpdatedAtMs: base });
      if (r.status === 200 && r.body) { S.data = r.body.schedule; S.updatedAtMs = r.body.updatedAtMs; S.error = ''; S.loaded = true; cacheSave(); render(); return { ok: true, status: 200, text: '保存しました' }; }
      if (r.status === 409) { load(); return { ok: false, status: 409, text: 'ほかの端末が先に保存しました。「変更を取り消す」で最新を読み込み直してから編集してください' }; }
      if (r.status === 401) { S.error = 'auth'; render(); return { ok: false, status: 401, text: '閲覧キーが使えません（取り消し・期限切れ）' }; }
      if (r.status === 403) return { ok: false, status: 403, text: 'この端末では保存できません（権限がありません）' };
      return { ok: false, status: r.status, text: '保存できませんでした（' + ((r.body && (r.body.detail || r.body.error)) || r.status) + '）' };
    } catch (e) { return { ok: false, status: 0, text: '保存できませんでした（通信を確認してください）' }; }
  }

  // ---------- EV の判定 ----------
  function evState(u) {
    const e = S.data && S.data.ev && S.data.ev[u];
    if (!e) return 'na';
    if (e.mode === 'ok') return 'ok'; if (e.mode === 'ng') return 'ng'; if (e.mode === 'none') return 'na';
    const t = jst(), slots = e.days ? e.days[t.ymd] : undefined;
    if (!slots) return 'na';   // その日のデータなし
    return slots.some(s => { const a = toMin(s.from), b = toMin(s.to); return a != null && b != null && t.min >= a && t.min < b; }) ? 'ng' : 'ok';
  }
  const EV_SYM = { ok: '○', ng: '×', na: 'ー' }, EV_TXT = { ok: '使用可', ng: '使用不可', na: 'データなし' };
  // ---------- G倉庫IN：G倉庫に車両が入れるか（周りに車両がいなければ○） ----------
  const G_NEAR_M = 8, G_STALE_MS = 15 * 60000;
  const G_TXT = { ok: '入れる（周りに車両なし）', ng: '車両あり（G倉庫・外周8m以内に停車・走行中）', na: '夜間（22時〜6時）または車両の位置を取得していない' };
  function distToPoly(lat, lng, P) {   // 点から多角形までの距離（m）。中なら0
    const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110940, Q = P.map(q => [(q[1] - lng) * kx, (q[0] - lat) * ky]);
    let inside = false;
    for (let i = 0, j = Q.length - 1; i < Q.length; j = i++) { const a = Q[i], b = Q[j]; if ((a[1] > 0) !== (b[1] > 0) && 0 < (b[0] - a[0]) * (0 - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; }
    if (inside) return 0;
    let m = Infinity;
    for (let i = 0; i < Q.length; i++) { const a = Q[i], b = Q[(i + 1) % Q.length], dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; let t = L ? -(a[0] * dx + a[1] * dy) / L : 0; t = Math.max(0, Math.min(1, t)); m = Math.min(m, Math.hypot(a[0] + t * dx, a[1] + t * dy)); }
    return m;
  }
  function gState() {
    const t = jst(); if (t.min >= 22 * 60 || t.min < 6 * 60) return 'na';   // 夜間は車両の位置に関係なくー
    const h = window.festHttp, b = (typeof FEST_BLD !== 'undefined') && FEST_BLD.find(x => x.n === 'G倉庫');
    if (!h || !h.enabled || !h.lastSuccessAt || h.authBlocked || !b) return 'na';
    const sn = Date.now() + (h.serverClockOffsetMs || 0);
    const near = Object.values(h.vehicles || {}).some(v => v && v.pos && sn - v.pos.fixAtMs <= G_STALE_MS && distToPoly(v.pos.lat, v.pos.lon, b.p) <= G_NEAR_M);
    return near ? 'ng' : 'ok';
  }
  S.gState = gState;
  // ---------- 今日の天気（専修大学周辺。Open-Meteo：鍵不要・CORS可。30分ごと） ----------
  const WX_URL = 'https://api.open-meteo.com/v1/forecast?latitude=35.6101&longitude=139.5546&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo&forecast_days=1';
  const WX_EV_MS = 15000, WX_SHOW_MS = 7000, WX_POLL_MS = 30 * 60000;
  const W = { d: null, at: 0, busy: false };
  // 天気の種類（WMO）→ 短い表記・詳しい表記・アイコン
  function wxKind(c) {
    if (c <= 1) return [c ? '晴れ' : '快晴', c ? '晴れ' : '快晴', 'sun'];
    if (c === 2) return ['晴時々曇', '晴れ時々くもり', 'part'];
    if (c === 3) return ['くもり', 'くもり', 'cloud'];
    if (c === 45 || c === 48) return ['霧', '霧', 'fog'];
    if (c >= 51 && c <= 57) return ['霧雨', '霧雨', 'rain'];
    if (c === 61 || c === 80) return [c === 80 ? 'にわか雨' : '小雨', c === 80 ? 'にわか雨' : '小雨', 'rain'];
    if (c === 63 || c === 81) return ['雨', c === 81 ? 'にわか雨' : '雨', 'rain'];
    if (c === 65 || c === 82) return ['強い雨', '強い雨', 'rain'];
    if (c === 66 || c === 67) return ['冷たい雨', '冷たい雨', 'rain'];
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return ['雪', '雪', 'snow'];
    if (c >= 95) return ['雷雨', '雷雨', 'storm'];
    return ['—', '不明', 'cloud'];
  }
  const WX_SVG = {
    sun: '<circle cx="12" cy="12" r="4.2" fill="#fab005" stroke="#f08c00"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" stroke="#f08c00"/>',
    part: '<circle cx="9" cy="9" r="3.6" fill="#fab005" stroke="#f08c00"/><path d="M9 2.4v1.8M2.4 9h1.8M4.3 4.3l1.3 1.3M13.7 4.3l-1.3 1.3" stroke="#f08c00"/><path d="M8.5 19.5h9.2a3.6 3.6 0 0 0 .2-7.2 5 5 0 0 0-9.4 1.6 2.8 2.8 0 0 0 0 5.6z" fill="#dee2e6" stroke="#868e96"/>',
    cloud: '<path d="M7 19h10.5a4.2 4.2 0 0 0 .3-8.4 5.8 5.8 0 0 0-11 1.8A3.3 3.3 0 0 0 7 19z" fill="#dee2e6" stroke="#868e96"/>',
    fog: '<path d="M7 13.5h10.5a4 4 0 0 0 .2-8 5.6 5.6 0 0 0-10.6 1.7A3.2 3.2 0 0 0 7 13.5z" fill="#dee2e6" stroke="#868e96"/><path d="M4 17h16M6 20.5h12" stroke="#868e96"/>',
    rain: '<path d="M7 14.5h10.5a4 4 0 0 0 .2-8 5.6 5.6 0 0 0-10.6 1.7A3.2 3.2 0 0 0 7 14.5z" fill="#ced4da" stroke="#868e96"/><path d="M8.5 17.2l-1 2.8M12.5 17.2l-1 2.8M16.5 17.2l-1 2.8" stroke="#339af0"/>',
    snow: '<path d="M7 14.5h10.5a4 4 0 0 0 .2-8 5.6 5.6 0 0 0-10.6 1.7A3.2 3.2 0 0 0 7 14.5z" fill="#e9ecef" stroke="#868e96"/><circle cx="8.5" cy="18.4" r="1" fill="#74c0fc"/><circle cx="12.5" cy="19.6" r="1" fill="#74c0fc"/><circle cx="16.5" cy="18.4" r="1" fill="#74c0fc"/>',
    storm: '<path d="M7 14h10.5a4 4 0 0 0 .2-8 5.6 5.6 0 0 0-10.6 1.7A3.2 3.2 0 0 0 7 14z" fill="#ced4da" stroke="#868e96"/><path d="M12.8 14.5l-2.6 4h2.6l-1.6 3.5" stroke="#f59f00" stroke-width="1.8"/>',
  };
  async function wxLoad() {
    if (W.busy || document.visibilityState === 'hidden') return;
    W.busy = true;
    try {
      const r = await fetch(WX_URL, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
      const j = r.ok ? await r.json() : null, d = j && j.daily;
      if (d && Array.isArray(d.time) && d.time.length && typeof d.weather_code[0] === 'number') {
        W.d = { ymd: d.time[0], code: d.weather_code[0], hi: d.temperature_2m_max[0], lo: d.temperature_2m_min[0], pop: d.precipitation_probability_max[0] };
        W.at = Date.now();
      }
    } catch (e) {}   // 通信できない：前回の天気のまま（日付が変われば出さない）
    W.busy = false;
    renderEv();
  }
  function wxHtml() {
    const d = W.d; if (!d || d.ymd !== jst().ymd) return '';   // 今日の分がなければ出さない（エレベーターだけ表示）
    const k = wxKind(d.code), num = v => (typeof v === 'number' && isFinite(v)) ? Math.round(v) : '—';
    const pop = (typeof d.pop === 'number' && isFinite(d.pop)) ? Math.round(d.pop) : null;
    const tip = '今日の天気（専修大学周辺）：' + k[1] + '・最高' + num(d.hi) + '℃・最低' + num(d.lo) + '℃' + (pop != null ? '・降水確率' + pop + '%' : '') + '（Open-Meteo）';
    return '<div class="lc-wx-in" title="' + esc(tip) + '"><svg class="wx-ic" viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + WX_SVG[k[2]] + '</svg>'
      + '<span class="wx-t">' + esc(k[0]) + '</span><span class="wx-tp"><b class="wx-hi">' + num(d.hi) + '</b><i>/</i><b class="wx-lo">' + num(d.lo) + '</b><i>℃</i></span>'
      + (pop != null ? '<span class="wx-p"><i>降水</i><b>' + pop + '</b><i>%</i></span>' : '') + '</div>';
  }
  // エレベーター（15秒）⇔ 天気（7秒）を、フェードアウト→フェードインで入れ替える。G倉庫INは入れ替えない
  let wxShown = false, wxTm = null;
  function wxRotate() {
    clearTimeout(wxTm);
    const r = document.querySelector('#lcEv .lc-rot');
    const can = !!(r && r.classList.contains('has-wx'));
    wxShown = can ? !wxShown : false;
    if (r) r.classList.toggle('wx', wxShown);
    wxTm = setTimeout(wxRotate, wxShown ? WX_SHOW_MS : WX_EV_MS);
  }

  function renderEv() {
    const box = $('lcEv'); if (!box) return;
    if (!box.__init) { box.__init = true; box.innerHTML = '<div class="lc-rot"><div class="lc-ev-a"></div><div class="lc-wx"></div></div><div class="lc-g"></div>'; }
    const gs = gState();
    const ev = EVU.map(([u, lab]) => { const st = evState(u); return '<div class="lc-ev-u" title="' + lab + '：' + EV_TXT[st] + '"><span>' + lab + '</span><b class="ev-' + st + '">' + EV_SYM[st] + '</b></div>'; }).join('');
    const g = '<div class="lc-ev-u" title="G倉庫IN：' + G_TXT[gs] + '"><span>G倉庫IN</span><b class="ev-' + gs + '">' + EV_SYM[gs] + '</b></div>';
    const wx = wxHtml();
    const set = (el, h) => { if (el.__h !== h) { el.__h = h; el.innerHTML = h; } };
    set(box.querySelector('.lc-ev-a'), ev); set(box.querySelector('.lc-g'), g); set(box.querySelector('.lc-wx'), wx);
    const r = box.querySelector('.lc-rot'); r.classList.toggle('has-wx', !!wx);
    if (!wx && r.classList.contains('wx')) { r.classList.remove('wx'); wxShown = false; }
  }

  // ---------- 最上部の黒帯 ----------
  // 情報の種類ごとにページを作り、流す順番（band.seq：種類と回数）に並べて1周を作る。1回＝その種類の全ページを1度ずつ
  const B = { list: [], i: -1, key: '', tm: null, cur: 0, urgent: [] };
  function datesOf(doc) {
    return doc.days.map(x => x.d).concat(doc.fac.days, doc.evt.map(x => x.d)).filter((x, i, a) => x && a.indexOf(x) === i).sort();
  }
  /** 期間中で日付で絞るなら、その日（YYYY-MM-DD）。全日程を流すなら null */
  function bandDay(doc) {
    const b = doc.band; if (!b.dateOnly) return null;
    let from = b.from, to = b.to;
    if (!from || !to) { const ds = datesOf(doc); if (!ds.length) return null; from = from || ds[0]; to = to || ds[ds.length - 1]; }
    const t = jst().ymd;
    return t >= from && t <= to ? t : null;
  }
  S.bandDay = () => { const d = S.preview || (S.data && normDoc(S.data)); return d ? bandDay(d) : null; };
  // 時刻の色：施錠が21:00より後（21:00は含まない）＝黄、22:30を過ぎて翌4:00まで＝赤。開錠が4:00〜6:59＝水色
  function closeCls(t) { const m = toMin(t); if (m == null) return ''; if (m > 22 * 60 + 30 || m <= 4 * 60) return 'fb-red'; if (m > 21 * 60) return 'fb-yel'; return ''; }
  function openCls(t) { const m = toMin(t); return m != null && m >= 4 * 60 && m < 7 * 60 ? 'fb-cyan' : ''; }
  const tspan = (t, cls) => cls ? '<span class="' + cls + '">' + esc(t) + '</span>' : esc(t);
  function lockHtml(it) { const o = it.o || '', c = it.c || '', O = tspan(o, openCls(o)), C = tspan(c, closeCls(c));
    return o && c ? O + '-' + C : (o ? O + '〜' : '〜' + C); }
  const rangeTxt = (a, b) => a && b ? a + '-' + b : (a ? a + '〜' : (b ? '〜' + b : ''));
  /** 種類ごとのまとまり：[{ lab, items: [html] }] */
  function groupsOf(k, doc, day) {
    const pick = list => day ? list.filter(x => x.d === day) : list;
    const it = (n, v, extra) => '<span class="fb-it">' + esc(n) + (v ? ' <b>' + v + '</b>' : '') + (extra || '') + '</span>';
    if (k === 'lock') return pick(doc.days).filter(d => d.items && d.items.length)
      .map(d => ({ lab: SRC_NAME.lock + ' ' + dayLabel(d.d), items: d.items.map(x => it(facName(x.f), lockHtml(x))) }));
    if (k === 'fac') return (day ? doc.fac.days.filter(d => d === day) : doc.fac.days).map(d => ({ lab: SRC_NAME.fac + ' ' + dayLabel(d),
      items: doc.fac.items.filter(x => x.n && x.h[d]).map(x => it(x.n, esc(x.h[d]))) })).filter(g => g.items.length);
    if (k === 'evt') return pick(doc.evt).filter(d => d.items && d.items.length)
      .map(d => ({ lab: SRC_NAME.evt + ' ' + dayLabel(d.d), items: d.items.map(x => it(x.n, esc(rangeTxt(x.from, x.to)), x.note ? '<small>（' + esc(x.note) + '）</small>' : '')) }));
    if (k === 'act') return [].concat(...pick(doc.evt).map(d => d.items.filter(x => x.acts && x.acts.length)   // ステージごとに、出演の時間
      .map(x => ({ lab: x.n + ' ' + dayLabel(d.d), items: x.acts.map(a => it(a.n, esc(rangeTxt(a.from, a.to)), a.note ? '<small>（' + esc(a.note) + '）</small>' : '')) }))));
    if (k === 'info') return doc.info.filter(m => m.on && m.t && (!day || !m.d || m.d === day)).map(m => ({ lab: SRC_NAME.info, items: [it(m.t, '')] }));
    return [];
  }
  function measure(html) { const m = $('fbMeasure'); m.innerHTML = html; return m.offsetWidth; }
  /** まとまりをページに分ける（同じページ数で件数をそろえる：7件＋1件 → 4件＋4件） */
  function paginate(g, W) {
    const lab = '<span class="fb-day">【' + esc(g.lab) + '】</span>', lw = measure(lab), H = g.items, IW = H.map(measure);
    const greedy = []; let cur = [], w = lw;
    H.forEach((h, i) => { if (cur.length && w + IW[i] > W) { greedy.push(cur); cur = []; w = lw; } cur.push(i); w += IW[i]; });
    if (cur.length) greedy.push(cur);
    const k = greedy.length, per = Math.ceil(H.length / k), even = [];
    for (let i = 0; i < H.length; i += per) even.push(H.map((_, j) => j).slice(i, i + per));
    const fits = even.length === k && even.every(p => lw + p.reduce((t, j) => t + IW[j], 0) <= W);
    return (fits ? even : greedy).map(p => lab + p.map(j => H[j]).join(''));
  }
  const dim = t => [{ html: '<span class="fb-dim">' + t + '</span>', sec: 7.5 }];
  function playlist() {
    const view = $('festBand') && $('festBand').querySelector('.fb-view'); if (!view) return [];
    if (!hasKey()) return dim('開錠・施錠時刻など：閲覧キーを入れると表示（時計を押して設定）');
    if (S.error === 'auth') return dim('開錠・施錠時刻など：閲覧キーが違います（時計を押して入れ直す）');
    if (!S.preview && !S.data) return dim(S.loaded ? '黒帯に流す情報は未登録です' : '開錠・施錠時刻などを読み込み中…');
    const doc = S.preview || normDoc(S.data), day = bandDay(doc), off = S.error === 'network' && !S.preview;
    const W = view.clientWidth - 4 - (off ? measure('<span class="fb-off">前回取得</span>') : 0);
    const pages = {};
    SRC.forEach(k => { const c = doc.band.src[k]; pages[k] = c.on ? [].concat(...groupsOf(k, doc, day).map(g => paginate(g, W))).map(h => '<span style="color:' + c.col + '">' + h + '</span>') : []; });
    const out = [];
    doc.band.seq.forEach(q => { const P = pages[q.s] || []; for (let r = 0; r < q.n; r++) P.forEach(h => out.push({ html: h, sec: doc.band.src[q.s].sec })); });
    if (!out.length) return dim(S.preview ? '（この設定では流す情報がありません）' : '黒帯に流す情報は未登録です');
    return off ? out.map(p => ({ html: '<span class="fb-off">前回取得</span>' + p.html, sec: p.sec })) : out;   // 通信できない：前回取得した情報と分かるように
  }
  // 「今すぐ1回流す」：まだ見ていない新しいお知らせを、次のページの前にはさむ（30分より前のものは流さない）
  function seenU() {   // 初めての端末は、10分以内に押されたものだけ流す
    let v = 0; try { v = +(localStorage.getItem(SEEN_U_KEY) || 0); if (!v) { v = nowMs() - 10 * 60000; localStorage.setItem(SEEN_U_KEY, String(v)); } } catch (e) { v = nowMs() - 10 * 60000; }
    return v;
  }
  function checkUrgent() {
    const doc = S.data && normDoc(S.data); if (!doc || S.preview) return;
    const seen = seenU(), now = nowMs();
    const fresh = doc.info.filter(m => m.u && m.t && m.u > seen && now - m.u < URGENT_MAX_MS && !B.urgent.some(x => x.id === m.id && x.u === m.u)).sort((a, b) => a.u - b.u);
    if (!fresh.length) return;
    fresh.forEach(m => B.urgent.push({ id: m.id, u: m.u, html: '<span style="color:' + doc.band.src.info.col + '"><span class="fb-day">【' + SRC_NAME.info + '】</span><span class="fb-it">' + esc(m.t) + '</span></span>', sec: Math.max(doc.band.src.info.sec, 7.5) }));
    if (!B.tm) B.tm = setTimeout(bandNext, 300);
  }
  function pagesEls() { const band = $('festBand'); return band ? band.querySelectorAll('.fb-page') : []; }
  /** ページを出す。長い文は、出てから左へ流して最後まで見せる。表示する時間（ミリ秒）を返す */
  function put(el, item) {
    el.innerHTML = '<span class="fb-in">' + item.html + '</span>';
    const inn = el.firstChild, view = el.parentNode, over = inn.scrollWidth - view.clientWidth + 6;
    inn.style.transition = 'none'; inn.style.transform = 'translateX(0)';
    let hold = item.sec * 1000;
    if (over > 0) {
      const dur = over / SCROLL_PX_S * 1000;
      setTimeout(() => { inn.style.transition = 'transform ' + Math.round(dur) + 'ms linear'; inn.style.transform = 'translateX(' + (-over) + 'px)'; }, SLIDE_MS + 1200);
      hold = Math.max(hold, SLIDE_MS + 1200 + dur + 1800);
    }
    return hold;
  }
  function bandShow(reset) {
    if (!$('festBand')) return;
    const list = playlist(), key = JSON.stringify(list);
    if (!reset && key === B.key) { checkUrgent(); return; }
    B.key = key; B.list = list; B.i = 0; clearTimeout(B.tm); B.tm = null;
    const P = pagesEls();
    P.forEach(p => { p.style.transition = 'none'; p.style.transform = 'translateX(110%)'; });
    B.cur = 0; P[0].style.transform = 'translateX(0)';
    const hold = list[0] ? put(P[0], list[0]) : (P[0].innerHTML = '', 0);
    const long = P[0].firstChild && P[0].firstChild.scrollWidth > P[0].parentNode.clientWidth;
    if (list.length > 1 || long) B.tm = setTimeout(bandNext, hold);
    checkUrgent();
  }
  function bandNext() {
    B.tm = null;
    const P = pagesEls(); if (!P.length || !B.list.length) return;
    if (document.visibilityState === 'hidden') { B.tm = setTimeout(bandNext, 5000); return; }
    let item;
    if (B.urgent.length) {
      const u = B.urgent.shift(); item = u;
      try { localStorage.setItem(SEEN_U_KEY, String(Math.max(u.u, +(localStorage.getItem(SEEN_U_KEY) || 0)))); } catch (e) {}
    } else { B.i = (B.i + 1) % B.list.length; item = B.list[B.i]; }
    const a = P[B.cur], b = P[1 - B.cur];
    b.style.transition = 'none'; b.style.transform = 'translateX(105%)';
    const hold = put(b, item);
    void b.offsetWidth;   // 位置を確定させてから流す
    a.style.transition = b.style.transition = 'transform ' + SLIDE_MS + 'ms ease';
    a.style.transform = 'translateX(-105%)'; b.style.transform = 'translateX(0)';
    B.cur = 1 - B.cur;
    const long = b.firstChild && b.firstChild.scrollWidth > b.parentNode.clientWidth;
    if (B.list.length > 1 || B.urgent.length || long) B.tm = setTimeout(bandNext, hold + SLIDE_MS);
  }
  /** 高度な設定で編集中の内容を、この端末の黒帯で試す（null で元に戻す） */
  S.setPreview = doc => { S.preview = doc ? normDoc(doc) : null; bandShow(true); };

  function render() {
    renderEv(); bandShow(false);
    const ov = $('festSchedOverlay');   // 編集画面：まだ手を付けていない下書きは、新しい版が届いたら作り直す
    if (ov && ov.classList.contains('open') && (!S.draft || (!S.dirty && S.draftBase !== S.updatedAtMs))) { S.draft = null; editorRender(); }
    S.hooks.forEach(f => { try { f(); } catch (e) {} });
  }
  S.render = render;

  // ---------- エレベーターの編集画面（時計を押す） ----------
  function msg(t, err) { const m = $('fsMsg'); if (m) { m.textContent = t || ''; m.classList.toggle('err', !!err); } }
  function slotsText(sl) { return (sl || []).map(s => s.from + '-' + s.to).join(', '); }
  function parseSlots(t) {
    const out = []; const parts = String(t || '').split(/[,、，\s]+/).filter(Boolean);
    for (const p of parts) { const m = /^(\d{1,2}:\d{2})[-〜~ー–](\d{1,2}:\d{2})$/.exec(p); if (!m || toMin(m[1]) == null || toMin(m[2]) == null || toMin(m[1]) >= toMin(m[2])) return null; out.push({ from: m[1], to: m[2] }); }
    return out;
  }
  let evExtra = [];   // この画面で足した日（まだ時間帯を入れていない日）
  function editorOpen() {
    const ov = $('festSchedOverlay'); if (!ov) return;
    if (hasKey() && S.error !== 'auth' && !canEdit()) { if (typeof showStatus === 'function') { showStatus('この配布版ではEVを編集できません（閲覧のみ）', false); hideStatusLater(); } return; }
    S.draft = null; S.dirty = false; evExtra = []; ov.classList.add('open'); editorRender();
    if (hasKey()) load();
  }
  S.open = editorOpen;
  function editorRender() {
    const body = $('festSchedBody'); if (!body) return;
    if (!hasKey() || S.error === 'auth') {
      body.innerHTML = '<div class="set-help">開錠・施錠時刻やEVの可否などは、閲覧キーを持つ端末だけに表示します。' + (S.error === 'auth' ? '<b>閲覧キーが違います。</b>' : '') + '</div>'
        + '<input id="fsKey" type="password" placeholder="本部が配布した閲覧キー" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="閲覧キー" />'
        + '<button class="set-save" id="fsKeySave" type="button">閲覧キーを使う</button><div class="set-msg" id="fsMsg"></div>';
      $('fsKeySave').onclick = () => { const v = $('fsKey').value.trim(); if (!window.festHttp || !festHttp.setToken(v)) { msg('閲覧キーの形が違います（43文字）', true); return; } S.error = ''; load(); editorRender(); };
      return;
    }
    if (!S.loaded) {   // 読み込む前に下書きを作ると、空の表を保存して時刻表を消してしまう
      body.innerHTML = '<div class="set-help">' + (S.error && !S.loading ? '時刻表を読み込めませんでした（通信を確認してください）。読み込めるまで編集できません。' : '時刻表を読み込んでいます…') + '</div>';
      return;
    }
    if (!S.draft) { S.draft = normDoc(S.data); S.draftBase = S.updatedAtMs; S.dirty = false; }
    const D = S.draft;
    const days = datesOf(D).concat(Object.keys(D.ev['9'].days), Object.keys(D.ev['10'].days), evExtra).filter((x, i, a) => a.indexOf(x) === i).sort();
    let h = '<div class="fs-sec fs-first"><div class="set-label">エレベーター（EV）</div>';
    EVU.forEach(([u, lab, bld]) => {
      const e = D.ev[u];
      h += '<div class="fs-ev"><div class="fs-ev-h"><b>' + lab + '</b><span>' + bld + '</span><div class="seg fs-mode" data-u="' + u + '">'
        + [['auto', '自動'], ['ok', '○'], ['ng', '×'], ['none', 'ー']].map(([m, t]) => '<button type="button" data-m="' + m + '" class="' + (e.mode === m ? 'on' : '') + '">' + t + '</button>').join('') + '</div></div>';
      if (e.mode === 'auto') {
        h += days.length ? days.map(d => { const has = Object.prototype.hasOwnProperty.call(e.days, d);
          return '<label class="fs-evd"><span>' + dayLabel(d, true) + '</span><input type="text" data-u="' + u + '" data-d="' + d + '" value="' + esc(has ? slotsText(e.days[d]) : '') + '" placeholder="' + (has ? 'なし（終日使用可）' : 'データなし') + '" inputmode="numeric" /><span class="fs-chk"><input type="checkbox" data-u="' + u + '" data-d="' + d + '"' + (has ? ' checked' : '') + ' />設定済み</span></label>'; }).join('')
          : '<div class="set-help">日付がありません（下で日を追加してください）</div>';
      }
      h += '</div>';
    });
    h += '<div class="fs-tabs"><span class="fs-add"><input type="date" id="fsNewDay" aria-label="追加する日" /><button type="button" id="fsAddDay">日を追加</button></span></div>'
      + '<div class="set-help">使用不可の時間帯を「10:00-11:30, 14:00-15:00」の形で入力。「設定済み」の日は、時間帯の外が○、内が×になります。設定していない日はー（データなし）。'
      + (isFull() ? '<br>開錠・施錠時刻と黒帯に流す情報は、上の「高度な設定（情報組込）」で編集します。' : '') + '</div></div>';
    h += '<div class="share-row"><button class="set-save" id="fsSave" type="button">保存</button><button class="set-save ghost" id="fsReset" type="button">変更を取り消す</button></div>'
      + '<div class="set-msg" id="fsMsg">' + (S.updatedAtMs ? '最終更新 ' + new Date(S.updatedAtMs + 9 * 3600000).toISOString().slice(5, 16).replace('T', ' ').replace('-', '/') : '') + '</div>';
    body.innerHTML = h;
    // 入力 → 下書き
    body.querySelectorAll('.fs-mode').forEach(sg => sg.onclick = ev => { const b = ev.target.closest('button'); if (!b) return; D.ev[sg.dataset.u].mode = b.dataset.m; S.dirty = true; editorRender(); });
    body.querySelectorAll('.fs-evd input[type=text]').forEach(inp => inp.onchange = () => {
      const u = inp.dataset.u, d = inp.dataset.d, sl = parseSlots(inp.value);
      if (sl === null) { msg('時間帯の形が違います（例 10:00-11:30, 14:00-15:00）', true); inp.focus(); return; }
      D.ev[u].days[d] = sl; S.dirty = true; editorRender(); });
    body.querySelectorAll('.fs-evd input[type=checkbox]').forEach(cb => cb.onchange = () => { const u = cb.dataset.u, d = cb.dataset.d; if (cb.checked) D.ev[u].days[d] = D.ev[u].days[d] || []; else delete D.ev[u].days[d]; S.dirty = true; editorRender(); });
    $('fsAddDay').onclick = () => { const v = $('fsNewDay').value; if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { msg('追加する日を選んでください', true); return; } if (days.indexOf(v) >= 0) { msg('その日はすでにあります', true); return; } evExtra.push(v); editorRender(); };
    $('fsReset').onclick = () => { S.draft = null; S.dirty = false; evExtra = []; editorRender(); };
    $('fsSave').onclick = save;
  }
  async function save() {
    if (!S.draft) return;
    if (!S.dirty) { msg('変更はありません'); return; }
    const btn = $('fsSave'); if (btn) btn.disabled = true; msg('保存しています…');
    const r = await saveDoc(S.draft, S.draftBase);   // 下書きの元にした版と照合（途中で届いた新しい版を上書きしない）
    if (r.ok) { S.draft = null; S.dirty = false; evExtra = []; editorRender(); msg(r.text); return; }
    if (r.status === 401) editorRender(); else msg(r.text, true);
    if (btn) btn.disabled = false;
  }

  // ---------- 時計の幅（地図の切り替えの行にそろえる） ----------
  function fitClock() {
    const c = $('liveClock'), seg = $('festBaseBar') && $('festBaseBar').querySelector('.seg');
    if (!c) return;
    if (innerWidth <= 600 || !seg || !seg.offsetWidth) { c.style.width = ''; return; }
    c.style.width = Math.round(seg.getBoundingClientRect().width) + 'px';
  }

  // 高度な設定（fest-advanced.js）から使う部品
  S.u = { $, esc, clone, jst, toMin, dayLabel, normDoc, emptySchedule, datesOf, hasKey, isFull, saveDoc, FAC, FAC_NOTE, SRC, SRC_NAME, DEF_COL };

  S.init = function () {
    if (S.initialized || typeof FEST === 'undefined' || !FEST) return;
    S.initialized = true;
    const ov = $('festSchedOverlay');
    if (ov) { $('festSchedClose').onclick = () => { ov.classList.remove('open'); S.draft = null; S.dirty = false; }; ov.addEventListener('click', e => { if (e.target === ov) { ov.classList.remove('open'); S.draft = null; S.dirty = false; } }); }
    const clk = $('liveClock'); if (clk) { clk.addEventListener('click', editorOpen); clk.title = '現在時刻（NTP同期・JST）・EVの可否・G倉庫IN／押すとEVを編集'; }
    const band = $('festBand'); if (band) band.addEventListener('click', () => { if (isFull() && S.adv) S.adv.open(); else editorOpen(); });   // 本部版は高度な設定
    window.addEventListener('fest-token', () => { S.error = ''; S.loaded = false; S.draft = null; S.dirty = false; render(); load(); });   // キーが変わった：読み直すまで編集しない
    window.addEventListener('fest-vehicles', renderEv);   // 車両の位置が変わったら G倉庫IN を更新
    window.addEventListener('fest-me', () => { const m = window.festHttp && festHttp.me; if (m && m.role === 'invalid') { S.error = 'auth'; cacheClear(); } render(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { load(); if (Date.now() - W.at > WX_POLL_MS) wxLoad(); } });
    let rt = null; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { fitClock(); bandShow(true); }, 200); });
    let lastDay = jst().ymd;
    setInterval(() => { renderEv(); const d = jst().ymd; if (d !== lastDay) { lastDay = d; bandShow(true); wxLoad(); } }, 15000);   // EVは分単位・日付が変われば帯を作り直し、天気も取り直す
    wxLoad(); setInterval(wxLoad, WX_POLL_MS); wxTm = setTimeout(wxRotate, WX_EV_MS);   // 今日の天気（30分ごと）・エレベーターと入れ替え
    fitClock(); setTimeout(fitClock, 800);
    if (hasKey()) cacheLoad();   // 通信より先に、前回取得した時刻表を出す
    render(); load();
  };
})();
