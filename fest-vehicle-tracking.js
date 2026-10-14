// たびマップ 本祭支援ツール：車両の位置（Traccar Client → 受信API → この地図）
// index-google.html?m=senshu のときだけ読み込む（通常版・研究版では読み込まず、通信もしない）。
// 3台の最新位置を受信APIから10秒ごとに取り、既存の「位置の共有」の印（festSh.peers・festShRender）で
// 標準・白地図・高低差3D・実写3Dのどれにも描く。旧方式（合言葉のMQTT・OwnTracks）とは状態を分け、
// こちらを使っている間は旧方式の自動接続と設定画面を止める。
// 公開してよいのは受信APIのURLだけ。閲覧キーは実行時に入力し、このタブ（sessionStorage）だけに保存する。
(function () {
  'use strict';
  if (window.festHttp) return;

  const API_DEFAULT = '';   // 受信APIを配置したら、その URL（https://…workers.dev）をここに入れる
  const CFG_KEY = 'fest_track_cfg', TOK_KEY = 'fest_track_view';
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
  };

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
    try { tok = sessionStorage.getItem(TOK_KEY) || ''; } catch (e) {}
    festHttp.config.apiBase = normBase(c && c.apiBase) || API_DEFAULT;
    festHttp.config.viewerToken = TOKEN_RE.test(tok) ? tok : '';
    festHttp.enabled = !!(c && c.on);
  }
  function cfgSave() {
    try { localStorage.setItem(CFG_KEY, JSON.stringify({ apiBase: festHttp.config.apiBase, on: festHttp.enabled })); } catch (e) {}
    try {
      if (festHttp.config.viewerToken) sessionStorage.setItem(TOK_KEY, festHttp.config.viewerToken);
      else sessionStorage.removeItem(TOK_KEY);
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
    if (!h.enabled) return '停止中・「接続の設定」から開始';
    if (!c.apiBase) return '受信APIのURLを入力してください';
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
    const leg = $('festShLegacy'); if (leg) leg.style.display = festHttp.enabled ? 'none' : '';
    const st = $('festTrkStop'); if (st) st.disabled = !festHttp.enabled;
    const cf = $('festTrkCfg'); if (cf && festHttp.enabled && (festHttp.authBlocked || !festHttp.config.viewerToken || !festHttp.config.apiBase)) cf.open = true;   // 入力が要るときは設定を開く
    if (msg) { msg.textContent = recvText(); msg.classList.toggle('err', !!(festHttp.enabled && (festHttp.lastError || festHttp.authBlocked))); }
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
    try { festShDisconnect(); } catch (e) {}   // 旧方式（合言葉のMQTT）は止める。保存した設定（tabi_share）は消さない
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
    try { if (festSh.cfg && !festSh.key) festShConnect(); } catch (e) {}   // 旧方式の設定があれば元どおり接続
    ui();
  }
  festHttp.start = start; festHttp.stop = stop;

  function onStartClick() {
    const base = normBase($('festTrkApi').value), tok = $('festTrkTok').value.trim();
    if (!base) { $('festTrkMsg').textContent = '受信APIのURLは https:// から始まる形で入力してください'; return; }
    if (!TOKEN_RE.test(tok) && !(tok === '' && festHttp.config.viewerToken)) { $('festTrkMsg').textContent = '閲覧キーの形が違います（43文字）'; return; }
    if (base !== festHttp.config.apiBase) festHttp.vehicles = {};
    festHttp.config.apiBase = base;
    if (tok) festHttp.config.viewerToken = tok;
    $('festTrkTok').value = '';
    start();
  }

  festHttp.init = function () {
    if (festHttp.initialized || typeof FEST === 'undefined' || !FEST) return;
    festHttp.initialized = true;
    cfgLoad();
    const api = $('festTrkApi'); if (api) api.value = festHttp.config.apiBase;
    const sb = $('festTrkStart'); if (sb) sb.onclick = onStartClick;
    const xb = $('festTrkStop'); if (xb) xb.onclick = stop;
    const tk = $('festTrkTok'); if (tk) tk.addEventListener('keydown', e => { if (e.key === 'Enter') onStartClick(); });
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
  };
})();
