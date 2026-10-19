// たびマップ：緊急地震速報（高度利用者向け＝予報・警報）・地震情報（震度）・津波を、ページを開いたまま即時に受け取る。
//   緊急地震速報 … Wolfx Open API（気象庁の発表の中継。wss://ws-api.wolfx.jp/jma_eew）。予備に P2P地震情報 の警報（556）
//   地震情報・津波 … P2P地震情報（wss://api.p2pquake.net/v2/ws。551＝地震情報、552＝津波予報）。
//     即時の接続は同じIPアドレスから2本までなので（本部のWi-Fiなど）、つながらない端末は20秒ごとに取り寄せる（/history は1分60回まで）
// ・ドライブ版：緊急地震速報はすべて画面の最上部の黒帯に流す（受けたときだけ黒帯を出す）。
//   地震情報は最大震度4以上のとき都道府県をぬり分け、緊急地震速報に続く地震情報だけ黒帯にも流す（速報がなければぬり分けだけ）。
// ・本祭支援ツール：予測の地域に神奈川県を含む緊急地震速報（震源が神奈川県のものも）を、時刻表の黒帯に割り込ませて流す。
//   地震情報は神奈川県で震度3以上のとき、ぬり分けて黒帯にも流す（神奈川県を含む速報に続く地震情報は、震度にかかわらず黒帯に流す）。
// 緊急地震速報は、その地震の震度の情報が届くまで流し続ける。震度の情報は、最大震度4までは3分、5弱・5強は10分、6弱以上は1時間出す。
// 津波注意報・津波警報・大津波警報が出ているあいだは、黒帯の2行目に並べて流す。どれも参考（気象庁・自治体の発表に従う）。
(function () {
  'use strict';
  if (window.quakeLive) return;

  const FM = typeof FEST !== 'undefined' && !!FEST;
  const WOLFX_WS = 'wss://ws-api.wolfx.jp/jma_eew', WOLFX_HTTP = 'https://api.wolfx.jp/jma_eew.json';
  const P2P_WS = 'wss://api.p2pquake.net/v2/ws', P2P_API = 'https://api.p2pquake.net/v2';
  const LOCAL = /神奈川/, LOCAL_PREF = '神奈川県';
  const EEW_WAIT_MS = 10 * 60000;    // 震度の情報が届かないとき（震度1以上を観測しなかった等）は、最後の速報から10分で消す
  const EEW_STALE_MS = 3 * 60000;    // 開いた直後・つなぎ直した直後に届く「最新の1件」が、これより前の発表なら流さない
  const CANCEL_SHOW_MS = 30000;      // 取り消しのお知らせを出す時間
  const LINK_MS = 150000;            // 速報と地震情報を同じ地震とみなす発生時刻の差
  const FETCH = { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' };
  // 震度（P2P地震情報の数値）→ 表記・気象庁の配色
  const LAB = { 10: '1', 20: '2', 30: '3', 40: '4', 45: '5弱', 50: '5強', 55: '6弱', 60: '6強', 70: '7' };
  const COL = { 10: '#f2f2ff', 20: '#00aaff', 30: '#0041ff', 40: '#fae696', 45: '#ffe600', 50: '#ff9900', 55: '#ff2800', 60: '#a50021', 70: '#b40068' };
  const FG = { 10: '#212529', 20: '#000', 30: '#fff', 40: '#212529', 45: '#212529', 50: '#000', 55: '#fff', 60: '#fff', 70: '#fff' };
  const holdMs = sc => sc >= 55 ? 3600000 : sc >= 45 ? 600000 : 180000;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const now = () => (window.festClockNow ? festClockNow() : Date.now());
  const num = v => (typeof v === 'number' && isFinite(v)) ? v : (v != null && v !== '' && isFinite(+v) ? +v : null);
  /** 「2026/10/19 08:20:00」（日本時間）→ ミリ秒 */
  function jstMs(t) {
    const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2}) (\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(t || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5], +(m[6] || 0)) : NaN;
  }
  function clock(ms, sec) {
    if (!isFinite(ms)) return '';
    const d = new Date(ms + 9 * 3600000), z = n => String(n).padStart(2, '0');
    return z(d.getUTCHours()) + ':' + z(d.getUTCMinutes()) + (sec ? ':' + z(d.getUTCSeconds()) : '');
  }
  /** 震度の文字（"5-"・"5弱"・"５強" など）→ 数値 */
  function scOf(x) {
    const s = String(x == null ? '' : x).replace(/[１-７]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    const m = /^([1-7])\s*([+\-]|弱|強)?/.exec(s); if (!m) return 0;
    const n = +m[1], h = m[2] === '+' || m[2] === '強';
    if (n === 5) return h ? 50 : 45; if (n === 6) return h ? 60 : 55;
    return n * 10;
  }
  const range = (lo, hi) => hi && lo && hi !== lo ? LAB[lo] + '〜' + LAB[hi] : (hi || lo) ? LAB[hi || lo] + (hi ? '' : '以上') : '';

  // ---------- 受け取った内容をそろえる ----------
  function fromWolfx(d) {
    if (!d || (d.type && d.type !== 'jma_eew')) return null;
    const status = d.Issue && d.Issue.Status;
    const areas = (Array.isArray(d.WarnArea) ? d.WarnArea : []).map(a => ({
      name: String(a.Chiiki || ''), hi: scOf(a.Shindo1), lo: scOf(a.Shindo2), warn: a.Type === 'Warning' || a.Type === '警報',
      time: String(a.Time || '').replace(/^.* /, '').slice(0, 8), arr: a.Arrive === true,
    })).filter(a => a.name);
    return {
      id: String(d.EventID || ''), serial: num(d.Serial) || 0, warn: !!d.isWarn, final: !!d.isFinal, cancel: !!d.isCancel,
      training: !!d.isTraining || (!!status && status !== '通常'), assume: !!d.isAssumption,
      hypo: String(d.Hypocenter || ''), mag: num(d.Magnitude != null ? d.Magnitude : d.Magunitude), depth: num(d.Depth),
      max: scOf(d.MaxIntensity), origin: jstMs(d.OriginTime), ann: jstMs(d.AnnouncedTime), areas, src: 'w',
    };
  }
  function fromP2p(d) {   // 556：緊急地震速報（警報）
    const e = d.earthquake || {}, h = e.hypocenter || {}, is = d.issue || {};
    const areas = (Array.isArray(d.areas) ? d.areas : []).map(a => ({
      name: String(a.name || ''), pref: String(a.pref || ''), hi: a.scaleTo > 0 && a.scaleTo !== 99 ? a.scaleTo : 0, lo: a.scaleFrom > 0 ? a.scaleFrom : 0,
      warn: true, time: a.arrivalTime ? clock(jstMs(a.arrivalTime), true) : '', arr: a.kindCode === '11',
    })).filter(a => a.name);
    return {
      id: String(is.eventId || ''), serial: num(is.serial) || 0, warn: true, final: false, cancel: !!d.cancelled, training: !!d.test,
      assume: e.condition === '仮定震源要素', hypo: String(h.name || ''), mag: num(h.magnitude) > 0 ? num(h.magnitude) : null,
      depth: num(h.depth) >= 0 ? num(h.depth) : null, max: Math.max(0, ...areas.map(a => Math.max(a.hi, a.lo))),
      origin: jstMs(e.originTime), ann: jstMs(is.time), areas, src: 'p',
    };
  }

  // ---------- 状態 ----------
  //  eew：流している緊急地震速報（1件）、cancel：取り消しのお知らせ、evs：表示中の地震情報（地震ごと）、
  //  past：終わった速報（地震情報と結びつけるため1時間だけ覚える）、tsu：発表中の津波予報、done：震度の情報まで済んだ速報のID
  const st = { eew: null, cancel: null, evs: [], past: [], tsu: null, done: new Set(), ids: [] };
  const relevant = e => !FM || LOCAL.test(e.hypo) || e.areas.some(a => LOCAL.test(a.name) || LOCAL.test(a.pref || ''));

  function onEew(e) {
    if (!e || !e.id || e.training) return;
    const cur = st.eew, t = now();
    if (cur && cur.id === e.id) {
      if (e.serial < cur.serial || (e.serial === cur.serial && !(e.src === 'w' && cur.src === 'p') && !(e.cancel && !cur.cancel))) return;   // 古い報・同じ報（警報は2か所から届く）
    } else {
      if (st.done.has(e.id) || st.past.some(p => p.id === e.id)) return;
      if (t - (isFinite(e.ann) ? e.ann : 0) > EEW_STALE_MS) {   // 前に出た速報：表示はしないが、地震情報と結びつけるために覚える
        if (!e.cancel && isFinite(e.origin) && t - e.origin < 3600000) st.past.push({ id: e.id, origin: e.origin, shown: relevant(e) });
        return;
      }
    }
    if (e.cancel) {
      if (cur && cur.id === e.id && cur.shown) st.cancel = { e: cur, until: t + CANCEL_SHOW_MS };
      if (cur && cur.id === e.id) st.eew = null;
      st.done.add(e.id); render(); return;
    }
    if (cur && cur.id !== e.id) st.past.push({ id: cur.id, origin: cur.origin, shown: cur.shown });   // 別の地震の速報に切り替わった
    st.eew = Object.assign({}, e, { shown: relevant(e) || !!(cur && cur.id === e.id && cur.shown), last: t });
    st.cancel = null;
    render();
  }

  function onQuake(d, rcv) {
    const is = d.issue || {}, q = d.earthquake || {}, h = q.hypocenter || {};
    if (!/^(ScalePrompt|Destination|ScaleAndDestination|DetailScale)$/.test(is.type || '')) return;   // 国外の地震などは扱わない
    const origin = jstMs(q.time); if (!isFinite(origin)) return;
    const pref = {};
    (Array.isArray(d.points) ? d.points : []).forEach(p => { if (p && p.pref && p.scale >= 10 && p.scale <= 70) pref[p.pref] = Math.max(pref[p.pref] || 0, p.scale); });
    const hn = String(h.name || '');
    let ev = st.evs.find(x => Math.abs(x.origin - origin) <= LINK_MS && (!x.hypo || !hn || x.hypo === hn));
    if (!ev) { ev = { origin, hypo: '', mag: null, depth: null, max: 0, pref: {}, type: '', tsu: '', rcv: 0, link: false }; st.evs.push(ev); }
    ev.type = is.type; ev.rcv = Math.max(ev.rcv, rcv);
    if (hn) { ev.hypo = hn; ev.mag = num(h.magnitude) > 0 ? num(h.magnitude) : null; ev.depth = num(h.depth) >= 0 ? num(h.depth) : null; }
    if (Object.keys(pref).length) {
      if (is.type === 'DetailScale') ev.pref = pref;   // 各地の震度：まとめて置き換える
      else Object.keys(pref).forEach(k => { ev.pref[k] = Math.max(ev.pref[k] || 0, pref[k]); });
    }
    ev.max = Math.max(ev.max, num(q.maxScale) > 0 ? num(q.maxScale) : 0, 0, ...Object.values(ev.pref));
    if (q.domesticTsunami && q.domesticTsunami !== 'Unknown') ev.tsu = q.domesticTsunami;
    // 同じ地震の緊急地震速報があれば、ここで速報を終えて地震情報に切り替える
    const e = st.eew;
    if (e && isFinite(e.origin) && Math.abs(e.origin - origin) <= LINK_MS) { if (e.shown) ev.link = true; st.done.add(e.id); st.eew = null; }
    if (st.past.some(p => p.shown && Math.abs(p.origin - origin) <= LINK_MS)) ev.link = true;
    ev.until = ev.rcv + holdMs(ev.max);
    render();
  }

  function onTsunami(d) {
    if (!d || d.cancelled) { st.tsu = null; render(); return; }
    const G = { MajorWarning: 3, Warning: 2, Watch: 1 };
    const areas = (Array.isArray(d.areas) ? d.areas : []).map(a => ({ name: String(a.name || ''), g: G[a.grade] || 0, h: String(((a.maxHeight || {}).description) || '') })).filter(a => a.g && a.name);
    st.tsu = areas.length ? { areas } : null;
    render();
  }

  /** P2P地震情報の発表を1件受ける（rcv：受けた時刻。履歴から取り寄せたものは、その発表を受けた時刻から表示の時間を数える） */
  function onP2p(d, rcv) {
    if (!d || !d.code) return;
    const id = d.id || d._id;
    if (id) { if (st.ids.includes(id)) return; st.ids.push(id); if (st.ids.length > 300) st.ids.splice(0, 100); }   // 同じ発表が2回届くことがある
    const qOn = typeof quakeOn !== 'undefined' && quakeOn, tOn = typeof tsunamiOn !== 'undefined' && tsunamiOn;
    if (d.code === 551 && qOn) onQuake(d, rcv || now());
    else if (d.code === 552) {
      if (qOn) onTsunami(d);
      if (tOn && typeof disasterRealtimeTrigger === 'function' && typeof pollTsunami === 'function') disasterRealtimeTrigger(pollTsunami);   // 津波情報（沿岸のぬり分け）もすぐ取り直す
    } else if (d.code === 556 && qOn) onEew(fromP2p(d));
  }

  // ---------- 黒帯に流す文 ----------
  const it = h => h ? '<span class="qk-it">' + h + '</span>' : '';
  function names(list, n) {
    const u = [...new Set(list)]; n = n || 8;
    return u.slice(0, n).map(esc).join('、') + (u.length > n ? ' ほか' + (u.length - n) + '地域' : '');
  }
  function depthTxt(dp) { return dp == null ? '' : dp === 0 ? 'ごく浅い' : '深さ' + dp + 'km'; }
  function eewHtml(e) {
    const tag = e.warn ? '<span class="qk-tag qk-warn">緊急地震速報（警報）</span>' : '<span class="qk-tag qk-fc">緊急地震速報（予報）</span>';
    const loc = e.areas.filter(a => LOCAL.test(a.name) || LOCAL.test(a.pref || ''));
    const big = e.areas.filter(a => e.warn ? a.warn : true).map(a => a.name);
    return tag
      + it(e.final ? '最終報（第' + e.serial + '報）' : '第' + e.serial + '報')
      + it(isFinite(e.origin) ? clock(e.origin, true) + '発生' : '')
      + it(e.assume ? '震源は推定中（揺れの観測から予測）' : e.hypo ? '震源 ' + esc(e.hypo) : '')
      + it(!e.assume && e.mag ? 'M' + e.mag.toFixed(1) : '') + it(!e.assume ? depthTxt(e.depth) : '')
      + it(e.max ? '最大予測震度<b>' + LAB[e.max] + '</b>' : '')
      + (FM ? loc.map(a => it('<span class="qk-hot">' + esc(a.name) + ' 予測震度<b>' + range(a.lo, a.hi) + '</b>' + (a.arr ? '（到達と推定）' : a.time ? '（到達 ' + esc(a.time) + '）' : '') + '</span>')).join('') : '')
      + it(big.length ? (e.warn ? '強い揺れに警戒：' : '震度4以上の予想：') + names(big) : '')
      + (e.warn ? it('<span class="qk-hot">身の安全を確保してください</span>') : '');
  }
  function cancelHtml(e) {
    return '<span class="qk-tag qk-fc">緊急地震速報</span>' + it(clock(e.origin, true) + 'ごろ' + (e.hypo ? '（' + esc(e.hypo) + '）' : '') + 'の緊急地震速報は取り消されました');
  }
  const TSU_TXT = { None: '津波の心配なし', NonEffective: '若干の海面変動（被害の心配なし）', Checking: '津波の有無を調査中', Watch: '津波注意報を発表中', Warning: '津波警報等を発表中' };
  function quakeHtml(ev) {
    const groups = {};
    Object.keys(ev.pref).forEach(p => { (groups[ev.pref[p]] = groups[ev.pref[p]] || []).push(p); });
    const lv = Object.keys(groups).map(Number).sort((a, b) => b - a).slice(0, 3);
    const lp = ev.pref[LOCAL_PREF];
    return '<span class="qk-tag" style="background:' + (COL[ev.max] || '#868e96') + ';color:' + (FG[ev.max] || '#fff') + '">' + (ev.type === 'ScalePrompt' ? '震度速報' : '地震情報') + '</span>'
      + it(clock(ev.origin) + 'ごろ') + it(ev.hypo ? '震源 ' + esc(ev.hypo) : '震源は調査中')
      + it(ev.mag ? 'M' + ev.mag.toFixed(1) : '') + it(depthTxt(ev.depth))
      + it(ev.max ? '最大震度<b>' + LAB[ev.max] + '</b>' : '')
      + (FM && lp ? it('<span class="qk-hot">神奈川県 震度<b>' + LAB[lp] + '</b></span>') : '')
      + lv.map(s => it('震度' + LAB[s] + '：' + names(groups[s], 10))).join('')
      + it(ev.tsu && TSU_TXT[ev.tsu] ? (ev.tsu === 'Watch' || ev.tsu === 'Warning' ? '<span class="qk-hot">' + TSU_TXT[ev.tsu] + '</span>' : TSU_TXT[ev.tsu]) : '');
  }
  function tsuHtml(t) {
    const N = { 3: '大津波警報', 2: '津波警報', 1: '津波注意報' }, C = { 3: 'background:#a11bbf;color:#fff', 2: 'background:#e03131;color:#fff', 1: 'background:#ffd43b;color:#000' };
    let h = '', top = 0;
    [3, 2, 1].forEach(g => {
      const a = t.areas.filter(x => x.g === g); if (!a.length) return; top = Math.max(top, g);
      h += '<span class="qk-tag" style="' + C[g] + '">' + N[g] + '</span>' + it(names(a.map(x => x.name + (x.h ? '（' + x.h + '）' : '')), 12));
    });
    return h + it('<span class="qk-hot">' + (top >= 2 ? '海岸・川沿いから離れ、高い所へ避難してください' : '海の中や海岸付近は危険です') + '</span>');
  }
  const colorOk = ev => FM ? (ev.pref[LOCAL_PREF] || 0) >= 30 : ev.max >= 40;
  const bandOk = ev => ev.link || (FM && (ev.pref[LOCAL_PREF] || 0) >= 30);
  const latest = ok => st.evs.filter(ok).sort((a, b) => b.rcv - a.rcv)[0] || null;   // 新しく届いた方を出し、それが終われば前の地震に戻る
  function lines() {
    let l1 = '';
    if (st.eew && st.eew.shown) l1 = eewHtml(st.eew);
    else if (st.cancel) l1 = cancelHtml(st.cancel.e);
    else { const ev = latest(bandOk); if (ev) l1 = quakeHtml(ev); }
    return l1 ? { l1, l2: st.tsu ? tsuHtml(st.tsu) : '' } : null;
  }

  // ---------- 黒帯（長い文は左へ流す） ----------
  const B = { h1: null, h2: null };
  function scroll(inn) {
    if (inn.__a) { try { inn.__a.cancel(); } catch (e) {} inn.__a = null; }
    const over = inn.scrollWidth - inn.parentNode.clientWidth + 8;
    if (over <= 0 || !inn.animate) return;
    const run = over / 55 * 1000, hold = 1800, total = hold + run + hold, x = 'translateX(' + (-over) + 'px)';
    inn.__a = inn.animate([{ transform: 'translateX(0)', offset: 0 }, { transform: 'translateX(0)', offset: hold / total }, { transform: x, offset: (hold + run) / total }, { transform: x, offset: 1 }], { duration: total, iterations: Infinity });
  }
  function setRow(sel, html, k) {
    const inn = document.querySelector('#qkBand ' + sel + ' .qk-in'); if (!inn || B[k] === html) return;
    B[k] = html; inn.innerHTML = html; scroll(inn);
  }
  function show(L) {
    const root = document.documentElement;
    if (!L) { if (root.classList.contains('qk-on')) { root.classList.remove('qk-on', 'qk-2'); setRow('.qk-r1', '', 'h1'); setRow('.qk-r2', '', 'h2'); } return; }
    root.classList.add('qk-on'); root.classList.toggle('qk-2', !!L.l2);
    setRow('.qk-r1', L.l1, 'h1'); setRow('.qk-r2', L.l2 || '', 'h2');
  }
  let rt = null;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => document.querySelectorAll('#qkBand .qk-in').forEach(scroll), 200); });

  // ---------- 都道府県のぬり分け（地図への描画は index-google.html の quakeFill / clearQuake） ----------
  let fillKey = '', fillEv = null, infoKey = '';
  function applyFill() {
    const ev = latest(colorOk), key = ev ? ev.origin + JSON.stringify(ev.pref) : '';
    fillEv = ev;
    if (key === fillKey) return; fillKey = key;
    if (ev) { if (typeof quakeFill === 'function') quakeFill(ev.pref); }
    else if (typeof clearQuake === 'function') clearQuake();
  }

  // ---------- まとめて描き直す（1秒ごとに期限を見る） ----------
  let tick = null;
  function render() {
    const t = now();
    if (st.eew && t - st.eew.last > EEW_WAIT_MS) { st.past.push({ id: st.eew.id, origin: st.eew.origin, shown: st.eew.shown }); st.eew = null; }
    if (st.cancel && st.cancel.until <= t) st.cancel = null;
    st.evs = st.evs.filter(ev => ev.until > t);
    st.past = st.past.filter(p => t - p.origin < 3600000);
    show(lines()); applyFill();
    const k = (document.documentElement.classList.contains('qk-on') ? 'b' : '') + fillKey;
    if (k !== infoKey) { infoKey = k; if (typeof updateMapOverlayInfo === 'function') try { updateMapOverlayInfo(); } catch (e) {} }   // 凡例・出典
    const active = !!(st.eew || st.cancel || st.evs.length);
    if (active && !tick) tick = setInterval(render, 1000);
    else if (!active && tick) { clearInterval(tick); tick = null; }
  }

  // ---------- 接続（切れたら間を空けてつなぎ直す） ----------
  const C = { w: null, p: null, wT: null, pT: null, wN: 0, pN: 0, boot: false };
  const want = () => {
    const q = typeof quakeOn !== 'undefined' && !!quakeOn, t = typeof tsunamiOn !== 'undefined' && !!tsunamiOn;
    return { w: q, p: q || t };
  };
  function ws(url, onMsg, onOpen, key, keyN, keyT, again) {
    if (C[key] && C[key].readyState <= 1) return;
    clearTimeout(C[keyT]);
    let s; try { s = new WebSocket(url); } catch (e) { retry(); return; }
    C[key] = s;
    s.onopen = () => { C[keyN] = 0; onOpen(s); };
    s.onmessage = ev => { let d; try { d = JSON.parse(ev.data); } catch (e) { return; } onMsg(d, s); };
    s.onclose = () => { if (C[key] === s) { C[key] = null; retry(); } };
    s.onerror = () => { try { s.close(); } catch (e) {} };
    function retry() { if (!again()) return; clearTimeout(C[keyT]); C[keyT] = setTimeout(() => ws(url, onMsg, onOpen, key, keyN, keyT, again), Math.min(60000, 3000 * Math.pow(2, C[keyN]++))); }
  }
  function close(key, keyT) { clearTimeout(C[keyT]); const s = C[key]; C[key] = null; if (s) { s.onclose = null; try { s.close(); } catch (e) {} } }
  const openW = () => ws(WOLFX_WS, (d, s) => {
    if (d.type === 'heartbeat') { try { s.send('ping'); } catch (e) {} return; }   // 1分ごとの合図に返事をする
    if (d.type === 'jma_eew') onEew(fromWolfx(d));
  }, s => { try { s.send('query_jmaeew'); } catch (e) {} }, 'w', 'wN', 'wT', () => want().w);
  const openP = () => ws(P2P_WS, d => onP2p(d, now()), () => catchUp(), 'p', 'pN', 'pT', () => want().p);   // つながったら、切れていた間の分を取り寄せる

  /** P2P地震情報の履歴を取り寄せて、まだ受けていない発表を順に受ける（1時間より前の地震情報は流さない） */
  let slow = 0;   // 取り寄せを断られた（429）ときに間を空ける
  async function history(q) {
    const r = await fetch(P2P_API + '/history?' + q, FETCH);
    if (r.status === 429) { slow = Math.min(6, slow + 1); return null; }
    if (!r.ok) return null; slow = Math.max(0, slow - 1);
    const a = await r.json(); return Array.isArray(a) ? a : null;
  }
  function feed(a, code) {
    a.slice().reverse().forEach(d => { if (code && d.code !== code) return; const rc = jstMs(d.time); if (isFinite(rc) && (d.code !== 551 || now() - rc < 3600000)) onP2p(d, Math.min(rc, now())); });
  }
  /** 開いたとき・つなぎ直したとき・画面に戻ったとき：途中で出た分を取り寄せる */
  let cuBusy = false;
  async function catchUp() {
    const w = want(); if (cuBusy || !w.w) return; cuBusy = true;
    try {
      try { const r = await fetch(WOLFX_HTTP, FETCH); if (r.ok) onEew(fromWolfx(await r.json())); } catch (e) {}
      try { const a = await history('codes=551&limit=40'); if (a) feed(a, 551); } catch (e) {}
      try { const a = await history('codes=552&limit=1'); if (a) { st.tsu = null; if (a[0]) onTsunami(a[0]); } } catch (e) {}   // 1週間より前の分は返らない＝発表中の津波予報はない
      pollAt = Date.now();
    } finally { cuBusy = false; render(); }
  }
  /** 即時の接続がないあいだの取り寄せ（20秒ごと。断られたら間を空ける） */
  let pollAt = 0, polling = false;
  async function poll() {
    if (polling || !want().p || (C.p && C.p.readyState === 1)) return;
    if (Date.now() - pollAt < 20000 * Math.pow(2, slow)) return;
    polling = true; pollAt = Date.now();
    try { const a = await history('codes=551&codes=552&codes=556&limit=20'); if (a) feed(a); } catch (e) {}
    polling = false;
  }
  function sync() {
    const w = want();
    if (w.w) openW(); else close('w', 'wT');
    if (w.p) openP(); else close('p', 'pT');
    if (!w.w) { st.eew = null; st.cancel = null; st.evs = []; st.past = []; st.tsu = null; C.boot = false; render(); return; }
    if (!C.boot) { C.boot = true; catchUp(); }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && want().p) { sync(); catchUp(); } });
  setInterval(poll, 5000 + Math.round(Math.random() * 1000));   // 同じWi-Fiの端末どうしで取り寄せる時刻がそろわないように

  window.quakeLive = {
    sync,
    /** 地図の凡例（ぬり分けている地震の震度の色） */
    legend() {
      const ev = fillKey && fillEv; if (!ev) return '';
      const sc = [...new Set(Object.values(ev.pref))].sort((a, b) => b - a);
      return '<div class="lg-block"><div class="lg-ttl">地震の震度（' + clock(ev.origin) + 'ごろ' + (ev.hypo ? ' ' + esc(ev.hypo) : '') + '）</div><div class="qk-lg">'
        + sc.map(s => '<span><i style="background:' + COL[s] + '"></i>' + LAB[s] + '</span>').join('') + '</div></div>';
    },
    /** 出典（黒帯・ぬり分けを出している間だけ） */
    attr() { return infoKey ? '地震・津波: P2P地震情報（気象庁の発表）・緊急地震速報: Wolfx（気象庁の発表の中継）' : ''; },
  };
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.quakeLive._test = { eew: d => onEew(fromWolfx(d)), p2p: onP2p, st, render };   // 手元の確認用
  if (want().p) sync();
})();
