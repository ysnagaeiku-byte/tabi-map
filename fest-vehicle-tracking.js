// たびマップ 本祭支援ツール：車両の位置（Traccar Client → 受信API → この地図）
// index-google.html?m=senshu のときだけ読み込む（通常版・研究版では読み込まず、通信もしない）。
// 3台の最新位置を受信APIから10秒ごとに取り、地図の印（festSh.peers・festShRender）で
// 標準・白地図・高低差3D・実写3Dのどれにも描く。画面はメニューの「位置情報共有設定」。
// 公開してよいのは受信APIのURLだけ。閲覧キーは配布されたリンク（#key=…）か入力で受け取り、この端末（localStorage）に記憶する。
// キーの種類で権限が決まる：本部版（全権限）／配布版（本部が発行時に選んだ制限）。権限は /api/v1/me で確かめ、festPermsApply に渡す。
// 本部版では、配布版のキーの発行・一覧・取り消しができる（位置情報共有設定の下）。
// ローカル開発では localStorage の fest_track_cfg に {"apiBase":"http://127.0.0.1:8787"} を入れると、そちらへつなぐ。
(function () {
  'use strict';
  if (window.festHttp) return;

  const API_DEFAULT = 'https://festival-vehicle-tracking.festival-vehicle-tracking.workers.dev';   // 受信APIの URL（公開してよい値。閲覧キーは実行時に入力）
  const CFG_KEY = 'fest_track_cfg', TOK_KEY = 'fest_view_key', OLD_TOK_KEY = 'fest_track_view', ME_KEY = 'fest_me';
  const POLL_MS = 10000, RETRY_S = [10, 20, 40, 80, 120], TIMEOUT_MS = 8000;
  const CAUTION_MS = 30000, OLD_MS = 120000, HIDE_MS = 15 * 60000, CONTACT_OK_MS = 120000;
  const VEH = [
    { id: 'vehicle-1', name: '1号車', col: '#e8590c' },
    { id: 'vehicle-2', name: '2号車', col: '#1864ab' },
    { id: 'vehicle-3', name: '3号車', col: '#2b8a3e' },
  ];
  const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

  const festHttp = window.festHttp = {
    config: { apiBase: '', viewerToken: '' },
    enabled: false, initialized: false, generation: 0,
    timer: null, abortController: null,
    lastSuccessAt: 0, lastError: '', serverClockOffsetMs: 0,
    vehicles: {}, fails: 0, authBlocked: false, paused: false, uiTick: null, nextAt: 0,
    me: null, fromLink: false,
  };
  /** 閲覧キーそのもの、または配布リンク（…#key=キー）からキーを取り出す */
  function extractKey(v) {
    v = String(v || '').trim();
    if (TOKEN_RE.test(v)) return v;
    const m = /[#&?]key=([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(v);
    return m ? m[1] : '';
  }

  // ---------- 設定 ----------
  function normBase(s) {
    s = String(s || '').trim().replace(/\/+$/, '');
    if (/^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~\/-]*)?$/.test(s)) return s;
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(s)) return s;   // ローカル開発用
    return '';
  }
  function cfgLoad() {
    let c = null;
    try { c = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch (e) {}
    let tok = '';
    try { tok = localStorage.getItem(TOK_KEY) || sessionStorage.getItem(OLD_TOK_KEY) || ''; sessionStorage.removeItem(OLD_TOK_KEY); } catch (e) {}
    const fromLink = extractKey(location.hash);   // 配布リンク：キーを記憶してアドレス欄から消す
    if (fromLink) { tok = fromLink; festHttp.fromLink = true; try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} }
    const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);   // 受信APIの差し替えはローカル開発のページだけ
    festHttp.config.apiBase = (local && normBase(c && c.apiBase)) || API_DEFAULT;
    festHttp.config.viewerToken = TOKEN_RE.test(tok) ? tok : '';
    festHttp.enabled = !!(c && c.on) || festHttp.fromLink;   // リンクから開いたら車両の表示も始める
    if (festHttp.fromLink) cfgSave();
  }
  function cfgSave() {
    try {
      const c = JSON.parse(localStorage.getItem(CFG_KEY) || 'null') || {};
      c.on = festHttp.enabled;
      localStorage.setItem(CFG_KEY, JSON.stringify(c));
    } catch (e) {}
    try {
      if (festHttp.config.viewerToken) localStorage.setItem(TOK_KEY, festHttp.config.viewerToken);
      else localStorage.removeItem(TOK_KEY);
    } catch (e) {}
  }

  // ---------- 時刻（サーバー時刻を基準に古さを出す。閲覧端末の時計ずれを補正） ----------
  const serverNow = () => Date.now() + festHttp.serverClockOffsetMs;
  const ageOf = ts => Math.max(0, serverNow() - ts);
  function ago(ms) {
    const s = Math.round(ms / 1000);
    return s < 60 ? s + '秒前' : (s < 3600 ? Math.floor(s / 60) + '分前' : Math.floor(s / 3600) + '時間前');
  }
  const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;

  // ---------- 取得（重ならないよう、終わってから次を予約） ----------
  function canPoll() {
    const c = festHttp.config;
    return festHttp.enabled && !!c.apiBase && !!c.viewerToken && !festHttp.authBlocked && !festHttp.paused && document.visibilityState !== 'hidden';
  }
  function cancel() {
    festHttp.generation++;   // 通信中の応答は捨てる
    clearTimeout(festHttp.timer); festHttp.timer = null; festHttp.nextAt = 0;
    if (festHttp.abortController) { try { festHttp.abortController.abort(); } catch (e) {} festHttp.abortController = null; }
  }
  function schedule(ms) {
    clearTimeout(festHttp.timer);
    festHttp.nextAt = Date.now() + ms;
    festHttp.timer = setTimeout(fetchNow, ms);
  }
  async function fetchNow() {
    clearTimeout(festHttp.timer); festHttp.timer = null; festHttp.nextAt = 0;
    if (!canPoll()) { ui(); return; }
    if (festHttp.abortController) return;   // 取得中（重ねない）
    const gen = festHttp.generation, c = festHttp.config, ac = new AbortController();
    festHttp.abortController = ac;
    const to = setTimeout(() => ac.abort(), TIMEOUT_MS);
    const t0 = Date.now();
    try {
      const r = await fetch(c.apiBase + '/api/v1/vehicles', {
        headers: { Authorization: 'Bearer ' + c.viewerToken },
        cache: 'no-store', credentials: 'omit', mode: 'cors', referrerPolicy: 'no-referrer', signal: ac.signal,
      });
      const t1 = Date.now();
      if (gen !== festHttp.generation) return;
      if (r.status === 401 || r.status === 403) {   // 入力し直すまで再試行しない
        festHttp.authBlocked = true; festHttp.lastError = r.status === 401 ? 'auth' : 'origin';
        return;
      }
      if (!r.ok) throw Object.assign(new Error('http'), { status: r.status });
      const b = await r.json();
      if (gen !== festHttp.generation) return;
      if (!b || b.schemaVersion !== 1 || !Array.isArray(b.vehicles) || !isFinite(b.serverNowMs)) throw new Error('format');
      festHttp.serverClockOffsetMs = b.serverNowMs - (t0 + t1) / 2;
      apply(b.vehicles);
      festHttp.lastSuccessAt = Date.now(); festHttp.lastError = ''; festHttp.fails = 0;
      schedule(POLL_MS);
    } catch (e) {
      if (gen !== festHttp.generation) return;   // 停止・一時停止・設定変更で止めた
      festHttp.fails++;
      festHttp.lastError = e && e.name === 'AbortError' ? 'timeout' : (e && e.status ? (e.status === 503 ? 'unavailable' : 'http') : (e && e.message === 'format' ? 'format' : 'network'));
      schedule(RETRY_S[Math.min(festHttp.fails - 1, RETRY_S.length - 1)] * 1000 + Math.floor(Math.random() * 2000));
    } finally {
      clearTimeout(to);
      if (festHttp.abortController === ac) festHttp.abortController = null;
      if (gen === festHttp.generation) ui();
    }
  }

  // ---------- 受け取った3台を、地図の印（festSh.peers の http:… ）へ ----------
  function apply(list) {
    VEH.forEach(v => {
      const o = list.find(x => x && x.vehicleId === v.id) || {};
      const prev = festHttp.vehicles[v.id];
      const p = o.position;
      let pos = (p && num(p.lat) !== null && num(p.lon) !== null && num(p.fixAtMs) !== null && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180)
        ? { lat: p.lat, lon: p.lon, fixAtMs: p.fixAtMs, receivedAtMs: num(p.receivedAtMs), accuracyM: num(p.accuracyM), speedKmh: num(p.speedKmh), headingDeg: num(p.headingDeg) } : null;
      if (prev && prev.pos && pos && pos.fixAtMs < prev.pos.fixAtMs) pos = prev.pos;   // 古い応答で位置を戻さない
      festHttp.vehicles[v.id] = {
        name: typeof o.name === 'string' && o.name ? o.name.slice(0, 16) : v.name, pos,
        lastContactAtMs: num(o.lastContactAtMs),
        batteryPct: num(o.batteryPct), charging: typeof o.charging === 'boolean' ? o.charging : null,
      };
      peer(v);
    });
    try { festShRender(); festShAnimKick(); } catch (e) { console.warn('trk render', e); }
  }
  function peer(v) {
    const s = festHttp.vehicles[v.id], pid = 'http:' + v.id, p = festSh.peers[pid];
    if (!s || !s.pos || ageOf(s.pos.fixAtMs) > HIDE_MS) { if (p) festShDrop(pid); return; }   // 未測位・15分超は印を出さない（一覧には残す）
    const q = s.pos, tLocal = q.fixAtMs - festHttp.serverClockOffsetMs, ex = { bt: s.batteryPct, ch: s.charging, n: s.name, rx: tLocal, t: tLocal };
    if (p && p.fixAt === q.fixAtMs) { Object.assign(p, ex); return; }   // 同じ測位：電池などだけ更新（古さは若返らせない）
    const kx = 111320 * Math.cos(q.lat * Math.PI / 180), ky = 110940;
    const r = festSh.peers[pid] = Object.assign(p || {}, ex, {
      la: q.lat, ln: q.lon, ac: q.accuracyM == null ? 0 : Math.round(q.accuracyM),
      sp: q.speedKmh == null ? null : Math.round(q.speedKmh), hd: q.headingDeg == null ? null : Math.round(q.headingDeg),
      ss: 'http', lost: false, ve: 0, vn: 0, fat: Date.now(), kx, ky,   // 速度での先読み（外挿）はしない
      stl: OLD_MS, http: true, vid: v.id, col: v.col, fixAt: q.fixAtMs,
    });
    if (r.dla == null || Math.hypot((r.dla - q.lat) * ky, (r.dln - q.lon) * kx) > 400) { r.dla = q.lat; r.dln = q.lon; }   // 初回・大きく飛んだときはその場へ
  }
  function dropAll() { Object.keys(festSh.peers).filter(id => id.indexOf('http:') === 0).forEach(festShDrop); }

  // ---------- 状態の文言 ----------
  function vehState(s) {
    if (!s) return { cls: 'none', t: '未取得', d: '' };
    const lc = s.lastContactAtMs, contactAge = lc ? ageOf(lc) : null, contactRecent = contactAge != null && contactAge <= CONTACT_OK_MS;
    const bat = s.batteryPct != null ? '電池' + Math.round(s.batteryPct) + '%' + (s.charging ? '・充電中' : '') : '';
    if (!s.pos) {
      return { cls: 'none', t: lc ? '未測位・通信 ' + ago(contactAge) : '未通信', d: bat };
    }
    const a = ageOf(s.pos.fixAtMs), acc = s.pos.accuracyM != null ? '誤差±' + Math.round(s.pos.accuracyM) + 'm' : '';
    let cls = 'ok', t = '測位 ' + ago(a);
    if (a > HIDE_MS) { cls = 'old'; t = '位置が古い・' + ago(a) + '・地図に非表示'; }
    else if (a > OLD_MS) { cls = 'old'; t = '位置が古い・' + ago(a); }
    else if (a > CAUTION_MS) { cls = 'caution'; t = '位置がやや古い・' + ago(a); }
    let note = '';
    if (cls === 'old') note = contactRecent ? '通信あり・停車中の可能性' : (lc ? '通信 ' + ago(contactAge) : '');
    const sp = cls === 'ok' && s.pos.speedKmh != null ? Math.round(s.pos.speedKmh) + 'km/h' : '';
    return { cls, t, d: [note, sp, acc, bat].filter(Boolean).join('・') };
  }
  function recvText() {
    const h = festHttp, c = h.config;
    if (!h.enabled) return '停止中・閲覧キーを入れて「表示を開始」';
    if (!c.apiBase) return '受信APIが設定されていません';
    if (!c.viewerToken) return '閲覧キーを入力してください';
    if (h.authBlocked) return h.lastError === 'origin' ? 'この地図のアドレスは受信APIで許可されていません' : '閲覧キーが違います。入力し直してください';
    const last = h.lastSuccessAt ? '最終取得 ' + ago(Date.now() - h.lastSuccessAt) : '未取得';
    if (h.lastError) {
      const why = { timeout: '応答なし', network: '通信できません', unavailable: '受信APIが準備中です', http: '受信APIのエラー', format: '応答の形式が違います' }[h.lastError] || 'エラー';
      const wait = h.nextAt ? '・' + Math.max(1, Math.round((h.nextAt - Date.now()) / 1000)) + '秒後に再試行' : '';
      return '本部の受信エラー：' + why + wait + '・' + last;
    }
    if (!h.lastSuccessAt) return '取得しています…';
    return '本部の受信：正常・' + last;
  }
  festHttp.menuText = function () {
    if (!festHttp.enabled) return '';
    const n = VEH.filter(v => { const s = festHttp.vehicles[v.id]; return s && s.pos && ageOf(s.pos.fixAtMs) <= OLD_MS; }).length;
    return '車両3台の位置を表示中・' + n + '台が最新' + (festHttp.lastError || festHttp.authBlocked ? '・本部の受信エラー' : '');
  };

  // ---------- 画面 ----------
  const $ = id => document.getElementById(id);
  function ui() {
    try { festShUi(); } catch (e) {}
    const msg = $('festTrkMsg'), list = $('festTrkList');
    const st = $('festTrkStop'); if (st) st.disabled = !festHttp.enabled;
    const cf = $('festTrkCfg'); if (cf && festHttp.enabled && (festHttp.authBlocked || !festHttp.config.viewerToken || !festHttp.config.apiBase)) cf.open = true;   // 入力が要るときは設定を開く
    if (msg) { msg.textContent = recvText(); msg.classList.toggle('err', !!(festHttp.enabled && (festHttp.lastError || festHttp.authBlocked))); }
    const rl = $('festTrkRole'); if (rl) { const t = roleText(); rl.textContent = t; rl.style.display = t ? '' : 'none'; }
    if (!list) return;
    if (!festHttp.enabled) { list.innerHTML = ''; return; }
    list.innerHTML = VEH.map(v => {
      const s = festHttp.vehicles[v.id], k = vehState(s), name = s ? s.name : v.name;
      return '<button type="button" class="fest-trk-row st-' + k.cls + '" data-v="' + v.id + '"' + (s && s.pos ? '' : ' disabled') + '>'
        + '<i style="background:' + (k.cls === 'old' || k.cls === 'none' ? '#868e96' : v.col) + '"></i>'
        + '<span class="nm">' + escapeHtml(name) + '</span><span class="tx"><b>' + escapeHtml(k.t) + '</b>' + (k.d ? '<small>' + escapeHtml(k.d) + '</small>' : '') + '</span></button>';
    }).join('');
    list.querySelectorAll('.fest-trk-row').forEach(b => b.onclick = () => focus(b.dataset.v));
  }
  function focus(vid) {
    const s = festHttp.vehicles[vid]; if (!s || !s.pos) return;
    const ov = $('festShareOverlay'); if (ov) ov.classList.remove('open');
    const q = s.pos;
    if (festBase === 'p3d' && fest3d) { try { fest3d.flyCameraTo({ endCamera: { center: { lat: q.lat, lng: q.lon, altitude: 0 }, range: Math.min(fest3d.range || 600, 600), tilt: fest3d.tilt, heading: fest3d.heading }, durationMillis: 900 }); } catch (e) {} }
    else if (map) map.panTo({ lat: q.lat, lng: q.lon });
    info(vid);
  }
  function info(vid) {
    const s = festHttp.vehicles[vid], v = VEH.find(x => x.id === vid); if (!s || !s.pos || !v) return;
    const k = vehState(s), q = s.pos, a = ageOf(q.fixAtMs), lc = s.lastContactAtMs;
    const notes = [];
    if (k.cls === 'old') notes.push(['warn', '位置が古い', ago(a) + 'に測位した位置です。' + (lc && ageOf(lc) <= CONTACT_OK_MS ? '端末との通信は続いているため、停車中の可能性があります。' : '端末からの通信も止まっています。電源・通信・アプリの送信ONを確認してください。')]);
    else if (k.cls === 'caution') notes.push(['mute', '位置がやや古い', ago(a) + 'に測位した位置です。']);
    if (festHttp.lastError || festHttp.authBlocked) notes.push(['warn', '本部の受信エラー', recvText()]);
    const rows = [['通信', lc ? ago(ageOf(lc)) : '—']];
    if (s.batteryPct != null) rows.push(['電池', Math.round(s.batteryPct) + '%' + (s.charging ? '・充電中' : '')]);
    festCardShow(festCard({
      title: s.name, kind: '車両の位置（Traccar）', dot: k.cls === 'old' ? '#868e96' : v.col,
      stats: [[escapeHtml(a < 5000 ? 'いま' : ago(a)), '測位'], [q.speedKmh != null && k.cls !== 'old' ? String(Math.round(q.speedKmh)) : '—', 'km/h'], [q.accuracyM != null ? '±' + Math.round(q.accuracyM) : '—', '誤差 m']],
      rows: rows.map(r => [r[0], escapeHtml(r[1])]), notes, extra: routeActionsHtml(q.lat, q.lon, s.name),
    }));
  }
  festHttp.info = info;
  festHttp.ui = ui;

  // ---------- 開始・停止 ----------
  function start() {
    cancel();
    festHttp.enabled = true; festHttp.authBlocked = false; festHttp.fails = 0; festHttp.lastError = '';
    cfgSave();
    const cf = $('festTrkCfg'); if (cf && festHttp.config.viewerToken) cf.open = false;
    clearInterval(festHttp.uiTick);
    festHttp.uiTick = setInterval(() => { if (document.visibilityState !== 'hidden') { VEH.forEach(peer); try { festShRender(); } catch (e) {} ui(); } }, 5000);   // 古さの表示を進める
    fetchNow(); ui();
  }
  function stop() {
    cancel();
    festHttp.enabled = false; festHttp.lastError = ''; festHttp.authBlocked = false; festHttp.fails = 0; festHttp.lastSuccessAt = 0;
    festHttp.vehicles = {};
    cfgSave();
    clearInterval(festHttp.uiTick); festHttp.uiTick = null;
    dropAll();
    ui();
  }
  festHttp.start = start; festHttp.stop = stop;
  // 閲覧キーだけを入れる（車両の表示は始めない）。本部の時刻表（fest-schedule.js）からも使う
  festHttp.setToken = function (tok) {
    tok = extractKey(tok);
    if (!tok) return false;
    festHttp.config.viewerToken = tok; festHttp.authBlocked = false;
    try { localStorage.setItem(TOK_KEY, tok); } catch (e) {}
    try { window.dispatchEvent(new Event('fest-token')); } catch (e) {}
    if (festHttp.enabled) { cancel(); fetchNow(); }
    fetchMe(); ui(); return true;
  };

  // ---------- 権限（本部版／配布版） ----------
  function applyMe(me) { try { if (typeof festPermsApply === 'function') festPermsApply(me); } catch (e) {} try { window.dispatchEvent(new Event('fest-me')); } catch (e) {} }
  async function fetchMe() {
    const c = festHttp.config;
    if (!c.apiBase || !c.viewerToken) { festHttp.me = null; try { localStorage.removeItem(ME_KEY); } catch (e) {} applyMe(null); adminUi(); return; }
    try {
      const r = await fetch(c.apiBase + '/api/v1/me', { headers: { Authorization: 'Bearer ' + c.viewerToken }, cache: 'no-store', credentials: 'omit', mode: 'cors', referrerPolicy: 'no-referrer' });
      if (r.status === 200) {
        const b = await r.json(); festHttp.me = b; try { localStorage.setItem(ME_KEY, JSON.stringify(b)); } catch (e) {}
        applyMe(b);
      } else if (r.status === 401) {   // 取り消し・期限切れ・違うキー：記憶した権限と時刻表を消す（画面の制限は「未確認」のまま）
        festHttp.me = { role: 'invalid' }; try { localStorage.removeItem(ME_KEY); localStorage.removeItem('fest_sched_cache'); } catch (e) {}
        applyMe('pending');
      }
    } catch (e) {   // 通信できない：前回の権限のまま
      try { festHttp.me = JSON.parse(localStorage.getItem(ME_KEY) || 'null'); } catch (e2) {}
    }
    adminUi(); ui();
  }
  festHttp.fetchMe = fetchMe;
  festHttp.isFull = () => !!(festHttp.me && festHttp.me.role === 'full');
  function roleText() {
    const m = festHttp.me;
    if (!festHttp.config.viewerToken) return '';
    if (!m) return 'この端末：権限を確認中…';
    if (m.role === 'invalid') return 'この端末の閲覧キーは使えません（取り消し・期限切れ・入力違い）';
    if (m.role === 'full') return 'この端末：本部版（全権限）';
    const p = m.perms || {}, no = [p.settings ? '' : '設定', p.pins ? '' : 'ピンの保存', p.edit ? '' : '時刻表の編集'].filter(Boolean);
    return '配布版「' + (m.label || '') + '」' + (no.length ? '・' + no.join('・') + 'は不可' : '') + (m.expiresAtMs ? '・' + fmtDay(m.expiresAtMs) + 'まで有効' : '');
  }
  function fmtDay(ms) { const d = new Date(ms + 9 * 3600000); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate(); }

  // ---------- 配布版の発行・一覧・取り消し（本部版だけ） ----------
  const QR_LIB = ['https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js', 'sha384-mZT2gIty7ZDdOGkxfP6joZcYdMW1Jvj9dRlfpTmaJAKKXTqzygtB22k7FLe+KZC1'];
  let qrP = null;
  function qrLib() {
    if (window.qrcode) return Promise.resolve();
    if (!qrP) qrP = new Promise((ok, ng) => { const sc = document.createElement('script'); sc.src = QR_LIB[0]; sc.integrity = QR_LIB[1]; sc.crossOrigin = 'anonymous'; sc.onload = () => ok(); sc.onerror = () => { qrP = null; ng(new Error('qr')); }; document.head.appendChild(sc); });
    return qrP;
  }
  async function adminApi(method, path, body) {
    const c = festHttp.config;
    const r = await fetch(c.apiBase + path, { method, cache: 'no-store', credentials: 'omit', mode: 'cors', referrerPolicy: 'no-referrer',
      headers: Object.assign({ Authorization: 'Bearer ' + c.viewerToken }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch (e) {}
    return { status: r.status, body: j };
  }
  function adminUi() {
    let box = $('festAdm');
    const sec = $('festTrkSec');
    if (!festHttp.isFull()) { if (box) box.remove(); return; }
    if (box || !sec) return;
    box = document.createElement('div'); box.id = 'festAdm'; box.className = 'fest-adm';
    box.innerHTML = '<div class="set-label">配布版の発行（本部版だけ）</div>'
      + '<input id="fadLabel" maxlength="40" placeholder="配布先の名前（例：受付係）" autocomplete="off" />'
      + '<div class="fad-cks"><label><input type="checkbox" id="fadNoSet" checked />設定画面を開けない</label><label><input type="checkbox" id="fadNoPins" checked />ピンを保存できない</label><label><input type="checkbox" id="fadNoEdit" checked />時刻表を編集できない</label></div>'
      + '<div class="fad-exp"><span>期限</span><input type="date" id="fadExp" aria-label="期限" /><small>この日の終わりまで有効（空欄＝期限なし）</small></div>'
      + '<button class="set-save" id="fadIssue" type="button">発行する</button><div id="fadOut"></div>'
      + '<div class="set-label">発行した配布版</div><div id="fadList" class="fad-list"></div>';
    sec.appendChild(box);
    $('fadIssue').onclick = issue;
    loadShares();
  }
  async function issue() {
    const out = $('fadOut'), label = $('fadLabel').value.trim(), ex = $('fadExp').value;
    if (!label) { out.innerHTML = '<div class="fad-msg err">配布先の名前を入れてください</div>'; return; }
    let expiresAtMs = null;
    if (ex) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ex); if (m) expiresAtMs = Date.UTC(+m[1], +m[2] - 1, +m[3], 14, 59, 59, 999); }   // 日本時間のその日の終わり
    const perms = { settings: !$('fadNoSet').checked, pins: !$('fadNoPins').checked, edit: !$('fadNoEdit').checked };
    $('fadIssue').disabled = true; out.innerHTML = '<div class="fad-msg">発行しています…</div>';
    try {
      const r = await adminApi('POST', '/api/v1/shares', { label, perms, expiresAtMs });
      if (r.status !== 201 || !r.body || !r.body.token) { out.innerHTML = '<div class="fad-msg err">発行できませんでした（' + escapeHtml(String((r.body && r.body.error) || r.status)) + '）</div>'; return; }
      const url = location.origin + location.pathname + '?m=senshu#key=' + r.body.token;
      let qr = '';
      try { await qrLib(); const q = qrcode(0, 'M'); q.addData(url); q.make(); qr = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (e) { qr = ''; }
      out.innerHTML = '<div class="fad-res"><b>' + escapeHtml(label) + '</b> の配布版' + (qr ? '<div class="fad-qr">' + qr + '</div>' : '')
        + '<div class="share-row"><button class="set-save ghost share-pub" id="fadCopy" type="button">リンクをコピー</button>' + (navigator.share ? '<button class="set-save ghost share-pub" id="fadShare" type="button">共有</button>' : '') + '</div>'
        + '<div class="fad-msg">このリンクとQRコードは配布先にだけ渡してください。開いた端末にキーが記憶されます。この画面を閉じると再表示できません（必要なら取り消して発行し直す）。iPhoneでホーム画面に追加して使う人には、リンクを送ってアプリ内で貼り付けてもらってください。</div></div>';
      $('fadCopy').onclick = async () => { try { await navigator.clipboard.writeText(url); $('fadCopy').textContent = 'コピーしました'; } catch (e) { prompt('配布リンク（配布先にだけ渡す）', url); } };
      const sh = $('fadShare'); if (sh) sh.onclick = async () => { try { await navigator.share({ title: '本祭支援ツール', text: label + ' 用の本祭支援ツール（開くと使えるようになります）', url }); } catch (e) {} };
      $('fadLabel').value = '';
      loadShares();
    } catch (e) { out.innerHTML = '<div class="fad-msg err">発行できませんでした（通信を確認してください）</div>'; }
    finally { $('fadIssue').disabled = false; }
  }
  async function loadShares() {
    const box = $('fadList'); if (!box) return;
    try {
      const r = await adminApi('GET', '/api/v1/shares');
      if (r.status !== 200 || !r.body) { box.innerHTML = '<div class="fad-msg err">一覧を読み込めませんでした</div>'; return; }
      const L = r.body.shares || [];
      box.innerHTML = L.length ? L.map(x => {
        const p = x.perms || {}, no = [p.settings ? '' : '設定', p.pins ? '' : 'ピン', p.edit ? '' : '編集'].filter(Boolean);
        const st = x.revokedAtMs ? '取り消し済み' : (x.active ? '有効' : '期限切れ');
        return '<div class="fad-row' + (x.active ? '' : ' off') + '"><div><b>' + escapeHtml(x.label) + '</b><small>' + (no.length ? no.join('・') + 'は不可' : '制限なし') + '・発行 ' + fmtDay(x.createdAtMs) + (x.expiresAtMs ? '・' + fmtDay(x.expiresAtMs) + 'まで' : '') + '・' + st + '</small></div>'
          + (x.active ? '<button type="button" data-id="' + escapeHtml(x.id) + '">取り消す</button>' : '') + '</div>';
      }).join('') : '<div class="fad-msg">まだ発行していません</div>';
      box.querySelectorAll('button[data-id]').forEach(b => b.onclick = async () => {
        const row = L.find(x => x.id === b.dataset.id);
        if (!confirm('「' + (row ? row.label : '') + '」の配布版を取り消します。配布先では車両の位置・時刻表が見られなくなります（30秒ほどで反映）。')) return;
        b.disabled = true; const d = await adminApi('DELETE', '/api/v1/shares/' + b.dataset.id); if (d.status !== 200) alert('取り消せませんでした（' + d.status + '）'); loadShares();
      });
    } catch (e) { box.innerHTML = '<div class="fad-msg err">一覧を読み込めませんでした（通信を確認してください）</div>'; }
  }

  function onStartClick() {
    const raw = $('festTrkTok').value.trim(), tok = extractKey(raw);
    if (!tok && !(raw === '' && festHttp.config.viewerToken)) { $('festTrkMsg').textContent = '閲覧キー（43文字）か、配布されたリンクを貼り付けてください'; return; }
    if (tok) festHttp.config.viewerToken = tok;
    $('festTrkTok').value = '';
    start();
    try { window.dispatchEvent(new Event('fest-token')); } catch (e) {}   // 時刻表も同じキーで読み直す
    fetchMe();
  }
  async function pasteKey() {   // ホーム画面のアプリ（iPhone は Safari と保存場所が別）向け：コピーした配布リンクを読み込む
    try { const t = await navigator.clipboard.readText(); const k = extractKey(t); if (!k) { $('festTrkMsg').textContent = 'クリップボードに配布リンク（または閲覧キー）がありません'; return; } $('festTrkTok').value = k; onStartClick(); }
    catch (e) { $('festTrkMsg').textContent = '貼り付けを読めませんでした。入力欄に長押しで貼り付けてください'; }
  }

  festHttp.init = function () {
    if (festHttp.initialized || typeof FEST === 'undefined' || !FEST) return;
    festHttp.initialized = true;
    cfgLoad();
    const sb = $('festTrkStart'); if (sb) sb.onclick = onStartClick;
    const xb = $('festTrkStop'); if (xb) xb.onclick = stop;
    const tk = $('festTrkTok'); if (tk) { tk.placeholder = '閲覧キー、または配布されたリンク'; tk.addEventListener('keydown', e => { if (e.key === 'Enter') onStartClick(); }); }
    const pb = $('festTrkPaste'); if (pb) { pb.onclick = pasteKey; pb.style.display = (navigator.clipboard && navigator.clipboard.readText) ? '' : 'none'; }
    try { festHttp.me = JSON.parse(localStorage.getItem(ME_KEY) || 'null'); } catch (e) {}
    const cf = $('festTrkCfg'); if (cf && (!festHttp.enabled || !festHttp.config.viewerToken)) cf.open = true;
    // 画面が裏に回ったら取得を休み、戻ったらすぐ取る
    document.addEventListener('visibilitychange', () => {
      if (!festHttp.enabled) return;
      if (document.visibilityState === 'hidden') { festHttp.paused = true; cancel(); }
      else { festHttp.paused = false; fetchNow(); }
    });
    window.addEventListener('pagehide', () => { if (festHttp.enabled) { festHttp.paused = true; cancel(); } });
    window.addEventListener('pageshow', e => { if (festHttp.enabled && e.persisted) { festHttp.paused = false; fetchNow(); } });
    window.addEventListener('online', () => { if (festHttp.enabled && !festHttp.abortController) { festHttp.fails = 0; fetchNow(); } });
    if (festHttp.enabled) start(); else ui();
    if (festHttp.fromLink) try { window.dispatchEvent(new Event('fest-token')); } catch (e) {}
    fetchMe();
  };
})();
