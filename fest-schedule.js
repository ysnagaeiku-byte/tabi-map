// たびマップ 本祭支援ツール：本部の時刻表（各号館の開錠・施錠時刻、エレベーターの使用可否）
// index-google.html?m=senshu のときだけ fest-vehicle-tracking.js の後に読み込む。
// 値は受信API（/api/v1/schedule）に置き、閲覧キーを持つ本部の端末だけが読み書きする（地図は公開のため、時刻はコードに書かない）。
//  - 画面最上部の黒い帯：その日の開錠・施錠時刻を数秒ごとに流す（その日の情報がなければ全日程を順に）
//  - 時計の右側：9号館・10号館のエレベーター（9-EV・10-EV）の使用可否 ○／×／ー
//  - 時計（または帯）を押すと編集画面
(function () {
  'use strict';
  if (window.festSched) return;

  const FAC = [['b1', '1号館'], ['b2', '2号館'], ['b4', '4号館'], ['b5', '5号館'], ['b7', '7号館'], ['b10', '10号館'], ['gym1', '第一体育館'], ['ikuta', '生田会館']];
  const FAC_NOTE = { b4: '420教室', b10: '10101教室' };   // 開錠・施錠の基準
  const EVU = [['9', '9-EV', '9号館'], ['10', '10-EV', '10号館']];
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const HOLD_MS = 7500, SLIDE_MS = 600, POLL_MS = 60000;   // 1ページを7.5秒表示してから流す

  const S = window.festSched = { data: null, updatedAtMs: null, error: '', loading: false, timer: null, draft: null, tab: 0, initialized: false };
  const $ = id => document.getElementById(id);
  const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(String(s)) : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]));

  // ---------- 時刻（時計と同じくNTPで補正した日本時間） ----------
  const nowMs = () => (typeof window.festClockNow === 'function' ? window.festClockNow() : Date.now());
  function jst() { const d = new Date(nowMs() + 9 * 3600000); return { ymd: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() }; }
  const toMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; };
  function dayLabel(ymd, withMonth) { const [y, m, d] = ymd.split('-').map(Number), w = WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; return (withMonth ? m + '/' : '') + d + '(' + w + ')'; }
  const facName = f => (FAC.find(x => x[0] === f) || [f, f])[1];

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
      if (r.status === 200 && r.body && r.body.schemaVersion === 1) { S.data = r.body.schedule; S.updatedAtMs = r.body.updatedAtMs; S.error = ''; }
      else S.error = r.status === 401 ? 'auth' : 'http';
    } catch (e) { S.error = 'network'; }
    S.loading = false;
    render();
    S.timer = setTimeout(load, POLL_MS);
  }
  S.reload = load;

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
  function renderEv() {
    const box = $('lcEv'); if (!box) return;
    const h = EVU.map(([u, lab]) => { const st = evState(u); return '<div class="lc-ev-u" title="' + lab + '：' + EV_TXT[st] + '"><span>' + lab + '</span><b class="ev-' + st + '">' + EV_SYM[st] + '</b></div>'; }).join('');
    if (box.__h !== h) { box.__h = h; box.innerHTML = h; }
  }

  // ---------- 最上部の帯（開錠・施錠時刻） ----------
  const B = { pages: [], i: 0, key: '', tm: null, cur: 0, busy: false };
  function bandDays() {
    const days = (S.data && Array.isArray(S.data.days)) ? S.data.days.filter(d => d.items && d.items.length) : [];
    const today = jst().ymd, td = days.find(d => d.d === today);
    return td ? [td] : days;   // その日の情報があればその日だけ、なければ全日程を順に
  }
  function itemText(it) { const o = it.o || '', c = it.c || ''; return o && c ? o + '-' + c : (o ? o + '〜' : '〜' + c); }
  function measure(html) { const m = $('fbMeasure'); m.innerHTML = html; return m.offsetWidth; }
  function buildPages() {
    const view = $('festBand') && $('festBand').querySelector('.fb-view'); if (!view) return [];
    const W = view.clientWidth - 4;
    if (!hasKey()) return ['<span class="fb-dim">開錠・施錠時刻：閲覧キーを入れると表示（時計を押して設定）</span>'];
    if (S.error === 'auth') return ['<span class="fb-dim">開錠・施錠時刻：閲覧キーが違います（時計を押して入れ直す）</span>'];
    const days = bandDays();
    if (!days.length) return ['<span class="fb-dim">' + (S.data ? '開錠・施錠時刻：未登録（時計を押して編集）' : '開錠・施錠時刻を読み込み中…') + '</span>'];
    const pages = [];
    days.forEach(d => {
      const lab = '<span class="fb-day">【' + dayLabel(d.d) + '】</span>', lw = measure(lab);
      const H = d.items.map(it => '<span class="fb-it">' + esc(facName(it.f)) + ' <b>' + esc(itemText(it)) + '</b></span>'), IW = H.map(measure);
      const greedy = []; let cur = [], w = lw;   // まず入るだけ詰めてページ数を決める
      H.forEach((h, i) => { if (cur.length && w + IW[i] > W) { greedy.push(cur); cur = []; w = lw; } cur.push(i); w += IW[i]; });
      if (cur.length) greedy.push(cur);
      const k = greedy.length, per = Math.ceil(H.length / k), even = [];   // 同じページ数で件数をそろえる（7件＋1件 → 4件＋4件）
      for (let i = 0; i < H.length; i += per) even.push(H.map((_, j) => j).slice(i, i + per));
      const fits = even.length === k && even.every(g => lw + g.reduce((t, j) => t + IW[j], 0) <= W);
      (fits ? even : greedy).forEach(g => pages.push(lab + g.map(j => H[j]).join('')));
    });
    return pages;
  }
  function bandShow(reset) {
    const band = $('festBand'); if (!band) return;
    const pages = buildPages(), key = pages.join('|');
    if (!reset && key === B.key) return;
    B.key = key; B.pages = pages; B.i = 0; clearTimeout(B.tm);
    const P = band.querySelectorAll('.fb-page');
    P.forEach(p => { p.style.transition = 'none'; p.style.transform = 'translateX(110%)'; });
    B.cur = 0; P[0].innerHTML = pages[0] || ''; P[0].style.transform = 'translateX(0)';
    if (pages.length > 1) B.tm = setTimeout(bandNext, HOLD_MS);
  }
  function bandNext() {
    const band = $('festBand'); if (!band || B.pages.length < 2) return;
    if (document.visibilityState === 'hidden') { B.tm = setTimeout(bandNext, HOLD_MS); return; }
    const P = band.querySelectorAll('.fb-page'), a = P[B.cur], b = P[1 - B.cur];
    B.i = (B.i + 1) % B.pages.length;
    b.style.transition = 'none'; b.style.transform = 'translateX(105%)'; b.innerHTML = B.pages[B.i];
    void b.offsetWidth;   // 位置を確定させてから流す
    a.style.transition = b.style.transition = 'transform ' + SLIDE_MS + 'ms ease';
    a.style.transform = 'translateX(-105%)'; b.style.transform = 'translateX(0)';
    B.cur = 1 - B.cur;
    B.tm = setTimeout(bandNext, HOLD_MS + SLIDE_MS);
  }

  function render() { renderEv(); bandShow(false); if ($('festSchedOverlay') && $('festSchedOverlay').classList.contains('open') && !S.draft) editorRender(); }
  S.render = render;

  // ---------- 編集画面 ----------
  function emptySchedule() { return { v: 1, days: [], ev: { '9': { mode: 'auto', days: {} }, '10': { mode: 'auto', days: {} } } }; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function draftDays() { return S.draft.days.map(d => d.d).concat(Object.keys(S.draft.ev['9'].days), Object.keys(S.draft.ev['10'].days)).filter((x, i, a) => a.indexOf(x) === i).sort(); }
  function msg(t, err) { const m = $('fsMsg'); if (m) { m.textContent = t || ''; m.classList.toggle('err', !!err); } }
  function slotsText(sl) { return (sl || []).map(s => s.from + '-' + s.to).join(', '); }
  function parseSlots(t) {
    const out = []; const parts = String(t || '').split(/[,、，\s]+/).filter(Boolean);
    for (const p of parts) { const m = /^(\d{1,2}:\d{2})[-〜~ー–](\d{1,2}:\d{2})$/.exec(p); if (!m || toMin(m[1]) == null || toMin(m[2]) == null || toMin(m[1]) >= toMin(m[2])) return null; out.push({ from: m[1], to: m[2] }); }
    return out;
  }
  function editorOpen() {
    const ov = $('festSchedOverlay'); if (!ov) return;
    S.draft = null; ov.classList.add('open'); editorRender();
    if (hasKey()) load();
  }
  S.open = editorOpen;
  function editorRender() {
    const body = $('festSchedBody'); if (!body) return;
    if (!hasKey() || S.error === 'auth') {
      body.innerHTML = '<div class="set-help">開錠・施錠時刻とEVの可否は、閲覧キーを持つ本部の端末だけに表示します。' + (S.error === 'auth' ? '<b>閲覧キーが違います。</b>' : '') + '</div>'
        + '<input id="fsKey" type="password" placeholder="本部が配布した閲覧キー" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="閲覧キー" />'
        + '<button class="set-save" id="fsKeySave" type="button">閲覧キーを使う</button><div class="set-msg" id="fsMsg"></div>';
      $('fsKeySave').onclick = () => { const v = $('fsKey').value.trim(); if (!window.festHttp || !festHttp.setToken(v)) { msg('閲覧キーの形が違います（43文字）', true); return; } S.error = ''; load(); editorRender(); };
      return;
    }
    if (!S.draft) S.draft = clone(S.data || emptySchedule());
    const D = S.draft, days = draftDays();
    if (S.tab >= D.days.length) S.tab = Math.max(0, D.days.length - 1);
    let h = '<div class="fs-sec"><div class="set-label">エレベーター（EV）</div>';
    EVU.forEach(([u, lab, bld]) => {
      const e = D.ev[u];
      h += '<div class="fs-ev"><div class="fs-ev-h"><b>' + lab + '</b><span>' + bld + '</span><div class="seg fs-mode" data-u="' + u + '">'
        + [['auto', '自動'], ['ok', '○'], ['ng', '×'], ['none', 'ー']].map(([m, t]) => '<button type="button" data-m="' + m + '" class="' + (e.mode === m ? 'on' : '') + '">' + t + '</button>').join('') + '</div></div>';
      if (e.mode === 'auto') {
        h += days.length ? days.map(d => { const has = Object.prototype.hasOwnProperty.call(e.days, d);
          return '<label class="fs-evd"><span>' + dayLabel(d, true) + '</span><input type="text" data-u="' + u + '" data-d="' + d + '" value="' + esc(has ? slotsText(e.days[d]) : '') + '" placeholder="' + (has ? 'なし（終日使用可）' : 'データなし') + '" inputmode="numeric" /><span class="fs-chk"><input type="checkbox" data-u="' + u + '" data-d="' + d + '"' + (has ? ' checked' : '') + ' />設定済み</span></label>'; }).join('')
          : '<div class="set-help">日付がありません（下の「開錠・施錠」で日を追加してください）</div>';
      }
      h += '</div>';
    });
    h += '<div class="set-help">使用不可の時間帯を「10:00-11:30, 14:00-15:00」の形で入力。「設定済み」の日は、時間帯の外が○、内が×になります。設定していない日はー（データなし）。</div></div>';
    h += '<div class="fs-sec"><div class="set-label">各号館の開錠・施錠</div><div class="fs-tabs">'
      + D.days.map((d, i) => '<button type="button" data-i="' + i + '" class="' + (i === S.tab ? 'on' : '') + '">' + dayLabel(d.d, true) + '</button>').join('')
      + '<span class="fs-add"><input type="date" id="fsNewDay" aria-label="追加する日" /><button type="button" id="fsAddDay">日を追加</button></span></div>';
    const day = D.days[S.tab];
    if (day) {
      h += '<div class="fs-grid"><span></span><span>開錠</span><span>施錠</span>' + FAC.map(([f, n]) => { const it = day.items.find(x => x.f === f) || { o: '', c: '' };
        const pad = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? m[1].padStart(2, '0') + ':' + m[2] : ''; };
        return '<span class="fs-fac">' + n + (FAC_NOTE[f] ? '<small>' + FAC_NOTE[f] + '</small>' : '') + '</span><input type="time" data-f="' + f + '" data-k="o" value="' + pad(it.o) + '" /><input type="time" data-f="' + f + '" data-k="c" value="' + pad(it.c) + '" />'; }).join('')
        + '</div><button type="button" class="set-save ghost fs-del" id="fsDelDay">この日（' + dayLabel(day.d, true) + '）を削除</button>';
    } else h += '<div class="set-help">日がありません。「日を追加」で作成してください。</div>';
    h += '</div><div class="share-row"><button class="set-save" id="fsSave" type="button">保存</button><button class="set-save ghost" id="fsReset" type="button">変更を取り消す</button></div>'
      + '<div class="set-msg" id="fsMsg">' + (S.updatedAtMs ? '最終更新 ' + new Date(S.updatedAtMs + 9 * 3600000).toISOString().slice(5, 16).replace('T', ' ').replace('-', '/') : '') + '</div>';
    body.innerHTML = h;
    // 入力 → 下書き
    body.querySelectorAll('.fs-mode').forEach(sg => sg.onclick = ev => { const b = ev.target.closest('button'); if (!b) return; D.ev[sg.dataset.u].mode = b.dataset.m; editorRender(); });
    body.querySelectorAll('.fs-evd input[type=text]').forEach(inp => inp.onchange = () => {
      const u = inp.dataset.u, d = inp.dataset.d, sl = parseSlots(inp.value);
      if (sl === null) { msg('時間帯の形が違います（例 10:00-11:30, 14:00-15:00）', true); inp.focus(); return; }
      D.ev[u].days[d] = sl; editorRender(); });
    body.querySelectorAll('.fs-evd input[type=checkbox]').forEach(cb => cb.onchange = () => { const u = cb.dataset.u, d = cb.dataset.d; if (cb.checked) D.ev[u].days[d] = D.ev[u].days[d] || []; else delete D.ev[u].days[d]; editorRender(); });
    body.querySelectorAll('.fs-tabs button[data-i]').forEach(b => b.onclick = () => { S.tab = +b.dataset.i; editorRender(); });
    $('fsAddDay').onclick = () => { const v = $('fsNewDay').value; if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { msg('追加する日を選んでください', true); return; } if (D.days.some(d => d.d === v)) { msg('その日はすでにあります', true); return; }
      D.days.push({ d: v, items: [] }); D.days.sort((a, b) => a.d < b.d ? -1 : 1); S.tab = D.days.findIndex(d => d.d === v); editorRender(); };
    const del = $('fsDelDay'); if (del) del.onclick = () => { if (!confirm(dayLabel(day.d, true) + ' の開錠・施錠時刻を削除します')) return; D.days.splice(S.tab, 1); S.tab = 0; editorRender(); };
    body.querySelectorAll('.fs-grid input[type=time]').forEach(inp => inp.onchange = () => {
      const f = inp.dataset.f, k = inp.dataset.k, v = inp.value ? inp.value.replace(/^0(\d)/, '$1') : '';
      let it = day.items.find(x => x.f === f); if (!it) { it = { f, o: '', c: '' }; day.items.push(it); }
      it[k] = v; day.items = day.items.filter(x => x.o || x.c).sort((a, b) => FAC.findIndex(x => x[0] === a.f) - FAC.findIndex(x => x[0] === b.f)); });
    $('fsReset').onclick = () => { S.draft = null; editorRender(); };
    $('fsSave').onclick = save;
  }
  async function save() {
    const btn = $('fsSave'); if (btn) btn.disabled = true; msg('保存しています…');
    try {
      const r = await api('PUT', { schedule: S.draft, baseUpdatedAtMs: S.updatedAtMs });
      if (r.status === 200 && r.body) { S.data = r.body.schedule; S.updatedAtMs = r.body.updatedAtMs; S.draft = null; S.error = ''; render(); editorRender(); msg('保存しました'); return; }
      if (r.status === 409) { msg('ほかの端末が先に保存しました。「変更を取り消す」で最新を読み込み直してから編集してください', true); S.updatedAtMs = null; await load(); }
      else if (r.status === 401) { S.error = 'auth'; editorRender(); }
      else msg('保存できませんでした（' + ((r.body && (r.body.detail || r.body.error)) || r.status) + '）', true);
    } catch (e) { msg('保存できませんでした（通信を確認してください）', true); }
    if (btn) btn.disabled = false;
  }

  // ---------- 時計の幅（地図の切り替えの行にそろえる） ----------
  function fitClock() {
    const c = $('liveClock'), seg = $('festBaseBar') && $('festBaseBar').querySelector('.seg');
    if (!c) return;
    if (innerWidth <= 600 || !seg || !seg.offsetWidth) { c.style.width = ''; return; }
    c.style.width = Math.round(seg.getBoundingClientRect().width) + 'px';
  }

  S.init = function () {
    if (S.initialized || typeof FEST === 'undefined' || !FEST) return;
    S.initialized = true;
    const ov = $('festSchedOverlay');
    if (ov) { $('festSchedClose').onclick = () => { ov.classList.remove('open'); S.draft = null; }; ov.addEventListener('click', e => { if (e.target === ov) { ov.classList.remove('open'); S.draft = null; } }); }
    const clk = $('liveClock'); if (clk) { clk.addEventListener('click', editorOpen); clk.title = '現在時刻（NTP同期・JST）・EVの可否／押すと開錠・施錠時刻とEVを編集'; }
    const band = $('festBand'); if (band) band.addEventListener('click', editorOpen);
    window.addEventListener('fest-token', () => { S.error = ''; load(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
    let rt = null; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { fitClock(); bandShow(true); }, 200); });
    let lastDay = jst().ymd;
    setInterval(() => { renderEv(); const d = jst().ymd; if (d !== lastDay) { lastDay = d; bandShow(true); } }, 15000);   // EVは分単位・日付が変われば帯を作り直す
    fitClock(); setTimeout(fitClock, 800);
    render(); load();
  };
})();
