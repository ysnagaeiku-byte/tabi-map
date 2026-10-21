// 渉外局 シフト管理（たびマップ 本祭支援ツールに入れる予定の機能を、先に単独のサイトとして試すもの）
//  - 期間は 11/4〜11/9 の6日間。局（局長・副局長）・GS課・広報課 を分けて、または全体で見られる
//  - 日別：横＝時刻、縦＝メンバー。棒の左端＝入り、右端＝終わり、斜線＝休憩。名前の左に役職のバッジ
//    空いている所をドラッグ（スマホはタップ）で追加、棒をドラッグで移動・別の人へ、端をドラッグで時間を変更
//  - 6日間：メンバー×日付の一覧。入り〜終わり・休憩・担当を1マスに
//  - 名簿とシフトはこの端末（localStorage）にだけ保存。JSONで書き出し・読み込み、Excel用のCSV、印刷
//    リポジトリは公開なので、実際の名簿はコードに書かない（初回は架空の名前のサンプルを表示）
(function () {
  'use strict';

  const STORE_KEY = 'shift_v1', VIEW_KEY = 'shift_view_v1';
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const DAY_MAX = 24 * 60;
  const HIST_MAX = 80;
  const KINDS = [['prep', '準備'], ['fest', '本祭'], ['post', '片付け']];

  const DEF_DAYS = [
    { d: '2026-11-04', label: '準備', kind: 'prep' },
    { d: '2026-11-05', label: '準備', kind: 'prep' },
    { d: '2026-11-06', label: '前日準備', kind: 'prep' },
    { d: '2026-11-07', label: '本祭1日目', kind: 'fest' },
    { d: '2026-11-08', label: '本祭2日目', kind: 'fest' },
    { d: '2026-11-09', label: '片付け', kind: 'post' },
  ];
  const DEF_GROUPS = [
    { id: 'hq', name: '局', color: '#f2f2f2' },
    { id: 'gs', name: 'GS課', color: '#2dd4bf' },
    { id: 'pr', name: '広報課', color: '#a78bfa' },
  ];
  // 並び順＝役職の上下（上ほど上に表示）。色なし＝バッジを目立たせない
  const DEF_ROLES = [
    { id: 'kyokucho', name: '局長', color: '#f5b301' },
    { id: 'fukukyokucho', name: '副局長', color: '#ff8a1f' },
    { id: 'kacho', name: '課長', color: '#ff4d4d' },
    { id: 'fukukacho', name: '副課長', color: '#ff6fae' },
    { id: 'hancho', name: '班長', color: '#4f8cff' },
    { id: 'ippan', name: '一般', color: '' },
  ];
  const DEF_PRESETS = [
    { id: 'p1', name: '早番', s: 480, e: 780, br: [] },
    { id: 'p2', name: '遅番', s: 780, e: 1110, br: [] },
    { id: 'p3', name: '通し', s: 510, e: 1080, br: [{ s: 720, e: 780 }] },
    { id: 'p4', name: '午前', s: 540, e: 720, br: [] },
    { id: 'p5', name: '午後', s: 780, e: 1020, br: [] },
    { id: 'p6', name: '夕方', s: 1020, e: 1260, br: [] },
  ];
  const DEF_TASKS = ['本部待機', '車両誘導', '搬入・搬出', '巡回', '受付', '案内所', '撮影', 'SNS', 'パンフ配布'];
  const DEF_OPT = { from: 480, to: 1260, snap: 15, autoBreak: true };

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const clone = o => JSON.parse(JSON.stringify(o));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let uidN = 0;
  const uid = () => Date.now().toString(36) + (uidN++).toString(36) + Math.random().toString(36).slice(2, 6);
  const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
  const isHex = c => /^#[0-9a-f]{6}$/i.test(c || '');

  // ---------- 時刻 ----------
  const fmt = m => Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
  const fmt2 = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  function hm(min) { const h = Math.floor(min / 60), m = min % 60; return h ? (m ? h + '時間' + m + '分' : h + '時間') : m + '分'; }
  const hh = min => (Math.round(min / 6) / 10) + 'h';
  function dParts(ymd) { const [y, m, d] = ymd.split('-').map(Number); return { y, m, d, w: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }; }
  function dLabel(ymd) { const p = dParts(ymd); return p.m + '/' + p.d + '(' + WD[p.w] + ')'; }
  function jstNow() { const d = new Date(Date.now() + 9 * 3600000); return { ymd: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() }; }
  const snapTo = (v, st) => Math.round(v / st) * st;

  // ---------- データの形（読み込んだものはここで整える） ----------
  function cleanBreaks(br, s, e) {
    const out = (Array.isArray(br) ? br : []).map(b => ({ s: Math.max(s, Math.round(+b.s)), e: Math.min(e, Math.round(+b.e)) }))
      .filter(b => isFinite(b.s) && isFinite(b.e) && b.e > b.s).sort((x, y) => x.s - y.s);
    const m = [];
    out.forEach(b => { const l = m[m.length - 1]; if (l && b.s <= l.e) l.e = Math.max(l.e, b.e); else m.push(b); });
    return m;
  }
  function normalize(src) {
    const d = src && typeof src === 'object' ? src : {};
    const o = { v: 1, title: str(d.title, 30) || '渉外局 シフト', sample: !!d.sample };
    const dayIn = Array.isArray(d.days) ? d.days.filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(x.d)) : [];
    o.days = (dayIn.length ? dayIn : DEF_DAYS).map(x => ({ d: x.d, label: str(x.label, 12), kind: KINDS.some(k => k[0] === x.kind) ? x.kind : 'prep' }));
    const gIn = Array.isArray(d.groups) ? d.groups : [];
    o.groups = DEF_GROUPS.map(g => { const x = gIn.find(y => y && y.id === g.id) || {}; return { id: g.id, name: str(x.name, 12) || g.name, color: isHex(x.color) ? x.color : g.color }; });
    const rIn = Array.isArray(d.roles) ? d.roles.filter(r => r && r.id && str(r.name, 10)) : [];
    o.roles = (rIn.length ? rIn : DEF_ROLES).map(r => ({ id: str(r.id, 24), name: str(r.name, 10), color: isHex(r.color) ? r.color : '' }));
    o.roles = o.roles.filter((r, i) => o.roles.findIndex(x => x.id === r.id) === i);
    const pIn = Array.isArray(d.presets) ? d.presets : DEF_PRESETS;
    o.presets = pIn.map(p => ({ id: str(p.id, 24) || uid(), name: str(p.name, 10), s: Math.round(+p.s), e: Math.round(+p.e), br: [] }))
      .filter(p => p.name && isFinite(p.s) && isFinite(p.e) && p.s >= 0 && p.e <= DAY_MAX && p.e > p.s);
    o.presets.forEach((p, i) => { p.br = cleanBreaks((pIn.find(x => x && x.id === p.id) || pIn[i] || {}).br, p.s, p.e); });
    o.tasks = (Array.isArray(d.tasks) ? d.tasks : DEF_TASKS).map(t => str(t, 20)).filter((t, i, a) => t && a.indexOf(t) === i).slice(0, 60);
    const op = d.opt && typeof d.opt === 'object' ? d.opt : {};
    o.opt = {
      from: [op.from].map(Number).filter(v => isFinite(v) && v >= 0 && v < DAY_MAX && v % 60 === 0)[0] ?? DEF_OPT.from,
      to: [op.to].map(Number).filter(v => isFinite(v) && v > 0 && v <= DAY_MAX && v % 60 === 0)[0] ?? DEF_OPT.to,
      snap: [5, 10, 15, 30].includes(+op.snap) ? +op.snap : DEF_OPT.snap,
      autoBreak: op.autoBreak !== false,
    };
    if (o.opt.to <= o.opt.from) { o.opt.from = DEF_OPT.from; o.opt.to = DEF_OPT.to; }
    const gIds = o.groups.map(g => g.id), rIds = o.roles.map(r => r.id), fallbackRole = rIds[rIds.length - 1];
    const seenM = new Set();
    o.members = (Array.isArray(d.members) ? d.members : []).filter(m => m && m.id && !seenM.has(m.id) && seenM.add(m.id)).map(m => ({
      id: str(m.id, 40), name: str(m.name, 30) || '（名前なし）',
      group: gIds.includes(m.group) ? m.group : 'gs', role: rIds.includes(m.role) ? m.role : fallbackRole, note: str(m.note, 60),
    }));
    const mIds = new Set(o.members.map(m => m.id)), dIds = new Set(o.days.map(x => x.d)), seenS = new Set();
    o.shifts = (Array.isArray(d.shifts) ? d.shifts : []).filter(s => s && s.id && !seenS.has(s.id) && seenS.add(s.id)).map(s => {
      const a = clamp(Math.round(+s.s), 0, DAY_MAX), b = clamp(Math.round(+s.e), 0, DAY_MAX);
      return { id: str(s.id, 40), m: s.m, d: s.d, s: a, e: b, br: cleanBreaks(s.br, a, b), task: str(s.task, 20), note: str(s.note, 80) };
    }).filter(s => mIds.has(s.m) && dIds.has(s.d) && isFinite(s.s) && isFinite(s.e) && s.e > s.s);
    return o;
  }
  const brMin = sh => sh.br.reduce((t, b) => t + (b.e - b.s), 0);
  const workMin = sh => (sh.e - sh.s) - brMin(sh);

  // ---------- サンプル（架空の名前） ----------
  function sampleData() {
    const SUR = ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤', '吉田', '山田', '佐々木', '山口', '松本', '井上', '木村', '林', '斎藤', '清水',
      '山崎', '森', '池田', '橋本', '阿部', '石川', '山下', '中島', '石井', '小川', '前田', '岡田', '長谷川', '藤田', '後藤', '近藤', '村上', '遠藤', '青木', '坂本',
      '福田', '太田', '西村', '藤井', '金子', '岡本', '藤原', '中野', '三浦', '原田'];
    const GIV = ['翔太', '陽菜', '蓮', '結衣', '湊', '葵', '大和', '美咲', '悠真', 'さくら', '陸', '凛', '颯太', '芽依', '樹', '心春', '海斗', '七海', '蒼', '結菜',
      '大輝', '花音', '拓海', '彩花', '健太', '優奈', '直樹', '真央', '亮', '莉子', '航', '紗希', '優斗', '楓', '隼', '千尋', '涼', '美月', '奏太', 'ひなた',
      '俊介', '愛子', '和也', '杏', '雄大', '舞', '光', '茜', '誠', '桃子'];
    const plan = [['hq', 'kyokucho', 1], ['hq', 'fukukyokucho', 2], ['gs', 'kacho', 1], ['gs', 'fukukacho', 1], ['gs', 'hancho', 2], ['gs', 'ippan', 11],
      ['pr', 'kacho', 1], ['pr', 'fukukacho', 2], ['pr', 'hancho', 3], ['pr', 'ippan', 26]];
    const members = [];
    plan.forEach(([g, r, n]) => { for (let k = 0; k < n; k++) { const i = members.length; members.push({ id: 'm' + (i + 1), name: SUR[i] + ' ' + GIV[(i * 7 + 3) % GIV.length], group: g, role: r }); } });
    const TASK = { hq: ['本部待機'], gs: ['車両誘導', '搬入・搬出', '巡回', '本部待機'], pr: ['受付', '案内所', '撮影', 'SNS', 'パンフ配布'] };
    const rnd = (i, k) => (((i + 1) * 2654435761 + (k + 1) * 40503 * 97) >>> 0) % 100;
    const shifts = [];
    const add = (m, d, s, e, br, task) => shifts.push({ id: 's' + (shifts.length + 1), m: m.id, d, s, e, br: br || [], task: task || '' });
    const T = (h, m) => h * 60 + (m || 0);
    DEF_DAYS.forEach((day, k) => {
      members.forEach((m, i) => {
        const r = rnd(i, k), lead = ['kyokucho', 'fukukyokucho', 'kacho', 'fukukacho'].includes(m.role);
        const task = TASK[m.group][(i + k) % TASK[m.group].length];
        if (day.kind === 'prep' && k < 2) {             // 平日：授業のあと
          if (m.group === 'hq') add(m, day.d, T(16), T(21), [], task);
          else if (m.group === 'gs' && (lead || r < 55)) add(m, day.d, T(16, 30), T(20, 30), [], task);
          else if (m.group === 'pr' && (lead || r < 35)) add(m, day.d, T(17), T(20), [], task);
        } else if (day.kind === 'prep') {               // 前日準備
          if (m.group === 'hq') add(m, day.d, T(8, 30), T(20), [{ s: T(12, 30), e: T(13, 30) }], task);
          else if (m.group === 'gs' && (lead || r < 85)) add(m, day.d, T(9), T(18), [{ s: T(12), e: T(13) }], task);
          else if (m.group === 'pr' && (lead || r < 60)) add(m, day.d, T(13), T(19), [], task);
        } else if (day.kind === 'fest') {               // 本祭
          if (m.group === 'hq') add(m, day.d, T(7, 30), T(19), [{ s: T(11, 30), e: T(12, 15) }, { s: T(15, 30), e: T(16) }], task);
          else if (lead) add(m, day.d, m.group === 'gs' ? T(8) : T(9), m.group === 'gs' ? T(18, 30) : T(17, 30), [{ s: T(12), e: T(13) }], task);
          else if (m.group === 'gs') { if (r < 48) add(m, day.d, T(8), T(13), [], task); else if (r < 92) add(m, day.d, T(12, 30), T(18, 30), [{ s: T(15, 30), e: T(15, 45) }], task); }
          else if (r < 42) add(m, day.d, T(9), T(13, 30), [], task);
          else if (r < 84) add(m, day.d, T(13), T(17, 30), [], task);
          else if (r < 94) add(m, day.d, T(9), T(17, 30), [{ s: T(12, 30), e: T(13, 15) }], task);
        } else {                                        // 片付け
          if (m.group === 'hq') add(m, day.d, T(9), T(18), [{ s: T(12), e: T(13) }], task);
          else if (m.group === 'gs' && (lead || r < 70)) add(m, day.d, T(9), T(17), [{ s: T(12), e: T(12, 45) }], '搬入・搬出');
          else if (m.group === 'pr' && (lead || r < 40)) add(m, day.d, T(10), T(15), [], '撮影');
        }
      });
    });
    return normalize({ sample: true, members, shifts });
  }

  // ---------- 保存と元に戻す ----------
  let D, V, undoS = [], redoS = [], noteHidden = false;
  function loadData() {
    let raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) {}
    if (raw) { try { return normalize(JSON.parse(raw)); } catch (e) {} }
    return sampleData();
  }
  let saveErrShown = false;
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(D)); saveErrShown = false; }
    catch (e) { if (!saveErrShown) { saveErrShown = true; toast('この端末に保存できませんでした（プライベートモードや容量の不足）。「書き出し」で控えを取ってください', { err: true, ms: 7000 }); } }
  }
  function loadView() {
    let v = {};
    try { v = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}') || {}; } catch (e) {}
    return {
      view: v.view === 'week' ? 'week' : 'day', grp: typeof v.grp === 'string' ? v.grp : 'all', day: v.day || '',
      colorBy: v.colorBy === 'role' ? 'role' : 'group', hideEmpty: !!v.hideEmpty, hourPx: isFinite(v.hourPx) && v.hourPx > 0 ? v.hourPx : null,
      collapsed: v.collapsed && typeof v.collapsed === 'object' ? v.collapsed : {}, lastPreset: v.lastPreset || '', q: '',
    };
  }
  function saveView() { try { const o = Object.assign({}, V); delete o.q; localStorage.setItem(VIEW_KEY, JSON.stringify(o)); } catch (e) {} }

  // 変更はすべてここを通す（元に戻せるように、変更前を控える）
  function commit(fn, msg) {
    const before = JSON.stringify(D);
    const next = clone(D);
    fn(next);
    const n = normalize(next);
    if (JSON.stringify(n) === before) { render(); return false; }
    undoS.push(before); if (undoS.length > HIST_MAX) undoS.shift();
    redoS = [];
    D = n; save(); render();
    if (msg) toast(msg, { undo: true });
    return true;
  }
  function undo() {
    if (!undoS.length) return;
    redoS.push(JSON.stringify(D)); D = normalize(JSON.parse(undoS.pop())); save(); render(); refreshOpenDlg(); toast('元に戻しました');
  }
  function redo() {
    if (!redoS.length) return;
    undoS.push(JSON.stringify(D)); D = normalize(JSON.parse(redoS.pop())); save(); render(); refreshOpenDlg(); toast('やり直しました');
  }

  // ---------- 引く ----------
  const mem = id => D.members.find(m => m.id === id);
  const role = id => D.roles.find(r => r.id === id) || { id, name: '?', color: '' };
  const grp = id => D.groups.find(g => g.id === id) || DEF_GROUPS[1];
  const dayOf = ymd => D.days.find(x => x.d === ymd);
  const roleRank = id => { const i = D.roles.findIndex(r => r.id === id); return i < 0 ? 99 : i; };
  function sortedMembers(list) {
    const gi = id => D.groups.findIndex(g => g.id === id), idx = new Map(D.members.map((m, i) => [m.id, i]));
    return (list || D.members).slice().sort((a, b) => gi(a.group) - gi(b.group) || roleRank(a.role) - roleRank(b.role) || idx.get(a.id) - idx.get(b.id));
  }
  function visibleMembers() {
    const q = V.q.trim().toLowerCase();
    return sortedMembers().filter(m => (V.grp === 'all' || m.group === V.grp) && (!q || m.name.toLowerCase().replace(/\s/g, '').includes(q.replace(/\s/g, ''))));
  }
  const shiftsOf = (mId, day) => D.shifts.filter(s => s.m === mId && s.d === day).sort((a, b) => a.s - b.s);
  function clashIds(list) {
    const out = new Set(), l = list.slice().sort((a, b) => a.s - b.s);
    for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length && l[j].s < l[i].e; j++) { out.add(l[i].id); out.add(l[j].id); }
    return out;
  }
  function dayRange(day) {
    let a = D.opt.from, b = D.opt.to;
    D.shifts.forEach(s => { if (s.d === day) { a = Math.min(a, Math.floor(s.s / 60) * 60); b = Math.max(b, Math.ceil(s.e / 60) * 60); } });
    return [a, b];
  }
  const barColor = m => V.colorBy === 'role' ? (role(m.role).color || '#8b8b95') : grp(m.group).color;
  function roleBadge(rid, sm) {
    const r = role(rid);
    const nm = `<span class="f">${esc(r.name)}</span><span class="s">${esc(r.name.length > 2 ? r.name.slice(0, 2) : r.name)}</span>`;   // スマホの名前の欄は2文字（副局長→副局）
    return r.color ? `<span class="rb${sm ? ' sm' : ''}" style="background:${r.color};color:#000" title="${esc(r.name)}">${nm}</span>` : `<span class="rb none${sm ? ' sm' : ''}">${nm}</span>`;
  }
  // 30分ごとの勤務中の人数（休憩中を除く）
  function headcount(day, members, a, b) {
    const ids = new Set(members.map(m => m.id)), list = D.shifts.filter(s => s.d === day && ids.has(s.m)), out = [];
    for (let t = a; t < b; t += 30) {
      const mid = t + 15, who = new Set();
      list.forEach(s => { if (s.s <= mid && mid < s.e && !s.br.some(x => x.s <= mid && mid < x.e)) who.add(s.m); });
      out.push({ t, n: who.size });
    }
    return out;
  }
  function daySummary(day, members) {
    const ids = new Set(members.map(m => m.id)), list = D.shifts.filter(s => s.d === day && ids.has(s.m));
    return { people: new Set(list.map(s => s.m)).size, work: list.reduce((t, s) => t + workMin(s), 0), count: list.length };
  }

  // ---------- 画面 ----------
  const tlWrap = $('tlWrap'), tl = $('tl');
  let G = null;           // 日別の寸法 { a, b, hp, W, day, nameW }
  function cssNum(name) { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0; }
  const narrowScreen = () => window.matchMedia('(max-width:760px)').matches;

  function render() {
    if (!dayOf(V.day)) { const t = jstNow().ymd; V.day = dayOf(t) ? t : D.days[0].d; }
    if (V.grp !== 'all' && !D.groups.some(g => g.id === V.grp)) V.grp = 'all';
    document.body.classList.toggle('week-only', V.view === 'week');
    const f = D.days[0], l = D.days[D.days.length - 1];
    $('appTitle').textContent = D.title;
    $('appSub').textContent = dLabel(f.d) + '〜' + dLabel(l.d) + '・' + D.members.length + '人';
    document.title = D.title + '（本祭支援ツール 試作）';
    $('sampleNote').hidden = !D.sample || noteHidden;
    $('viewSeg').querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === V.view)));
    $('colorSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.c === V.colorBy));
    $('optHideEmpty').checked = V.hideEmpty;
    renderGroupSeg(); renderDayTabs();
    $('dayView').hidden = V.view !== 'day'; $('weekView').hidden = V.view !== 'week';
    if (V.view === 'day') renderDay(); else renderWeek();
    renderLegend();
    $('btnUndo').disabled = !undoS.length; $('btnRedo').disabled = !redoS.length;
    saveView();
  }
  function renderGroupSeg() {
    const cnt = g => D.members.filter(m => m.group === g).length;
    $('grpSeg').innerHTML = `<button type="button" role="tab" data-g="all" aria-selected="${V.grp === 'all'}">全体<span class="cnt">${D.members.length}</span></button>` +
      D.groups.map(g => `<button type="button" role="tab" data-g="${g.id}" aria-selected="${V.grp === g.id}"><span class="gdot" style="background:${g.color}"></span>${esc(g.name)}<span class="cnt">${cnt(g.id)}</span></button>`).join('');
  }
  function renderDayTabs() {
    const today = jstNow().ymd, ms = visibleMembers();
    $('dayTabs').innerHTML = D.days.map(x => {
      const p = dParts(x.d), n = daySummary(x.d, ms).people;
      return `<button type="button" class="day${x.kind === 'fest' ? ' fest' : ''}" role="tab" data-d="${x.d}" aria-selected="${x.d === V.day}">` +
        `<div class="d">${p.m}/${p.d}<span class="w${p.w === 0 ? ' sun' : p.w === 6 ? ' sat' : ''}">(${WD[p.w]})</span></div>` +
        `<div class="k">${x.label ? `<span class="lbl">${esc(x.label)}</span>` : ''}<b>${n}人</b></div>${x.d === today ? '<span class="today">今日</span>' : ''}</button>`;
    }).join('');
  }

  // 日別（タイムライン）
  function renderDay() {
    const day = V.day, [a, b] = dayRange(day), hours = (b - a) / 60;
    const nameW = cssNum('--name-w') || 176;
    const avail = Math.max(200, tlWrap.clientWidth - nameW - 2);
    const hp = V.hourPx ? clamp(V.hourPx, 20, 320) : Math.max(narrowScreen() ? 46 : 38, Math.min(170, Math.floor(avail / hours * 10) / 10));
    const W = Math.round(hours * hp);
    G = { a, b, hp, W, day, nameW };
    tl.style.setProperty('--hp', hp + 'px');
    const ms = visibleMembers();
    const sum = daySummary(day, ms), hc = headcount(day, ms, a, b);
    const peak = hc.reduce((p, x) => x.n > p.n ? x : p, { n: 0, t: a });
    const dd = dayOf(day);
    $('daySum').innerHTML = `<span>${dLabel(day)}</span>${dd.label ? `<span class="lbl">${esc(dd.label)}</span>` : ''}` +
      `<span>出勤 <b>${sum.people}</b>人</span><span>延べ <b>${hh(sum.work)}</b></span>` +
      (peak.n ? `<span class="pk">最も多い時間 <b>${peak.n}</b>人（${fmt(peak.t)}〜）</span>` : '');

    let h = `<div class="tl-head"><div class="tl-name">${dLabel(day)}　${V.grp === 'all' ? '全体' : esc(grp(V.grp).name)}</div><div class="tl-hours" style="width:${W}px">`;
    for (let t = a; t < b; t += 60) {
      h += `<span style="left:${(t - a) / 60 * hp}px">${fmt(t)}</span>`;
      if (hp >= 96) h += `<span class="mid" style="left:${(t + 30 - a) / 60 * hp}px">:30</span>`;
    }
    const now = jstNow(), showNow = now.ymd === day && now.min >= a && now.min <= b;
    if (showNow) h += `<span class="nowtag" style="left:${(now.min - a) / 60 * hp}px">${fmt(now.min)}</span>`;
    h += `</div></div>`;

    const groups = V.grp === 'all' ? D.groups : D.groups.filter(g => g.id === V.grp);
    let body = '', rowI = 0;
    groups.forEach(g => {
      let gm = ms.filter(m => m.group === g.id);
      if (!gm.length) return;
      const gs = daySummary(day, gm);
      if (V.hideEmpty) gm = gm.filter(m => D.shifts.some(s => s.m === m.id && s.d === day));
      const col = !!V.collapsed[g.id];
      body += `<div class="tl-grp" data-g="${g.id}" style="width:${nameW + W}px"><div class="gin"><span class="car">${col ? '▸' : '▾'}</span><span class="gdot" style="background:${g.color}"></span>${esc(g.name)}` +
        `<span class="sub">${D.members.filter(m => m.group === g.id).length}人中 ${gs.people}人出勤・延べ ${hh(gs.work)}</span></div></div>`;
      if (col) return;
      gm.forEach(m => { body += rowHtml(m, day, rowI++); });
    });
    if (!body) body = `<div class="tl-empty" style="width:${nameW + W}px">${D.members.length ? '条件に合うメンバーがいません' : 'メンバーがいません。「メンバー」から追加してください'}</div>`;

    let foot = `<div class="tl-foot"><div class="tl-name">勤務中の人数<small>30分ごと・休憩中を除く</small></div><div class="hc" style="width:${W}px">${hcCells(hc, hp, a)}</div></div>`;
    if (V.grp === 'all' && groups.length > 1) groups.forEach(g => {
      const gm = ms.filter(m => m.group === g.id);
      if (!gm.length) return;
      foot += `<div class="tl-foot sub2"><div class="tl-name"><span><span class="gdot" style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px;background:${g.color}"></span>${esc(g.name)}</span></div><div class="hc" style="width:${W}px">${hcCells(headcount(day, gm, a, b), hp, a)}</div></div>`;
    });
    const ov = showNow ? `<div class="tl-ov" style="left:${nameW}px;width:${W}px"><div class="tl-now" style="left:${(now.min - a) / 60 * hp}px"></div></div>` : '';
    tl.innerHTML = h + body + foot + ov;
  }
  function hcCells(hc, hp, a) {
    const max = Math.max(1, ...hc.map(x => x.n));
    return hc.map(x => {
      const l = (x.t - a) / 60 * hp + 1, w = hp / 2 - 2;
      if (!x.n) return `<i class="z" style="left:${l}px;width:${w}px">${hp >= 40 ? '0' : ''}</i>`;
      const al = 0.22 + 0.7 * x.n / max;
      return `<i style="left:${l}px;width:${w}px;background:rgba(255,255,255,${al.toFixed(2)});color:${al > 0.5 ? '#000' : '#fff'}">${hp >= 26 ? x.n : ''}</i>`;
    }).join('');
  }
  function nameCell(m, extra, tm) {
    const r = role(m.role);
    return `<div class="tl-name" data-m="${m.id}" title="${esc(m.name)}（${esc(grp(m.group).name)}・${esc(r.name)}）">` +
      `${r.color ? `<span class="rs" style="background:${r.color}"></span>` : ''}${roleBadge(m.role)}<span class="nmw"><span class="nm">${esc(m.name)}</span>${tm ? `<span class="tm">${tm}</span>` : ''}</span>${extra || ''}</div>`;
  }
  function rowHtml(m, day, i) {
    const list = shiftsOf(m.id, day), w = list.reduce((t, s) => t + workMin(s), 0);
    const tm = list.map(s => fmt(s.s) + '–' + fmt(s.e)).join(' ');   // スマホは名前の下に入り〜終わり（横にスクロールしなくても分かる）
    return `<div class="tl-row" data-m="${m.id}">${nameCell(m, w ? `<span class="hrs">${hh(w)}</span>` : '', tm)}` +
      `<div class="tl-lane${i % 2 ? ' alt' : ''}" data-m="${m.id}" style="width:${G.W}px">${laneHtml(m.id)}</div></div>`;
  }
  function laneHtml(mId) {
    let list = D.shifts.filter(s => s.m === mId && s.d === G.day);
    if (drag && drag.moved) {
      list = list.filter(s => s.id !== drag.id);
      if (drag.cur.m === mId) list.push(Object.assign({ ghost: drag.kind === 'new', dragging: true }, drag.cur));
    }
    list.sort((x, y) => x.s - y.s);
    const cl = clashIds(list), m = mem(mId);
    return list.map((sh, i) => barHtml(sh, m, cl.has(sh.id), list[i - 1], list[i + 1])).join('');
  }
  function shiftTitle(sh, m) {
    const r = role(m.role);
    return `${m.name}（${grp(m.group).name}・${r.name}）\n${fmt(sh.s)}〜${fmt(sh.e)}　実働 ${hm(workMin(sh))}` +
      (sh.br.length ? '\n休憩 ' + sh.br.map(b => fmt(b.s) + '〜' + fmt(b.e)).join('、') : '\n休憩なし') +
      (sh.task ? '\n担当 ' + sh.task : '') + (sh.note ? '\n' + sh.note : '');
  }
  function barHtml(sh, m, clash, prev, next, geo) {
    const g = geo || G;
    const x = (sh.s - g.a) / 60 * g.hp, w = Math.max(4, (sh.e - sh.s) / 60 * g.hp);
    const narrow = w < 92;
    let brk = '';
    sh.br.forEach(b => {
      const bx = (b.s - sh.s) / 60 * g.hp, bw = (b.e - b.s) / 60 * g.hp;
      const lab = bw >= 92 ? '休 ' + fmt(b.s) + '–' + fmt(b.e) : bw >= 15 ? '休' : '';
      brk += `<div class="brk" style="left:${bx}px;width:${bw}px">${lab ? `<span>${lab}</span>` : ''}</div>`;
    });
    let inner = '';
    if (!narrow) inner = `<span class="t">${fmt(sh.s)}</span>${sh.task && w >= 170 ? `<span class="tk">${esc(sh.task)}</span>` : ''}<span class="e2">${fmt(sh.e)}</span>`;
    let out = '';
    if (narrow && !geo) {
      const label = `<b>${fmt(sh.s)}</b>–<b>${fmt(sh.e)}</b>`, need = 86;
      const freeR = ((next ? next.s : g.b) - sh.e) / 60 * g.hp, freeL = (sh.s - (prev ? prev.e : g.a)) / 60 * g.hp;
      if (freeR >= need) out = `<div class="bar-out" style="left:${x + w + 5}px">${label}</div>`;
      else if (freeL >= need) out = `<div class="bar-out" style="right:${g.W - x + 5}px">${label}</div>`;
    }
    const cls = 'bar' + (narrow ? ' narrow' : '') + (clash ? ' clash' : '') + (sh.ghost ? ' ghost' : '') + (sh.dragging ? ' drag' : '');
    const hdl = !geo && w >= 22 ? '<i class="hdl l"></i><i class="hdl r"></i>' : '';
    return `<div class="${cls}" data-id="${sh.id}" style="left:${x}px;width:${w}px;background:${barColor(m)}" title="${esc(shiftTitle(sh, m))}${clash ? '\n※ 同じ人の時間が重なっています' : ''}">${brk}${inner}${hdl}</div>${out}`;
  }

  // 6日間（メンバー×日付）
  function chipHtml(sh, m, clash) {
    return `<div class="chip${clash ? ' clash' : ''}" data-id="${sh.id}" style="background:${barColor(m)}" title="${esc(shiftTitle(sh, m))}">` +
      `<span class="t">${fmt(sh.s)}<span class="sep">–</span>${fmt(sh.e)}</span>` +
      (sh.br.length ? `<span class="b"><i>休</i>${sh.br.map(b => fmt(b.s) + '–' + fmt(b.e)).join(' ')}</span>` : '') +
      (sh.task ? `<span class="k">${esc(sh.task)}</span>` : '') + `</div>`;
  }
  function renderWeek() {
    const ms = visibleMembers();
    const groups = V.grp === 'all' ? D.groups : D.groups.filter(g => g.id === V.grp);
    const ids = new Set(ms.map(m => m.id));
    const all = D.shifts.filter(s => ids.has(s.m));
    $('weekSum').innerHTML = `<span>${dLabel(D.days[0].d)}〜${dLabel(D.days[D.days.length - 1].d)}</span>` +
      `<span>シフト <b>${all.length}</b>件</span><span>延べ <b>${hh(all.reduce((t, s) => t + workMin(s), 0))}</b></span>` +
      `<span>1日以上入る人 <b>${new Set(all.map(s => s.m)).size}</b>/${ms.length}人</span>`;
    let h = `<table class="mx"><thead><tr><th class="nm">メンバー</th>`;
    D.days.forEach(x => {
      const s = daySummary(x.d, ms);
      h += `<th class="${x.kind === 'fest' ? 'fest' : ''}${x.d === V.day ? ' sel' : ''}" data-d="${x.d}">${dLabel(x.d)}${x.label ? `<span class="lbl">${esc(x.label)}</span>` : ''}<span class="c">${s.people}人・${hh(s.work)}</span></th>`;
    });
    h += `<th>合計</th></tr></thead><tbody>`;
    const cols = D.days.length + 2;
    groups.forEach(g => {
      const gm = ms.filter(m => m.group === g.id);
      if (!gm.length) return;
      const col = !!V.collapsed[g.id];
      h += `<tr class="gh" data-g="${g.id}"><td colspan="${cols}"><span class="inner"><span class="car">${col ? '▸' : '▾'}</span><span class="gdot" style="background:${g.color}"></span>${esc(g.name)}<span class="sub">${gm.length}人</span></span></td></tr>`;
      if (col) return;
      gm.forEach(m => {
        let tot = 0;
        h += `<tr data-m="${m.id}"><td class="nm">${nameCell(m)}</td>`;
        D.days.forEach(x => {
          const list = shiftsOf(m.id, x.d), cl = clashIds(list);
          tot += list.reduce((t, s) => t + workMin(s), 0);
          h += `<td class="cell${list.length ? ' has' : ''}" data-d="${x.d}">${list.map(s => chipHtml(s, m, cl.has(s.id))).join('')}<span class="add">＋</span></td>`;
        });
        h += `<td class="tot">${tot ? hh(tot) : '—'}</td></tr>`;
      });
    });
    h += `</tbody><tfoot><tr><td class="nm">出勤の人数</td>`;
    D.days.forEach(x => { const s = daySummary(x.d, ms); h += `<td><b>${s.people}</b>人</td>`; });
    h += `<td></td></tr></tfoot></table>`;
    if (!ms.length) h = `<div class="tl-empty">${D.members.length ? '条件に合うメンバーがいません' : 'メンバーがいません。「メンバー」から追加してください'}</div>`;
    $('mxWrap').innerHTML = h;
  }

  function renderLegend() {
    const sw = V.colorBy === 'role'
      ? D.roles.map(r => `<span class="it"><span class="sw" style="background:${r.color || '#8b8b95'}"></span>${esc(r.name)}</span>`).join('')
      : D.groups.map(g => `<span class="it"><span class="sw" style="background:${g.color}"></span>${esc(g.name)}</span>`).join('');
    $('legend').innerHTML = `<span class="it">役職：</span>${D.roles.map(r => roleBadge(r.id, true)).join(' ')}<span class="sep"></span>${sw}` +
      `<span class="it"><span class="sw brk"></span>休憩</span><span class="it"><span class="sw" style="background:transparent;box-shadow:0 0 0 2px var(--danger)"></span>時間の重なり</span>` +
      (V.view === 'day' ? `<span class="sep"></span><span class="hint">${matchMedia('(hover:hover)').matches ? '空いている所をドラッグして追加・棒をドラッグして移動（別の人へも）・棒の端で時間を変更・クリックで編集' : '空いている所をタップして追加・棒をタップして編集'}</span>` : '<span class="sep"></span><span class="hint">マスを押すと追加・編集</span>');
  }

  // ---------- 日別：ドラッグで追加・移動・時間の変更（マウスとペン。指はタップで編集） ----------
  let drag = null, suppressClick = false;
  const laneLeft = () => tl.getBoundingClientRect().left + G.nameW;
  const minAt = clientX => G.a + (clientX - laneLeft()) / G.hp * 60;
  function laneAt(x, y) { const el = document.elementFromPoint(x, y); return el && el.closest && el.closest('.tl-lane'); }
  function paintLanes(ids) { ids.forEach(id => { const ln = tl.querySelector(`.tl-lane[data-m="${id}"]`); if (ln) ln.innerHTML = laneHtml(id); }); }
  tl.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.pointerType === 'touch' || !G) return;
    const lane = e.target.closest('.tl-lane');
    if (!lane) return;
    const bar = e.target.closest('.bar'), st = D.opt.snap;
    if (bar) {
      const sh = D.shifts.find(s => s.id === bar.dataset.id);
      if (!sh) return;
      const hd = e.target.closest('.hdl');
      drag = { kind: hd ? (hd.classList.contains('l') ? 'l' : 'r') : 'move', id: sh.id, orig: clone(sh), cur: clone(sh), x0: e.clientX, y0: e.clientY, t0: minAt(e.clientX), moved: false, lanes: new Set([sh.m]) };
    } else {
      const t = clamp(snapTo(minAt(e.clientX), st), G.a, G.b);
      drag = { kind: 'new', id: '__new', t0: t, cur: { id: '__new', m: lane.dataset.m, d: G.day, s: t, e: t + st, br: [], task: '', note: '' }, x0: e.clientX, y0: e.clientY, moved: false, lanes: new Set([lane.dataset.m]) };
    }
    e.preventDefault();
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragEnd);
  });
  function onDragMove(e) {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
    drag.moved = true;
    const r = tlWrap.getBoundingClientRect();     // 端に寄せたら自動でスクロール
    if (e.clientX > r.right - 36) tlWrap.scrollLeft += 14; else if (e.clientX < r.left + G.nameW + 30) tlWrap.scrollLeft -= 14;
    if (e.clientY > r.bottom - 40) tlWrap.scrollTop += 12; else if (e.clientY < r.top + 40) tlWrap.scrollTop -= 12;
    const st = D.opt.snap, o = drag.orig, c = drag.cur, t = minAt(e.clientX);
    if (drag.kind === 'new') {
      const p = clamp(snapTo(t, st), G.a, G.b);
      c.s = Math.min(drag.t0, p); c.e = Math.max(drag.t0, p);
      if (c.e - c.s < st) c.e = Math.min(G.b, c.s + st);
    } else if (drag.kind === 'move') {
      const len = o.e - o.s, s = clamp(o.s + snapTo(t - drag.t0, st), G.a, G.b - len), dm = s - o.s;
      c.s = s; c.e = s + len; c.br = o.br.map(b => ({ s: b.s + dm, e: b.e + dm }));
      const ln = laneAt(e.clientX, e.clientY);
      if (ln && ln.dataset.m) c.m = ln.dataset.m;
    } else if (drag.kind === 'l') {
      c.s = clamp(o.s + snapTo(t - drag.t0, st), G.a, o.e - st); c.br = cleanBreaks(o.br, c.s, c.e);
    } else {
      c.e = clamp(o.e + snapTo(t - drag.t0, st), o.s + st, G.b); c.br = cleanBreaks(o.br, c.s, c.e);
    }
    drag.lanes.add(c.m);
    paintLanes(drag.lanes);
  }
  function onDragEnd(e) {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragEnd);
    const d = drag; drag = null;
    if (!d || !d.moved) return;           // 動かしていなければクリック（click で編集を開く）
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
    if (e.type === 'pointercancel') { render(); return; }
    const c = d.cur;
    if (d.kind === 'new') {
      render();
      openShiftEditor(withAutoBreak({ m: c.m, d: c.d, s: c.s, e: c.e, br: [] }));
      return;
    }
    const o = d.orig;
    if (c.m === o.m && c.s === o.s && c.e === o.e) { render(); return; }
    const mv = c.m !== o.m ? mem(c.m) : null;
    commit(D2 => { const sh = D2.shifts.find(s => s.id === o.id); if (sh) { sh.m = c.m; sh.s = c.s; sh.e = c.e; sh.br = c.br; } },
      (mv ? mv.name + ' に移しました ' : '') + fmt(c.s) + '〜' + fmt(c.e) + ' にしました');
  }
  tl.addEventListener('click', e => {
    if (suppressClick || !G) return;
    const grpEl = e.target.closest('.tl-grp');
    if (grpEl) { V.collapsed[grpEl.dataset.g] = !V.collapsed[grpEl.dataset.g]; render(); return; }
    const nm = e.target.closest('.tl-name[data-m]');
    if (nm) { openMember(nm.dataset.m); return; }
    const bar = e.target.closest('.bar');
    if (bar) { const sh = D.shifts.find(s => s.id === bar.dataset.id); if (sh) openShiftEditor(sh); return; }
    const lane = e.target.closest('.tl-lane');
    if (lane) {
      const t = clamp(Math.floor(minAt(e.clientX) / 30) * 30, 0, DAY_MAX - D.opt.snap);
      openShiftEditor(newDraft(lane.dataset.m, G.day, t));
    }
  });

  // 新しいシフトの下書き（最後に使った定型の長さで）
  function newDraft(mId, day, t) {
    const p = D.presets.find(x => x.id === V.lastPreset);
    if (t == null) return withAutoBreak(p ? { m: mId, d: day, s: p.s, e: p.e, br: clone(p.br) } : { m: mId, d: day, s: 540, e: 1020, br: [] });
    const len = p ? p.e - p.s : 240;
    const s = clamp(t, 0, DAY_MAX - D.opt.snap), e = Math.min(DAY_MAX, s + len);
    return withAutoBreak({ m: mId, d: day, s, e, br: [] });
  }
  // 6時間を超えるのに休憩がないときは、真ん中に休憩を入れる（8時間を超えたら60分、それ以外は45分）
  function withAutoBreak(dr) {
    if (!D.opt.autoBreak || dr.br.length || dr.e - dr.s <= 360) return dr;
    dr.br = [suggestBreak(dr)];
    return dr;
  }
  function suggestBreak(dr) {
    const st = D.opt.snap, len = dr.e - dr.s > 480 ? 60 : 45;
    const last = dr.br[dr.br.length - 1];
    let s = last ? last.e + 120 : snapTo(dr.s + (dr.e - dr.s) / 2 - len / 2, Math.max(st, 15));
    if (s + len > dr.e) s = Math.max(dr.s, dr.e - len - st);
    const e = Math.min(dr.e, s + len);
    return { s: Math.max(dr.s, s), e: Math.max(Math.max(dr.s, s) + st, e) };
  }

  // ---------- ダイアログ ----------
  const dlg = $('dlg');
  let dlgDownOnBackdrop = false, dlgRefresh = null;
  function openDlg(o) {
    dlg.className = 'dlg' + (o.wide ? ' wide' : '');
    dlg.innerHTML = `<div class="dlg-h"><h2>${o.title}</h2><button type="button" class="btn ghost icon x" data-close aria-label="閉じる">×</button></div>` +
      `<div class="dlg-b">${o.body}</div>${o.foot ? `<div class="dlg-f">${o.foot}</div>` : ''}`;
    dlg._onClose = o.onClose || null;
    dlgRefresh = o.refresh || null;
    if (!dlg.open) dlg.showModal();
    const b = dlg.querySelector('.dlg-b'); if (b) b.scrollTop = 0;
    return dlg;
  }
  function closeDlg() { if (dlg.open) dlg.close(); }
  function refreshOpenDlg() { if (dlg.open && dlgRefresh) dlgRefresh(); }
  dlg.addEventListener('close', () => { const f = dlg._onClose; dlg._onClose = null; dlgRefresh = null; dlg.innerHTML = ''; if (f) f(); });
  dlg.addEventListener('pointerdown', e => { dlgDownOnBackdrop = e.target === dlg; });
  dlg.addEventListener('click', e => {
    if (e.target === dlg && dlgDownOnBackdrop) { closeDlg(); return; }
    if (e.target.closest('[data-close]')) closeDlg();
  });

  function timeOptions(sel, from, to, step) {
    const set = new Set();
    for (let m = from; m <= to; m += step) set.add(m);
    if (sel != null && sel >= 0 && sel <= DAY_MAX) set.add(sel);
    return [...set].sort((a, b) => a - b).map(m => `<option value="${m}"${m === sel ? ' selected' : ''}>${fmt(m)}</option>`).join('');
  }
  function memberOptions(sel) {
    return D.groups.map(g => {
      const ms = sortedMembers().filter(m => m.group === g.id);
      return ms.length ? `<optgroup label="${esc(g.name)}">${ms.map(m => { const r = role(m.role); return `<option value="${m.id}"${m.id === sel ? ' selected' : ''}>${esc(m.name)}${r.color ? '（' + esc(r.name) + '）' : ''}</option>`; }).join('')}</optgroup>` : '';
    }).join('');
  }
  const presetChips = (s, e) => D.presets.map(p => {
    const on = p.s === s && p.e === e;
    return `<button type="button" class="pchip${on ? ' on' : ''}" data-p="${p.id}">${esc(p.name)}<small>${fmt(p.s)}–${fmt(p.e)}</small></button>`;
  }).join('');
  function breakErrors(dr) {
    const errs = [];
    dr.br.forEach((b, i) => {
      if (b.e <= b.s) errs.push([i, `休憩${i + 1}の終わりが始まりより前です`]);
      else if (b.s < dr.s || b.e > dr.e) errs.push([i, `休憩${i + 1}が勤務時間（${fmt(dr.s)}〜${fmt(dr.e)}）の外です`]);
      else if (dr.br.some((x, j) => j !== i && x.s < b.e && b.s < x.e)) errs.push([i, `休憩${i + 1}がほかの休憩と重なっています`]);
    });
    return errs;
  }

  // シフトの追加・編集
  function openShiftEditor(src, opt) {
    opt = opt || {};
    const isNew = !src.id || !D.shifts.some(s => s.id === src.id);
    if (!D.members.length) { toast('先に「メンバー」から名簿を作ってください'); return; }
    const dr = { id: isNew ? null : src.id, m: mem(src.m) ? src.m : sortedMembers()[0].id, d: dayOf(src.d) ? src.d : V.day, s: src.s, e: src.e, br: clone(src.br || []), task: src.task || '', note: src.note || '' };
    const copyTo = new Set(), st = D.opt.snap;
    const m0 = mem(dr.m);
    const body = `
      <div class="fld"><label for="edM">メンバー</label><select class="inp" id="edM">${memberOptions(dr.m)}</select></div>
      <div class="fld"><span class="lb">日付</span><div class="dchk" id="edD">${D.days.map(x => `<label class="${x.kind === 'fest' ? 'fest' : ''}"><input type="radio" name="edD" value="${x.d}"${x.d === dr.d ? ' checked' : ''}>${dLabel(x.d)}</label>`).join('')}</div></div>
      <div class="fld"><span class="lb">時間（定型から選ぶか、入り・終わりを選ぶ）</span>
        <div class="presets" id="edP"></div>
        <div class="row nw" style="margin-top:4px"><label class="lb" for="edS" style="font-size:12px;color:var(--muted)">入り</label><select class="inp time" id="edS"></select><span>〜</span>
          <label class="lb" for="edE" style="font-size:12px;color:var(--muted)">終わり</label><select class="inp time" id="edE"></select></div>
        <div class="dur" id="edDur"></div>
        <div class="timebar" id="edBar"></div>
      </div>
      <div class="fld"><span class="lb">休憩</span><div class="brl" id="edBrk"></div>
        <div class="row"><button type="button" class="btn small" id="edAddBr">＋ 休憩を追加</button><span class="msg" id="edBrHint"></span></div></div>
      <div class="row" style="align-items:flex-start">
        <div class="fld" style="flex:1;min-width:140px"><label for="edT">担当（持ち場）</label><input class="inp" id="edT" list="edTasks" maxlength="20" value="${esc(dr.task)}" placeholder="例：受付"></div>
        <div class="fld" style="flex:1.4;min-width:170px"><label for="edN">メモ</label><input class="inp" id="edN" maxlength="80" value="${esc(dr.note)}" placeholder="例：無線を受け取る"></div>
      </div>
      <datalist id="edTasks">${D.tasks.map(t => `<option value="${esc(t)}">`).join('')}</datalist>
      <div class="fld"><span class="lb">ほかの日にも同じ時間で作る</span><div class="dchk" id="edCopy"></div></div>
      <div class="msg" id="edMsg"></div>`;
    const foot = `${isNew ? '' : '<button type="button" class="btn danger" id="edDel">削除</button>'}<span class="grow"></span>` +
      `<button type="button" class="btn" data-close>キャンセル</button><button type="button" class="btn primary" id="edSave">${isNew ? '追加する' : '保存する'}</button>`;
    let done = false;
    openDlg({ title: isNew ? 'シフトを追加' : 'シフトを編集' + (m0 ? '：' + esc(m0.name) : ''), body, foot, onClose: () => { if (opt.back) opt.back(); }, refresh: () => { if (!isNew && !D.shifts.some(s => s.id === dr.id)) closeDlg(); else upd(); } });
    const q = id => dlg.querySelector('#' + id);

    function upd() {
      q('edS').innerHTML = timeOptions(dr.s, 0, DAY_MAX - st, st);
      q('edE').innerHTML = timeOptions(dr.e, st, DAY_MAX, st);
      q('edP').innerHTML = presetChips(dr.s, dr.e);
      const bad = dr.e <= dr.s, bErr = bad ? [] : breakErrors(dr);
      q('edS').classList.toggle('err', bad); q('edE').classList.toggle('err', bad);
      const work = Math.max(0, dr.e - dr.s - dr.br.reduce((t, b) => t + Math.max(0, Math.min(b.e, dr.e) - Math.max(b.s, dr.s)), 0));
      q('edDur').innerHTML = bad ? '' : `実働 <b>${hm(work)}</b>（${fmt(dr.s)}〜${fmt(dr.e)} の ${hm(dr.e - dr.s)}・休憩 ${hm(dr.br.reduce((t, b) => t + Math.max(0, b.e - b.s), 0))}）`;
      // 1日の中での位置
      const bar = q('edBar'), [ra, rb] = dayRange(dr.d), a = Math.min(ra, Math.floor(dr.s / 60) * 60), b = Math.max(rb, Math.ceil(dr.e / 60) * 60);
      const wpx = bar.clientWidth || 480, hp = wpx / ((b - a) / 60), m = mem(dr.m);
      let tk = '';
      for (let t = a; t < b; t += 60) if ((t / 60) % (hp < 26 ? 3 : hp < 40 ? 2 : 1) === 0) tk += `<span class="tk2" style="left:${(t - a) / 60 * hp}px">${t / 60}</span>`;
      bar.innerHTML = tk + (bad || !m ? '' : barHtml({ id: 'x', s: dr.s, e: dr.e, br: dr.br.filter(x => x.e > x.s && x.s >= dr.s && x.e <= dr.e), task: '' }, m, false, null, null, { a, b, hp, W: wpx }));
      // 休憩
      const errIdx = new Set(bErr.map(x => x[0]));
      q('edBrk').innerHTML = dr.br.length ? dr.br.map((x, i) => `<div class="row nw" data-i="${i}"><span class="lbl">休憩${i + 1}</span>` +
        `<select class="inp time${errIdx.has(i) ? ' err' : ''}" data-k="s" aria-label="休憩${i + 1}の始まり">${timeOptions(x.s, Math.min(dr.s, x.s), Math.max(dr.e, x.s), st)}</select><span>〜</span>` +
        `<select class="inp time${errIdx.has(i) ? ' err' : ''}" data-k="e" aria-label="休憩${i + 1}の終わり">${timeOptions(x.e, Math.min(dr.s, x.e), Math.max(dr.e, x.e), st)}</select>` +
        `<span class="dur">${x.e > x.s ? hm(x.e - x.s) : ''}</span><span class="grow" style="flex:1"></span><button type="button" class="btn ghost small icon" data-del aria-label="休憩${i + 1}を消す">×</button></div>`).join('')
        : '<div class="msg">休憩なし</div>';
      const long = !bad && dr.e - dr.s > 360 && !dr.br.length;
      q('edBrHint').innerHTML = long ? '<span class="msg warn">6時間を超えています。休憩を入れましょう</span>' : '';
      // ほかの日へ
      q('edCopy').innerHTML = D.days.filter(x => x.d !== dr.d).map(x => `<label class="${x.kind === 'fest' ? 'fest' : ''}"><input type="checkbox" value="${x.d}"${copyTo.has(x.d) ? ' checked' : ''}>${dLabel(x.d)}</label>`).join('');
      // 注意
      const others = D.shifts.filter(s => s.m === dr.m && s.d === dr.d && s.id !== dr.id && s.s < dr.e && dr.s < s.e);
      const msgs = [];
      if (bad) msgs.push(['err', '終わりは入りより後にしてください']);
      bErr.forEach(x => msgs.push(['err', x[1]]));
      if (others.length) msgs.push(['warn', `この日の ${others.map(s => fmt(s.s) + '〜' + fmt(s.e)).join('、')} と時間が重なっています（保存はできます）`]);
      q('edMsg').innerHTML = msgs.map(x => `<div class="msg ${x[0]}">${x[1]}</div>`).join('');
      q('edSave').disabled = bad || bErr.length > 0;
    }
    function save() {
      if (dr.e <= dr.s || breakErrors(dr).length || done) return;
      done = true;
      const rec = { m: dr.m, d: dr.d, s: dr.s, e: dr.e, br: cleanBreaks(dr.br, dr.s, dr.e), task: str(q('edT').value, 20), note: str(q('edN').value, 80) };
      const p = D.presets.find(x => x.s === rec.s && x.e === rec.e); if (p) V.lastPreset = p.id;
      const extra = [...copyTo].filter(d => d !== rec.d);
      const name = (mem(rec.m) || {}).name || '';
      commit(D2 => {
        if (isNew) D2.shifts.push(Object.assign({ id: uid() }, rec));
        else { const sh = D2.shifts.find(s => s.id === dr.id); if (sh) Object.assign(sh, rec); }
        extra.forEach(d => D2.shifts.push(Object.assign({ id: uid() }, clone(rec), { d })));
      }, `${name} ${dLabel(rec.d)} ${fmt(rec.s)}〜${fmt(rec.e)} を${isNew ? '追加' : '保存'}しました` + (extra.length ? `（ほか${extra.length}日）` : ''));
      closeDlg();
    }
    dlg.querySelector('.dlg-b').addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'edM') dr.m = t.value;
      else if (t.name === 'edD') { dr.d = t.value; copyTo.delete(dr.d); }
      else if (t.id === 'edS') { const len = dr.e - dr.s, ns = +t.value; if (dr.e <= ns) dr.e = Math.min(DAY_MAX, ns + Math.max(len, st)); dr.s = ns; }
      else if (t.id === 'edE') dr.e = +t.value;
      else if (t.closest('#edBrk')) { const i = +t.closest('[data-i]').dataset.i; dr.br[i][t.dataset.k] = +t.value; }
      else if (t.closest('#edCopy')) { if (t.checked) copyTo.add(t.value); else copyTo.delete(t.value); return; }
      else return;
      upd();
    });
    dlg.querySelector('.dlg-b').addEventListener('input', e => { if (e.target.id === 'edT') dr.task = e.target.value; if (e.target.id === 'edN') dr.note = e.target.value; });
    dlg.querySelector('.dlg-b').addEventListener('click', e => {
      const pc = e.target.closest('.pchip');
      if (pc) { const p = D.presets.find(x => x.id === pc.dataset.p); if (p) { dr.s = p.s; dr.e = p.e; dr.br = clone(p.br); if (!dr.br.length) withAutoBreak(dr); upd(); } return; }
      if (e.target.closest('#edAddBr')) { if (dr.e > dr.s) { dr.br.push(suggestBreak(dr)); dr.br.sort((x, y) => x.s - y.s); upd(); } return; }
      const del = e.target.closest('[data-del]');
      if (del) { dr.br.splice(+del.closest('[data-i]').dataset.i, 1); upd(); }
    });
    dlg.querySelector('.dlg-b').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save(); } });
    q('edSave').addEventListener('click', save);
    const del = q('edDel');
    if (del) del.addEventListener('click', () => {
      done = true;
      const sh = D.shifts.find(s => s.id === dr.id), m = sh && mem(sh.m);
      commit(D2 => { D2.shifts = D2.shifts.filter(s => s.id !== dr.id); }, `${m ? m.name + ' ' : ''}${sh ? dLabel(sh.d) + ' ' + fmt(sh.s) + '〜' + fmt(sh.e) + ' ' : ''}を削除しました`);
      closeDlg();
    });
    upd();
  }

  // メンバー1人（名前・課・役職と、6日間のシフト）
  function openMember(id) {
    const m = mem(id);
    if (!m) return;
    const back = () => { if (mem(id)) openMember(id); };
    const draw = () => {
      const mm = mem(id); if (!mm) { closeDlg(); return; }
      const all = D.shifts.filter(s => s.m === id);
      return `<div class="row" style="align-items:flex-end">
          <div class="fld" style="flex:2;min-width:150px"><label for="mdN">名前</label><input class="inp" id="mdN" maxlength="30" value="${esc(mm.name)}"></div>
          <div class="fld" style="flex:1;min-width:100px"><label for="mdG">課</label><select class="inp" id="mdG">${D.groups.map(g => `<option value="${g.id}"${g.id === mm.group ? ' selected' : ''}>${esc(g.name)}</option>`).join('')}</select></div>
          <div class="fld" style="flex:1;min-width:100px"><label for="mdR">役職</label><select class="inp" id="mdR">${D.roles.map(r => `<option value="${r.id}"${r.id === mm.role ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
        </div>
        <div class="kv"><span>${roleBadge(mm.role)}</span><span>6日間で <b>${all.length}</b>件</span><span>実働 <b>${hm(all.reduce((t, s) => t + workMin(s), 0))}</b></span><span>出る日 <b>${new Set(all.map(s => s.d)).size}</b>日</span></div>
        <div class="sl">${D.days.map(x => {
          const list = shiftsOf(id, x.d), cl = clashIds(list);
          return `<div class="dayrow" data-d="${x.d}"><div class="dl">${dLabel(x.d)}<small>${esc(x.label)}</small></div><div class="cs">${list.length ? list.map(s => chipHtml(s, mm, cl.has(s.id))).join('') : '<span class="none">なし</span>'}</div>` +
            `<button type="button" class="btn small" data-add="${x.d}" aria-label="${dLabel(x.d)}に追加">＋</button></div>`;
        }).join('')}</div>`;
    };
    openDlg({ title: 'メンバー', body: draw(), foot: `<button type="button" class="btn danger" id="mdDel">名簿から外す</button><span class="grow"></span><button type="button" class="btn primary" data-close>閉じる</button>`,
      refresh: () => { const b = dlg.querySelector('.dlg-b'); if (!mem(id)) { closeDlg(); return; } b.innerHTML = draw(); } });
    const b = dlg.querySelector('.dlg-b');
    b.addEventListener('change', e => {
      const t = e.target, f = { mdN: 'name', mdG: 'group', mdR: 'role' }[t.id];
      if (!f) return;
      const v = f === 'name' ? str(t.value, 30) : t.value;
      if (!v) { t.value = mem(id).name; return; }
      commit(D2 => { const x = D2.members.find(y => y.id === id); if (x) x[f] = v; }, '名簿を更新しました');
      b.innerHTML = draw();
    });
    b.addEventListener('click', e => {
      const chip = e.target.closest('.chip');
      if (chip) { const sh = D.shifts.find(s => s.id === chip.dataset.id); if (sh) { dlg._onClose = null; openShiftEditor(sh, { back }); } return; }
      const add = e.target.closest('[data-add]');
      if (add) { dlg._onClose = null; openShiftEditor(newDraft(id, add.dataset.add), { back }); }
    });
    $('mdDel').addEventListener('click', () => removeMembers([id]));
  }
  function removeMembers(ids) {
    const n = D.shifts.filter(s => ids.includes(s.m)).length, names = ids.map(i => (mem(i) || {}).name).filter(Boolean);
    if (!confirm(`${names.length === 1 ? names[0] + ' さん' : names.length + '人'}を名簿から外しますか？${n ? `\nシフト${n}件も消えます。` : ''}（「元に戻す」で戻せます）`)) return;
    commit(D2 => { D2.members = D2.members.filter(m => !ids.includes(m.id)); D2.shifts = D2.shifts.filter(s => !ids.includes(s.m)); if (!D2.members.length) D2.sample = false; },
      `${names.length === 1 ? names[0] + ' さん' : names.length + '人'}を名簿から外しました`);
    refreshOpenDlg();
  }

  // 名簿（全員）
  function guessGroup(t) {
    t = (t || '').trim();
    if (!t) return null;
    const exact = D.groups.find(g => g.name === t); if (exact) return exact.id;
    if (/gs/i.test(t)) return 'gs';
    if (/広報/.test(t)) return 'pr';
    if (/局/.test(t)) return 'hq';
    return null;
  }
  function guessRole(t) {
    t = (t || '').trim();
    if (!t) return null;
    const exact = D.roles.find(r => r.name === t); if (exact) return exact.id;
    const hit = D.roles.slice().sort((a, b) => b.name.length - a.name.length).find(r => t.includes(r.name));
    return hit ? hit.id : null;
  }
  function parseRoster(text) {
    const out = [], defG = V.grp !== 'all' ? V.grp : 'gs', defR = D.roles[D.roles.length - 1].id;
    text.split(/\r?\n/).forEach(line => {
      const cells = line.split(/\t|,|、|，/).map(x => x.trim()).filter(Boolean);
      if (!cells.length || /^(名前|氏名)$/.test(cells[0])) return;
      let g = null, r = null; const rest = [];
      cells.slice(1).forEach(c => { const gg = !g && guessGroup(c), rr = !r && guessRole(c); if (rr && (!gg || /長/.test(c))) r = rr; else if (gg) g = gg; else rest.push(c); });
      out.push({ name: str(cells[0], 30), group: g || defG, role: r || defR });
    });
    return out.filter(x => x.name);
  }
  function openRoster() {
    const draw = () => {
      const ms = sortedMembers();
      const cnt = id => D.shifts.filter(s => s.m === id).length;
      return `<div class="row"><span class="msg">名前・課・役職を変えるとすぐに保存されます。並びは「課 → 役職」の順です。</span></div>
        <div class="ed-wrap"><table class="ed"><thead><tr><th style="width:42%">名前</th><th>課</th><th>役職</th><th style="width:56px">シフト</th><th style="width:40px"></th></tr></thead><tbody>
        ${ms.map(m => `<tr data-m="${m.id}"><td><input class="inp" data-f="name" maxlength="30" value="${esc(m.name)}" aria-label="名前"></td>
          <td><select class="inp" data-f="group" aria-label="課">${D.groups.map(g => `<option value="${g.id}"${g.id === m.group ? ' selected' : ''}>${esc(g.name)}</option>`).join('')}</select></td>
          <td><select class="inp" data-f="role" aria-label="役職">${D.roles.map(r => `<option value="${r.id}"${r.id === m.role ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select></td>
          <td class="num" style="color:var(--muted);text-align:center">${cnt(m.id)}</td><td><button type="button" class="btn ghost small icon" data-rm aria-label="${esc(m.name)}を外す">×</button></td></tr>`).join('')}
        ${ms.length ? '' : '<tr><td colspan="5" class="msg" style="padding:14px">まだいません</td></tr>'}
        </tbody></table></div>
        <div class="row"><button type="button" class="btn" id="rsAdd">＋ 1人追加</button><span class="msg">全体 ${D.members.length}人（${D.groups.map(g => esc(g.name) + ' ' + D.members.filter(m => m.group === g.id).length).join('・')}）</span></div>
        <details class="fld" id="rsPasteBox"><summary class="sect" style="cursor:pointer">まとめて貼り付け <small>Excel・スプレッドシートからコピーした名簿</small></summary>
          <div class="msg" style="margin:6px 0">1行に1人。「名前, 課, 役職」の順（タブ・カンマ区切り）。課や役職を省くと「${V.grp !== 'all' ? esc(grp(V.grp).name) : esc(grp('gs').name)}」「${esc(D.roles[D.roles.length - 1].name)}」になります。</div>
          <textarea class="inp" id="rsText" placeholder="山田 太郎, GS課, 課長&#10;鈴木 花子, 広報課, 副課長&#10;佐藤 次郎, 広報課"></textarea>
          <div class="row" style="margin-top:8px"><span class="msg" id="rsPrev"></span><span style="flex:1"></span>
            <button type="button" class="btn" id="rsAppend">名簿に足す</button><button type="button" class="btn danger" id="rsReplace">名簿を置き換える</button></div>
        </details>`;
    };
    openDlg({ title: 'メンバー（名簿）', wide: true, body: draw(), foot: `${D.sample ? '<button type="button" class="btn danger" id="rsClearSample">サンプルを全部消す</button>' : ''}<span class="grow"></span><button type="button" class="btn primary" data-close>閉じる</button>`,
      refresh: () => { const b = dlg.querySelector('.dlg-b'), open = b.querySelector('#rsPasteBox')?.open, txt = b.querySelector('#rsText')?.value || ''; b.innerHTML = draw(); if (open) { b.querySelector('#rsPasteBox').open = true; b.querySelector('#rsText').value = txt; } } });
    const b = dlg.querySelector('.dlg-b');
    const redraw = () => refreshOpenDlg();
    b.addEventListener('change', e => {
      const t = e.target, tr = t.closest('tr[data-m]');
      if (!tr || !t.dataset.f) return;
      const v = t.dataset.f === 'name' ? str(t.value, 30) : t.value;
      if (!v) { redraw(); return; }
      commit(D2 => { const x = D2.members.find(y => y.id === tr.dataset.m); if (x) x[t.dataset.f] = v; });
      if (t.dataset.f !== 'name') redraw();
    });
    b.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset && e.target.dataset.f === 'name') e.target.blur(); });
    b.addEventListener('input', e => {
      if (e.target.id !== 'rsText') return;
      const rows = parseRoster(e.target.value);
      b.querySelector('#rsPrev').textContent = rows.length ? `${rows.length}人（${D.groups.map(g => g.name + ' ' + rows.filter(r => r.group === g.id).length).join('・')}）` : '';
    });
    b.addEventListener('click', e => {
      const rm = e.target.closest('[data-rm]');
      if (rm) { removeMembers([rm.closest('tr').dataset.m]); return; }
      if (e.target.id === 'rsAdd') {
        const nid = uid();
        commit(D2 => { D2.members.push({ id: nid, name: '新しいメンバー', group: V.grp !== 'all' ? V.grp : 'gs', role: D2.roles[D2.roles.length - 1].id }); });
        redraw();
        const inp = b.querySelector(`tr[data-m="${nid}"] input`); if (inp) { inp.focus(); inp.select(); inp.scrollIntoView({ block: 'center' }); }
        return;
      }
      if (e.target.id === 'rsAppend' || e.target.id === 'rsReplace') {
        const rows = parseRoster(b.querySelector('#rsText').value);
        if (!rows.length) { toast('貼り付けた名簿を読み取れませんでした'); return; }
        const rep = e.target.id === 'rsReplace';
        if (rep && !confirm(`名簿を${rows.length}人に置き換えますか？\nいまの名簿とシフト（${D.shifts.length}件）は消えます。（「元に戻す」で戻せます）`)) return;
        commit(D2 => {
          if (rep) { D2.members = []; D2.shifts = []; D2.sample = false; }
          rows.forEach(r => D2.members.push({ id: uid(), name: r.name, group: r.group, role: r.role }));
        }, `${rows.length}人を${rep ? '名簿にしました' : '名簿に足しました'}`);
        b.querySelector('#rsText').value = '';
        redraw();
      }
    });
    const cs = $('rsClearSample'); if (cs) cs.addEventListener('click', clearSample);
  }
  function clearSample() {
    if (!confirm('サンプルの名簿とシフトを全部消して、空の状態から始めますか？（「元に戻す」で戻せます）')) return;
    commit(D2 => { D2.members = []; D2.shifts = []; D2.sample = false; }, 'サンプルを消しました。「メンバー」から名簿を作ってください');
    closeDlg();
  }

  // まとめて追加（何人か × 何日か）
  function openBulk() {
    if (!D.members.length) { toast('先に「メンバー」から名簿を作ってください'); return; }
    const p0 = D.presets.find(x => x.id === V.lastPreset) || D.presets[0];
    const st = D.opt.snap;
    const dr = { s: p0 ? p0.s : 540, e: p0 ? p0.e : 1020, br: p0 ? clone(p0.br) : [], task: '' };
    const days = new Set([V.day]), pick = new Set();
    let skip = true;
    const body = `
      <div class="fld"><span class="lb">日付（いくつでも）</span><div class="dchk" id="bkD">${D.days.map(x => `<label class="${x.kind === 'fest' ? 'fest' : ''}"><input type="checkbox" value="${x.d}"${days.has(x.d) ? ' checked' : ''}>${dLabel(x.d)}</label>`).join('')}</div></div>
      <div class="fld"><span class="lb">時間</span><div class="presets" id="bkP"></div>
        <div class="row nw" style="margin-top:4px"><span class="msg">入り</span><select class="inp time" id="bkS"></select><span>〜</span><span class="msg">終わり</span><select class="inp time" id="bkE"></select></div>
        <div class="row nw"><label class="chk"><input type="checkbox" id="bkBr"> 休憩</label><select class="inp time" id="bkBs"></select><span>〜</span><select class="inp time" id="bkBe"></select></div>
        <div class="dur" id="bkDur"></div></div>
      <div class="fld"><label for="bkT">担当（持ち場）</label><input class="inp" id="bkT" list="bkTasks" maxlength="20" placeholder="空でも可"><datalist id="bkTasks">${D.tasks.map(t => `<option value="${esc(t)}">`).join('')}</datalist></div>
      <div class="fld"><span class="lb">メンバー</span><div class="mlist" id="bkM"></div></div>
      <label class="chk"><input type="checkbox" id="bkSkip" checked> その日にもうシフトがある人は飛ばす</label>`;
    openDlg({ title: 'まとめて追加', body, wide: true, foot: `<span class="msg grow" id="bkSum"></span><button type="button" class="btn" data-close>キャンセル</button><button type="button" class="btn primary" id="bkGo">追加する</button>` });
    const q = id => dlg.querySelector('#' + id);
    const hasOn = mId => [...days].some(d => D.shifts.some(s => s.m === mId && s.d === d));
    function drawMembers() {
      const sc = q('bkM').scrollTop;
      const groups = V.grp === 'all' ? D.groups : D.groups.filter(g => g.id === V.grp).concat(D.groups.filter(g => g.id !== V.grp));
      q('bkM').innerHTML = groups.map(g => {
        const ms = sortedMembers().filter(m => m.group === g.id);
        if (!ms.length) return '';
        return `<div class="gh"><span class="gdot" style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${g.color}"></span>${esc(g.name)}<span class="msg">${ms.filter(m => pick.has(m.id)).length}/${ms.length}</span>` +
          `<button type="button" class="btn small" data-all="${g.id}">全員</button><button type="button" class="btn small ghost" data-none="${g.id}">外す</button></div>` +
          ms.map(m => `<label><input type="checkbox" value="${m.id}"${pick.has(m.id) ? ' checked' : ''}>${roleBadge(m.role, true)}<span class="nm">${esc(m.name)}</span>${hasOn(m.id) ? '<span class="has">シフトあり</span>' : ''}</label>`).join('');
      }).join('');
      q('bkM').scrollTop = sc;
    }
    function upd() {
      q('bkS').innerHTML = timeOptions(dr.s, 0, DAY_MAX - st, st);
      q('bkE').innerHTML = timeOptions(dr.e, st, DAY_MAX, st);
      q('bkP').innerHTML = presetChips(dr.s, dr.e);
      const hasBr = dr.br.length > 0, b0 = dr.br[0] || suggestBreak({ s: dr.s, e: dr.e, br: [] });
      q('bkBr').checked = hasBr;
      q('bkBs').innerHTML = timeOptions(b0.s, dr.s, dr.e, st); q('bkBe').innerHTML = timeOptions(b0.e, dr.s, dr.e, st);
      q('bkBs').disabled = q('bkBe').disabled = !hasBr;
      const bad = dr.e <= dr.s || breakErrors(dr).length > 0;
      q('bkDur').innerHTML = bad ? '<span class="msg err">時間を確かめてください（終わりは入りより後、休憩は勤務時間の中）</span>' : `実働 <b>${hm(dr.e - dr.s - brMin(dr))}</b>${dr.br.length ? '' : dr.e - dr.s > 360 ? '　<span class="msg warn">6時間を超えています。休憩を入れましょう</span>' : ''}`;
      const targets = plan();
      q('bkSum').textContent = `${pick.size}人 × ${days.size}日` + (skip ? `（飛ばす分を除いて ${targets.length}件）` : ` = ${targets.length}件`);
      q('bkGo').disabled = bad || !targets.length;
    }
    function plan() {
      const out = [];
      days.forEach(d => pick.forEach(mId => { if (!(skip && D.shifts.some(s => s.m === mId && s.d === d))) out.push({ m: mId, d }); }));
      return out;
    }
    const b = dlg.querySelector('.dlg-b');
    b.addEventListener('change', e => {
      const t = e.target;
      if (t.closest('#bkD')) { if (t.checked) days.add(t.value); else days.delete(t.value); drawMembers(); }
      else if (t.closest('#bkM')) { if (t.checked) pick.add(t.value); else pick.delete(t.value); drawMembers(); }
      else if (t.id === 'bkS') { const ns = +t.value; if (dr.e <= ns) dr.e = Math.min(DAY_MAX, ns + 60); dr.s = ns; dr.br = cleanBreaks(dr.br, dr.s, dr.e); }
      else if (t.id === 'bkE') { dr.e = +t.value; dr.br = cleanBreaks(dr.br, dr.s, dr.e); }
      else if (t.id === 'bkBr') dr.br = t.checked ? [suggestBreak({ s: dr.s, e: dr.e, br: [] })] : [];
      else if (t.id === 'bkBs' || t.id === 'bkBe') { const bs = +q('bkBs').value, be = +q('bkBe').value; dr.br = [{ s: bs, e: be }]; }
      else if (t.id === 'bkSkip') skip = t.checked;
      else return;
      upd();
    });
    b.addEventListener('input', e => { if (e.target.id === 'bkT') dr.task = e.target.value; });
    b.addEventListener('click', e => {
      const pc = e.target.closest('.pchip');
      if (pc) { const p = D.presets.find(x => x.id === pc.dataset.p); if (p) { dr.s = p.s; dr.e = p.e; dr.br = clone(p.br); if (!dr.br.length) withAutoBreak(dr); V.lastPreset = p.id; upd(); } return; }
      const all = e.target.closest('[data-all]'), none = e.target.closest('[data-none]');
      if (all || none) { const gid = (all || none).dataset[all ? 'all' : 'none']; D.members.filter(m => m.group === gid).forEach(m => all ? pick.add(m.id) : pick.delete(m.id)); drawMembers(); upd(); }
    });
    q('bkGo').addEventListener('click', () => {
      const targets = plan();
      if (!targets.length || dr.e <= dr.s || breakErrors(dr).length) return;
      const rec = { s: dr.s, e: dr.e, br: cleanBreaks(dr.br, dr.s, dr.e), task: str(dr.task, 20), note: '' };
      commit(D2 => { targets.forEach(t => D2.shifts.push(Object.assign({ id: uid(), m: t.m, d: t.d }, clone(rec)))); }, `${targets.length}件のシフトを追加しました`);
      closeDlg();
    });
    drawMembers(); upd();
  }

  // この日を別の日へコピー／この日を消す
  function scopeIds() { return new Set(D.members.filter(m => V.grp === 'all' || m.group === V.grp).map(m => m.id)); }
  const scopeName = () => V.grp === 'all' ? '全体' : grp(V.grp).name;
  function openCopyDay() {
    const ids = scopeIds(), src = D.shifts.filter(s => s.d === V.day && ids.has(s.m));
    const body = `<div class="msg">${dLabel(V.day)} の <b>${esc(scopeName())}</b> のシフト ${src.length}件を、選んだ日にコピーします。</div>
      <div class="fld"><span class="lb">コピー先</span><div class="dchk" id="cpD">${D.days.filter(x => x.d !== V.day).map(x => `<label class="${x.kind === 'fest' ? 'fest' : ''}"><input type="checkbox" value="${x.d}">${dLabel(x.d)}</label>`).join('')}</div></div>
      <div class="fld"><span class="lb">コピー先にもうシフトがあるとき</span>
        <label class="chk"><input type="radio" name="cpM" value="add" checked> そのまま残して足す</label>
        <label class="chk"><input type="radio" name="cpM" value="rep"> 消してから入れる（${esc(scopeName())}の分だけ）</label></div>`;
    openDlg({ title: 'この日を別の日にコピー', body, foot: `<span class="grow"></span><button type="button" class="btn" data-close>キャンセル</button><button type="button" class="btn primary" id="cpGo"${src.length ? '' : ' disabled'}>コピーする</button>` });
    $('cpGo').addEventListener('click', () => {
      const to = [...dlg.querySelectorAll('#cpD input:checked')].map(x => x.value), rep = dlg.querySelector('input[name=cpM]:checked').value === 'rep';
      if (!to.length) { toast('コピー先の日を選んでください'); return; }
      commit(D2 => {
        if (rep) D2.shifts = D2.shifts.filter(s => !(to.includes(s.d) && ids.has(s.m)));
        to.forEach(d => src.forEach(s => D2.shifts.push(Object.assign(clone(s), { id: uid(), d }))));
      }, `${dLabel(V.day)}（${scopeName()}）を ${to.map(dLabel).join('・')} にコピーしました`);
      closeDlg();
    });
  }
  function clearDay() {
    const ids = scopeIds(), n = D.shifts.filter(s => s.d === V.day && ids.has(s.m)).length;
    if (!n) { toast('この日のシフトはありません'); return; }
    if (!confirm(`${dLabel(V.day)} の ${scopeName()} のシフト ${n}件を消しますか？（「元に戻す」で戻せます）`)) return;
    commit(D2 => { D2.shifts = D2.shifts.filter(s => !(s.d === V.day && ids.has(s.m))); }, `${dLabel(V.day)}（${scopeName()}）のシフト ${n}件を消しました`);
  }

  // 設定
  function openSettings() {
    const w = clone({ title: D.title, days: D.days, roles: D.roles, groups: D.groups, presets: D.presets, tasks: D.tasks, opt: D.opt });
    const st = () => w.opt.snap;
    const hourOpts = (sel, a, b) => { let h = ''; for (let t = a; t <= b; t += 60) h += `<option value="${t}"${t === sel ? ' selected' : ''}>${fmt(t)}</option>`; return h; };
    const draw = () => `
      <div class="fld"><label for="stTitle">表示名</label><input class="inp" id="stTitle" maxlength="30" value="${esc(w.title)}"></div>
      <div class="fld"><span class="sect">日付と区分 <small>本祭の日は白く目立たせます</small></span>
        <div class="ed-wrap"><table class="ed"><tbody>${w.days.map((x, i) => `<tr data-i="${i}"><td style="width:90px;font-weight:800">${dLabel(x.d)}</td>
          <td><input class="inp" data-f="dlabel" maxlength="12" value="${esc(x.label)}" aria-label="${dLabel(x.d)}の名前"></td>
          <td style="width:120px"><select class="inp" data-f="dkind" aria-label="${dLabel(x.d)}の区分">${KINDS.map(k => `<option value="${k[0]}"${k[0] === x.kind ? ' selected' : ''}>${k[1]}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div></div>
      <div class="fld"><span class="sect">表示と入力</span>
        <div class="row"><span class="msg">日別の表示</span><select class="inp time" id="stFrom">${hourOpts(w.opt.from, 0, 23 * 60)}</select><span>〜</span><select class="inp time" id="stTo">${hourOpts(w.opt.to, 60, DAY_MAX)}</select>
          <span class="msg">（シフトがはみ出す日は自動で広げます）</span></div>
        <div class="row"><span class="msg">時間の刻み</span><select class="inp" id="stSnap">${[5, 10, 15, 30].map(v => `<option value="${v}"${v === w.opt.snap ? ' selected' : ''}>${v}分</option>`).join('')}</select>
          <label class="chk"><input type="checkbox" id="stAuto"${w.opt.autoBreak ? ' checked' : ''}> 6時間を超えるシフトを作ると休憩を自動で入れる</label></div></div>
      <div class="fld"><span class="sect">役職 <small>上ほど上に並びます。色なし＝目立たせない</small></span>
        <div class="ed-wrap"><table class="ed"><tbody>${w.roles.map((r, i) => `<tr data-i="${i}">
          <td style="width:64px">${roleBadgeOf(r)}</td>
          <td><input class="inp" data-f="rname" maxlength="10" value="${esc(r.name)}" aria-label="役職の名前"></td>
          <td style="width:50px"><input type="color" data-f="rcolor" value="${r.color || '#8b8b95'}" aria-label="色"${r.color ? '' : ' disabled'}></td>
          <td style="width:84px"><label class="chk"><input type="checkbox" data-f="rhas"${r.color ? ' checked' : ''}> 色</label></td>
          <td style="width:92px;white-space:nowrap"><button type="button" class="btn ghost small icon" data-up aria-label="上へ"${i ? '' : ' disabled'}>↑</button><button type="button" class="btn ghost small icon" data-down aria-label="下へ"${i < w.roles.length - 1 ? '' : ' disabled'}>↓</button><button type="button" class="btn ghost small icon" data-rdel aria-label="消す"${w.roles.length > 1 ? '' : ' disabled'}>×</button></td></tr>`).join('')}</tbody></table></div>
        <div class="row"><button type="button" class="btn small" id="stAddRole">＋ 役職を追加</button></div></div>
      <div class="fld"><span class="sect">課</span>
        <div class="ed-wrap"><table class="ed"><tbody>${w.groups.map((g, i) => `<tr data-i="${i}"><td><input class="inp" data-f="gname" maxlength="12" value="${esc(g.name)}" aria-label="課の名前"></td>
          <td style="width:50px"><input type="color" data-f="gcolor" value="${g.color}" aria-label="色"></td></tr>`).join('')}</tbody></table></div></div>
      <div class="fld"><span class="sect">定型の時間 <small>追加・まとめて追加で一発で選べます</small></span>
        <div class="ed-wrap"><table class="ed"><thead><tr><th>名前</th><th>入り</th><th>終わり</th><th>休憩</th><th></th></tr></thead><tbody>${w.presets.map((p, i) => `<tr data-i="${i}">
          <td><input class="inp" data-f="pname" maxlength="10" value="${esc(p.name)}" aria-label="名前"></td>
          <td><select class="inp time" data-f="ps">${timeOptions(p.s, 0, DAY_MAX - st(), st())}</select></td>
          <td><select class="inp time" data-f="pe">${timeOptions(p.e, st(), DAY_MAX, st())}</select></td>
          <td style="white-space:nowrap"><select class="inp time" data-f="pbs" aria-label="休憩の始まり"><option value="">なし</option>${timeOptions(p.br[0] ? p.br[0].s : null, p.s, p.e, st())}</select>
            <select class="inp time" data-f="pbe" aria-label="休憩の終わり"${p.br[0] ? '' : ' disabled'}>${p.br[0] ? timeOptions(p.br[0].e, p.s, p.e, st()) : '<option>—</option>'}</select></td>
          <td><button type="button" class="btn ghost small icon" data-pdel aria-label="消す">×</button></td></tr>`).join('')}</tbody></table></div>
        <div class="row"><button type="button" class="btn small" id="stAddPreset">＋ 定型を追加</button><span class="msg err" id="stPErr"></span></div></div>
      <div class="fld"><label for="stTasks" class="sect">担当（持ち場）の候補 <small>1行に1つ</small></label><textarea class="inp" id="stTasks" style="min-height:90px">${esc(w.tasks.join('\n'))}</textarea></div>`;
    function roleBadgeOf(r) { return r.color ? `<span class="rb sm" style="background:${r.color};color:#000">${esc(r.name)}</span>` : `<span class="rb none sm">${esc(r.name)}</span>`; }
    openDlg({ title: '設定', wide: true, body: draw(), foot: `<span class="grow"></span><button type="button" class="btn" data-close>キャンセル</button><button type="button" class="btn primary" id="stSave">保存する</button>` });
    const b = dlg.querySelector('.dlg-b');
    const redraw = () => { const sc = b.scrollTop; b.innerHTML = draw(); b.scrollTop = sc; };
    b.addEventListener('input', e => {
      const t = e.target, i = +(t.closest('[data-i]') || {}).dataset?.i, f = t.dataset.f;
      if (t.id === 'stTitle') w.title = t.value;
      else if (t.id === 'stTasks') w.tasks = t.value.split(/\r?\n/);
      else if (f === 'dlabel') w.days[i].label = t.value;
      else if (f === 'rname') w.roles[i].name = t.value;
      else if (f === 'gname') w.groups[i].name = t.value;
      else if (f === 'pname') w.presets[i].name = t.value;
      else if (f === 'rcolor') { w.roles[i].color = t.value; const bd = t.closest('tr').querySelector('.rb'); if (bd) bd.style.background = t.value; }
      else if (f === 'gcolor') w.groups[i].color = t.value;
    });
    b.addEventListener('change', e => {
      const t = e.target, i = +(t.closest('[data-i]') || {}).dataset?.i, f = t.dataset.f;
      if (f === 'dkind') w.days[i].kind = t.value;
      else if (f === 'rhas') { w.roles[i].color = t.checked ? (w.roles[i]._c || '#8b8b95') : ''; redraw(); }
      else if (f === 'rcolor') { w.roles[i]._c = t.value; redraw(); }
      else if (f === 'ps' || f === 'pe') { const p = w.presets[i]; p[f === 'ps' ? 's' : 'e'] = +t.value; if (p.e <= p.s) p.e = Math.min(DAY_MAX, p.s + 60); p.br = cleanBreaks(p.br, p.s, p.e); redraw(); }
      else if (f === 'pbs') { const p = w.presets[i]; if (t.value === '') p.br = []; else { const s = +t.value; p.br = [{ s, e: Math.min(p.e, Math.max(s + st(), p.br[0] ? p.br[0].e : s + 45)) }]; } redraw(); }
      else if (f === 'pbe') { const p = w.presets[i]; if (p.br[0]) p.br[0].e = +t.value; redraw(); }
      else if (t.id === 'stFrom') w.opt.from = +t.value;
      else if (t.id === 'stTo') w.opt.to = +t.value;
      else if (t.id === 'stSnap') { w.opt.snap = +t.value; redraw(); }
      else if (t.id === 'stAuto') w.opt.autoBreak = t.checked;
    });
    b.addEventListener('click', e => {
      const tr = e.target.closest('[data-i]'), i = tr ? +tr.dataset.i : -1;
      if (e.target.closest('[data-up]') && i > 0) { const r = w.roles.splice(i, 1)[0]; w.roles.splice(i - 1, 0, r); redraw(); }
      else if (e.target.closest('[data-down]') && i < w.roles.length - 1) { const r = w.roles.splice(i, 1)[0]; w.roles.splice(i + 1, 0, r); redraw(); }
      else if (e.target.closest('[data-rdel]') && w.roles.length > 1) {
        const r = w.roles[i], n = D.members.filter(m => m.role === r.id).length;
        if (n && !confirm(`「${r.name}」の ${n}人は「${w.roles[w.roles.length - 1 === i ? w.roles.length - 2 : w.roles.length - 1].name}」になります。消しますか？`)) return;
        w.roles.splice(i, 1); redraw();
      }
      else if (e.target.closest('[data-pdel]')) { w.presets.splice(i, 1); redraw(); }
      else if (e.target.id === 'stAddRole') { w.roles.splice(Math.max(0, w.roles.length - 1), 0, { id: 'r' + uid(), name: '新しい役職', color: '#22c55e' }); redraw(); }
      else if (e.target.id === 'stAddPreset') { w.presets.push({ id: 'p' + uid(), name: '新しい定型', s: 540, e: 1020, br: [{ s: 720, e: 765 }] }); redraw(); }
    });
    $('stSave').addEventListener('click', () => {
      if (w.opt.to <= w.opt.from) { toast('表示の終わりは始まりより後にしてください'); return; }
      if (w.roles.some(r => !str(r.name, 10)) || w.presets.some(p => !str(p.name, 10))) { toast('役職と定型の名前を入れてください'); return; }
      const keep = new Set(w.roles.map(r => r.id)), fb = w.roles[w.roles.length - 1].id;
      commit(D2 => {
        D2.title = w.title; D2.days = w.days; D2.groups = w.groups; D2.presets = w.presets; D2.opt = w.opt;
        D2.roles = w.roles.map(r => ({ id: r.id, name: r.name, color: r.color }));
        D2.tasks = w.tasks;
        D2.members.forEach(m => { if (!keep.has(m.role)) m.role = fb; });
      }, '設定を保存しました');
      closeDlg();
    });
  }

  // ---------- 書き出し・読み込み ----------
  function stamp() { const n = jstNow(), d = new Date(Date.now() + 9 * 3600000); return n.ymd.replace(/-/g, '') + '-' + String(d.getUTCHours()).padStart(2, '0') + String(d.getUTCMinutes()).padStart(2, '0'); }
  function download(name, text, type) {
    const blob = new Blob([text], { type }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function exportJson() { download(`shift-${stamp()}.json`, JSON.stringify(Object.assign({ app: 'tabi-map-shift' }, D), null, 1), 'application/json'); toast('JSONを書き出しました（ほかの端末で「読み込み」できます）'); }
  function exportCsv() {
    const q = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const order = new Map(sortedMembers().map((m, i) => [m.id, i])), di = new Map(D.days.map((x, i) => [x.d, i]));
    const rows = [['日付', '曜日', '日の名前', '課', '役職', '名前', '入り', '終わり', '休憩', '休憩(分)', '実働(分)', '実働(時間)', '担当', 'メモ']];
    D.shifts.slice().sort((a, b) => di.get(a.d) - di.get(b.d) || order.get(a.m) - order.get(b.m) || a.s - b.s).forEach(s => {
      const m = mem(s.m), x = dayOf(s.d), p = dParts(s.d);
      rows.push([s.d, WD[p.w], x.label, grp(m.group).name, role(m.role).name, m.name, fmt2(s.s), fmt2(s.e), s.br.map(b => fmt2(b.s) + '-' + fmt2(b.e)).join(' / '), brMin(s), workMin(s), (workMin(s) / 60).toFixed(2), s.task, s.note]);
    });
    download(`shift-${stamp()}.csv`, '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n'), 'text/csv');
    toast('CSVを書き出しました（Excelで開けます）');
  }
  $('fileIn').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      let j; try { j = JSON.parse(rd.result); } catch (err) { toast('JSONとして読めませんでした', { err: true }); return; }
      if (!j || !Array.isArray(j.members) || !Array.isArray(j.shifts)) { toast('シフトのファイルではないようです', { err: true }); return; }
      const n = normalize(j);
      if (!confirm(`読み込むと、いまの名簿とシフトは置き換わります。\n読み込む内容：${n.members.length}人・シフト${n.shifts.length}件（「元に戻す」で戻せます）`)) return;
      commit(D2 => { Object.keys(D2).forEach(k => delete D2[k]); Object.assign(D2, n, { sample: false }); }, `${n.members.length}人・シフト${n.shifts.length}件を読み込みました`);
    };
    rd.readAsText(f);
  });

  // ---------- メニュー ----------
  const menu = $('menu');
  function openMenu(anchor) {
    const items = [
      ['bulk', 'まとめて追加…'],
      V.view === 'day' ? ['copy', 'この日を別の日にコピー…', dLabel(V.day)] : null,
      V.view === 'day' ? ['clear', 'この日のシフトを消す…', scopeName(), 'danger'] : null,
      '-',
      ['json', '書き出し（JSON・控え）'], ['import', '読み込み（JSON）'], ['csv', 'Excel用に書き出し（CSV）'], ['print', '印刷'],
      '-',
      ['settings', '設定…'], ['sample', 'サンプルを読み込む'], ['reset', 'すべて消す…', '', 'danger'],
    ].filter(Boolean);
    menu.innerHTML = items.map(x => x === '-' ? '<hr>' : `<button type="button" role="menuitem" data-a="${x[0]}" class="${x[3] || ''}">${x[1]}${x[2] ? `<small>${esc(x[2])}</small>` : ''}</button>`).join('');
    menu.hidden = false;
    const r = anchor.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = clamp(r.right - mw, 8, innerWidth - mw - 8) + 'px';
    menu.style.top = clamp(r.bottom + 6, 8, innerHeight - mh - 8) + 'px';
    const first = menu.querySelector('button'); if (first) first.focus();
  }
  const closeMenu = () => { menu.hidden = true; };
  menu.addEventListener('click', e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    closeMenu();
    const a = b.dataset.a;
    if (a === 'bulk') openBulk();
    else if (a === 'copy') openCopyDay();
    else if (a === 'clear') clearDay();
    else if (a === 'json') exportJson();
    else if (a === 'import') $('fileIn').click();
    else if (a === 'csv') exportCsv();
    else if (a === 'print') window.print();
    else if (a === 'settings') openSettings();
    else if (a === 'sample') { if (confirm('サンプル（架空の50人）を読み込みますか？\nいまの名簿とシフトは置き換わります。（「元に戻す」で戻せます）')) { const s = sampleData(); commit(D2 => { Object.keys(D2).forEach(k => delete D2[k]); Object.assign(D2, s); }, 'サンプルを読み込みました'); } }
    else if (a === 'reset') { if (confirm('名簿とシフトをすべて消しますか？（設定は残ります。「元に戻す」で戻せます）')) commit(D2 => { D2.members = []; D2.shifts = []; D2.sample = false; }, 'すべて消しました'); }
  });
  document.addEventListener('pointerdown', e => { if (!menu.hidden && !menu.contains(e.target) && e.target.id !== 'btnMenu') closeMenu(); });

  // ---------- お知らせ ----------
  let toastT = null;
  function toast(msg, o) {
    o = o || {};
    const t = $('toast');
    t.className = 'toast' + (o.err ? ' err' : '');
    t.innerHTML = `<span>${esc(msg)}</span>${o.undo ? '<button type="button" class="btn small" id="toastUndo">元に戻す</button>' : ''}`;
    t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, o.ms || (o.undo ? 5000 : 2600));
    const u = $('toastUndo'); if (u) u.addEventListener('click', () => { t.hidden = true; undo(); });
  }

  // ---------- つなぐ ----------
  function bind() {
    $('viewSeg').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) { V.view = b.dataset.view; render(); } });
    $('grpSeg').addEventListener('click', e => { const b = e.target.closest('[data-g]'); if (b) { V.grp = b.dataset.g; render(); } });
    $('dayTabs').addEventListener('click', e => { const b = e.target.closest('[data-d]'); if (b) { V.day = b.dataset.d; render(); b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } });
    $('colorSeg').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (b) { V.colorBy = b.dataset.c; render(); } });
    $('optHideEmpty').addEventListener('change', e => { V.hideEmpty = e.target.checked; render(); });
    $('q').addEventListener('input', e => { V.q = e.target.value; render(); });
    $('zoomIn').addEventListener('click', () => { V.hourPx = clamp(Math.round((G ? G.hp : 60) * 1.25), 20, 320); render(); });
    $('zoomOut').addEventListener('click', () => { V.hourPx = clamp(Math.round((G ? G.hp : 60) / 1.25), 20, 320); render(); });
    $('zoomFit').addEventListener('click', () => { V.hourPx = null; render(); });
    $('btnAdd').addEventListener('click', () => {
      if (!D.members.length) { openRoster(); return; }
      const first = visibleMembers()[0] || sortedMembers()[0];
      openShiftEditor(newDraft(first.id, V.day));
    });
    $('btnBulk').addEventListener('click', openBulk);
    $('btnMembers').addEventListener('click', openRoster);
    $('btnMenu').addEventListener('click', e => { if (menu.hidden) openMenu(e.currentTarget); else closeMenu(); });
    $('btnUndo').addEventListener('click', undo);
    $('btnRedo').addEventListener('click', redo);
    $('btnClearSample').addEventListener('click', clearSample);
    $('btnHideNote').addEventListener('click', () => { noteHidden = true; render(); });
    $('weekView').addEventListener('click', e => {
      const th = e.target.closest('th[data-d]');
      if (th) { V.day = th.dataset.d; V.view = 'day'; render(); return; }
      const gh = e.target.closest('tr.gh');
      if (gh) { V.collapsed[gh.dataset.g] = !V.collapsed[gh.dataset.g]; render(); return; }
      const nm = e.target.closest('.tl-name[data-m]');
      if (nm) { openMember(nm.dataset.m); return; }
      const chip = e.target.closest('.chip');
      if (chip) { const sh = D.shifts.find(s => s.id === chip.dataset.id); if (sh) openShiftEditor(sh); return; }
      const cell = e.target.closest('td.cell');
      if (cell) openShiftEditor(newDraft(cell.closest('tr').dataset.m, cell.dataset.d));
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !menu.hidden) { closeMenu(); return; }
      if (dlg.open) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); }
    });
    let rt = null, lastW = innerWidth;   // スマホのアドレスバーの出入り（高さだけの変化）では描き直さない
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (drag || innerWidth === lastW) return; lastW = innerWidth; render(); }, 120); });
    // ほかのタブで変えたら取り込む
    window.addEventListener('storage', e => {
      if (e.key !== STORE_KEY || !e.newValue) return;
      try { D = normalize(JSON.parse(e.newValue)); undoS = []; redoS = []; render(); refreshOpenDlg(); toast('ほかのタブでの変更を反映しました'); } catch (err) {}
    });
    // 今の時刻の線（1分ごと）
    setInterval(() => { if (!drag && !dlg.open && V.view === 'day' && dayOf(jstNow().ymd)) render(); }, 60000);
  }

  D = loadData();
  V = loadView();
  bind();
  render();
  if (!localStorageHas()) save();
  function localStorageHas() { try { return !!localStorage.getItem(STORE_KEY); } catch (e) { return false; } }
  window.shiftApp = { get data() { return D; }, render };   // 動作確認用
})();
