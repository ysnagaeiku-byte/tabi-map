// 渉外局 シフト管理（たびマップ 本祭支援ツールに入れる予定の機能を、先に単独のサイトとして試すもの）
//  - 期間は 11/4〜11/9 の6日間（準準備日・準備日・本祭3日間・片付け日）。GS課・広報課を分けて、または全体で見られる
//    広報課は 局長・３年 を上に、その下を部署（情宣・出版）に分けて並べる
//  - 日別：横＝時刻（6:00〜24:00）、縦＝メンバー。棒＝シフト（色と文字＝持ち場）、左端＝入り、右端＝終わり、斜線＝休憩
//    いちばん上にイベント（会場ごとの行）。名前の左に役職（局長・３年・主任・上級）の小さなバッジ。「シフト不可」のような持ち場は人数に数えない
//    空いている所をドラッグ（スマホはタップ）で追加、棒をドラッグで移動・別の人へ、端をドラッグで時間を変更。縦・横とも縮められる
//  - 6日間：メンバー×日付の一覧。入り〜終わり・休憩・持ち場を1マスに
//  - データの言葉：roles＝役職（人ごと）、duties＝持ち場（シフトごと。当番表の色）、events＝イベント、groups[].subs＝部署
//  - 名簿とシフトはこの端末（localStorage）にだけ保存。JSONで書き出し・読み込み、Excel用のCSV、印刷
//    リポジトリは公開なので、実際の名簿はコードに書かない（初回は架空の名前のサンプルを表示）
(function () {
  'use strict';

  // 保存の場所は版ごとに分ける（前の版を開いたままのタブが、新しい形のデータを書きつぶさないように）。前の版の場所は移すときに読むだけで、消さずに控えとして残す
  const STORE_KEY = 'shift_v3', VIEW_KEY = 'shift_view_v3';
  const OLD_STORE_KEYS = ['shift_v2', 'shift_v1'], OLD_VIEW_KEYS = ['shift_view_v2', 'shift_view_v1'];
  const DATA_V = 3;     // 3：役職を 局長・３年・主任・上級・なし に、広報課に部署（情宣・出版）、イベント。2 と 1 のデータは normalize で移す
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const DAY_MAX = 24 * 60;
  const HIST_MAX = 80;
  const KINDS = [['prep', '準備'], ['fest', '本祭'], ['post', '片付け']];

  const DEF_DAYS = [
    { d: '2026-11-04', label: '準準備日', kind: 'prep' },
    { d: '2026-11-05', label: '準備日', kind: 'prep' },
    { d: '2026-11-06', label: '本祭1日目', kind: 'fest' },
    { d: '2026-11-07', label: '本祭2日目', kind: 'fest' },
    { d: '2026-11-08', label: '本祭3日目', kind: 'fest' },
    { d: '2026-11-09', label: '片付け日', kind: 'post' },
  ];
  const V1_DAYS = ['準備', '準備', '前日準備', '本祭1日目', '本祭2日目', '片付け'];   // 1 の既定（変えていなければ新しい既定に置き換える）
  // 課。subs＝部署（広報課の情宣・出版）。役職が「部署の上」（局長・３年）の人は部署に分けずに上に並べる
  const DEF_GROUPS = [
    { id: 'gs', name: 'GS課', color: '#2dd4bf', subs: [] },
    { id: 'pr', name: '広報課', color: '#a78bfa', subs: [{ id: 'jo', name: '情宣' }, { id: 'sh', name: '出版' }] },
  ];
  // 役職（人ごと）。並び順＝表示の順（局長＞３年＞主任＞上級＞なし）。色なし＝バッジを出さない。top＝部署の上に並べる
  const DEF_ROLES = [
    { id: 'kyokucho', name: '局長', color: '#f5b301', top: true },
    { id: 'sannen', name: '３年', color: '#ff8a1f', top: true },
    { id: 'shunin', name: '主任', color: '#ff4d4d' },
    { id: 'joukyu', name: '上級', color: '#4f8cff' },
    { id: 'nashi', name: 'なし', color: '' },
  ];
  // 前の版の役職（立場）→ 新しい役職
  const OLD_ROLE_MAP = { kyokucho: 'kyokucho', fukukyokucho: 'sannen', kacho: 'shunin', fukukacho: 'shunin', hancho: 'joukyu', ippan: 'nashi' };
  // 持ち場（シフトごと）：渉外局の当番表の「素材」と「完成版」にある名前と色。off＝人数に数えない（シフト不可など）
  const DEF_DUTIES = [
    { id: 'd01', name: '一体 警備', color: '#b4c7e7' },
    { id: 'd02', name: '一体 司会', color: '#4472c4' },
    { id: 'd03', name: '一体 照明', color: '#8fd3f0' },
    { id: 'd04', name: '5号館 案内警備', color: '#fde4a8' },
    { id: 'd05', name: '10芝 司会照明', color: '#6aa84f' },
    { id: 'd06', name: '9号館 警備', color: '#f3f06a' },
    { id: 'd07', name: '10芝 警備', color: '#e01e1e' },
    { id: 'd08', name: '10芝 開会式', color: '#990000' },
    { id: 'd09', name: '場所自由 撮影', color: '#0b5394' },
    { id: 'd10', name: '10号館 おみくじ', color: '#d9ead3' },
    { id: 'd11', name: '10号館 パンフ', color: '#a9d08e' },
    { id: 'd12', name: '2号館 パンフ', color: '#f4928c' },
    { id: 'd13', name: '5号館 外警備', color: '#ffd966' },
    { id: 'd14', name: '10号館 控え室 警備', color: '#ffff3c' },
    { id: 'd15', name: '協賛', color: '#8e7cc3' },
    { id: 'd16', name: '撮影', color: '#7f7f7f' },
    { id: 'd17', name: '10号館 控室準備', color: '#e3e3e3' },
    { id: 'd18', name: '5号館 内警備', color: '#ffe599' },
    { id: 'd19', name: '10号館 案内警備', color: '#fff35c' },
    { id: 'd20', name: '一体 内警備', color: '#c9daf8' },
    { id: 'd21', name: '一体 入口警備', color: '#a4c2f4' },
    { id: 'd22', name: '一体 物販警備', color: '#9fc5e8' },
    { id: 'd23', name: '5号館 控室準備', color: '#f3f3f3' },
    { id: 'd24', name: '5号館 控室片付け', color: '#f9cb9c' },
    { id: 'd25', name: '10号館 控室片付け', color: '#fff2a8' },
    { id: 'd26', name: 'F（フリー）', color: '#ffffff' },
    { id: 'd27', name: '音響照明 搬入', color: '#d9d9d9' },
    { id: 'off', name: 'シフト不可', color: '#000000', off: true },
  ];
  const V3_DUTY_IDS = ['d18', 'd19', 'd20', 'd21', 'd22', 'd23', 'd24', 'd25', 'd26', 'd27'];   // 3 で足した持ち場（前の版のデータにも足す）
  const DEF_PRESETS = [
    { id: 'p1', name: '早番', s: 480, e: 780, br: [] },
    { id: 'p2', name: '遅番', s: 780, e: 1110, br: [] },
    { id: 'p3', name: '通し', s: 510, e: 1080, br: [{ s: 720, e: 780 }] },
    { id: 'p4', name: '午前', s: 540, e: 720, br: [] },
    { id: 'p5', name: '午後', s: 780, e: 1020, br: [] },
    { id: 'p6', name: '夕方', s: 1020, e: 1260, br: [] },
  ];
  const DEF_OPT = { from: 360, to: 1440, snap: 15, autoBreak: true };   // 日別の表示は 6:00〜24:00
  // イベントの区分（会場の行）の並び。ここにない区分はあとに名前順。空＝「全体」
  const EV_CATS = ['', '10芝', '一体', '出店', 'その他'];
  const EV_COLORS = ['#fce5cd', '#f4cccc', '#fff2cc', '#d9ead3', '#cfe2f3', '#d9d2e9', '#d9d9d9', '#ffffff'];
  const ROW_STEPS = [20, 24, 28, 32, 36, 44, 52, 60];   // 日別の1行の高さ（縦の縮尺）

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
  // 読み込んだファイルは信用しない：id は英数字・-・_ だけ（HTML や CSS のセレクタにそのまま入るため）。合わないものは振り直して参照もつけ替える
  const okId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v);
  const isObj = v => !!v && typeof v === 'object';
  const nk = v => String(v == null ? '' : v).normalize('NFKC');   // 全角・半角の違いをならす（３年＝3年）
  function cleanBreaks(br, s, e) {
    const out = (Array.isArray(br) ? br : []).filter(isObj).map(b => ({ s: Math.max(s, Math.round(+b.s)), e: Math.min(e, Math.round(+b.e)) }))
      .filter(b => isFinite(b.s) && isFinite(b.e) && b.e > b.s).sort((x, y) => x.s - y.s);
    const m = [];
    out.forEach(b => { const l = m[m.length - 1]; if (l && b.s <= l.e) l.e = Math.max(l.e, b.e); else m.push(b); });
    return m;
  }
  function validYmd(v) { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false; const [y, m, d] = v.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCMonth() === m - 1 && t.getUTCDate() === d; }
  function normalize(src) {
    const d = isObj(src) ? src : {};
    const ver = d.v === 3 ? 3 : d.v === 2 ? 2 : 1;    // 1＝局あり・担当は自由な文字、2＝立場（課長など）と役職（シフトごと）
    const o = { v: DATA_V, title: str(d.title, 30) || '渉外局 シフト', sample: !!d.sample };
    const dayIn = Array.isArray(d.days) ? d.days.filter(x => isObj(x) && validYmd(x.d)).filter((x, i, a) => a.findIndex(y => y.d === x.d) === i) : [];
    o.days = (dayIn.length ? dayIn : DEF_DAYS).map(x => ({ d: x.d, label: str(x.label, 12), kind: KINDS.some(k => k[0] === x.kind) ? x.kind : 'prep' }));
    // 1 から：11/4〜9 の区分は新しい日程に（11/6〜8 が本祭）。名前は 1 の既定のままなら新しい名前、自分で付けた名前は残す
    if (ver === 1) o.days.forEach(x => { const i = DEF_DAYS.findIndex(y => y.d === x.d); if (i < 0) return; x.kind = DEF_DAYS[i].kind; if (!x.label || x.label === V1_DAYS[i]) x.label = DEF_DAYS[i].label; });
    const gIn = Array.isArray(d.groups) ? d.groups.filter(isObj) : [];
    o.groups = DEF_GROUPS.map(g => {
      const x = gIn.find(y => y.id === g.id) || {}, xs = Array.isArray(x.subs) ? x.subs.filter(isObj) : [];
      return { id: g.id, name: str(x.name, 12) || g.name, color: isHex(x.color) ? x.color : g.color, subs: g.subs.map(sb => ({ id: sb.id, name: str((xs.find(y => y.id === sb.id) || {}).name, 10) || sb.name })) };
    });
    // 役職（前の版の 局長・副局長・課長・副課長・班長・一般 は、新しい役職に置き換え。自分で足した役職は「なし」の上に残す）
    let rIn = Array.isArray(d.roles) ? d.roles.filter(r => isObj(r) && r.id != null && str(r.name, 10)) : [];
    if (ver < 3) {
      const custom = rIn.filter(r => !(String(r.id) in OLD_ROLE_MAP) && !DEF_ROLES.some(x => x.id === r.id));
      rIn = DEF_ROLES.slice(0, -1).concat(custom, DEF_ROLES.slice(-1));
    }
    const rMap = new Map();
    o.roles = [];
    (rIn.length ? rIn : DEF_ROLES).forEach(r => {
      const key = String(r.id); if (rMap.has(key)) return;
      const id = okId(r.id) && !o.roles.some(x => x.id === r.id) ? r.id : 'r' + uid();
      rMap.set(key, id); o.roles.push({ id, name: str(r.name, 10), color: isHex(r.color) ? r.color : '', top: !!r.top });
    });
    // 持ち場
    let uIn = Array.isArray(d.duties) ? d.duties.filter(u => isObj(u) && u.id != null && str(u.name, 20)) : ver === 1 ? DEF_DUTIES : [];
    if (ver === 2) uIn = uIn.concat(DEF_DUTIES.filter(x => V3_DUTY_IDS.includes(x.id) && !uIn.some(u => u.id === x.id || str(u.name, 20) === x.name)));
    const uMap = new Map();
    o.duties = [];
    uIn.forEach(u => {
      const key = String(u.id); if (uMap.has(key)) return;
      const id = okId(u.id) && !o.duties.some(x => x.id === u.id) ? u.id : 'u' + uid();
      uMap.set(key, id); o.duties.push({ id, name: str(u.name, 20), color: isHex(u.color) ? u.color.toLowerCase() : '#8b8b95', off: !!u.off });
    });
    const MIG_COL = ['#94a3b8', '#f9a8d4', '#86efac', '#fdba74', '#93c5fd', '#c4b5fd', '#5eead4', '#fde047', '#fca5a5', '#a3e635'];
    let migN = 0;
    const dutyByName = name => {
      const key = name.replace(/[\s　]/g, '');
      let u = o.duties.find(x => x.name.replace(/[\s　]/g, '') === key);
      if (!u) { u = { id: 'u' + uid(), name, color: MIG_COL[migN++ % MIG_COL.length], off: false }; o.duties.push(u); }
      return u.id;
    };
    const pIn = Array.isArray(d.presets) ? d.presets.filter(isObj) : DEF_PRESETS;
    o.presets = [];
    pIn.forEach(p => {
      const ps = Math.round(+p.s), pe = Math.round(+p.e), name = str(p.name, 10);
      if (!name || !isFinite(ps) || !isFinite(pe) || ps < 0 || pe > DAY_MAX || pe <= ps) return;
      const id = okId(p.id) && !o.presets.some(x => x.id === p.id) ? p.id : 'p' + uid();
      o.presets.push({ id, name, s: ps, e: pe, br: cleanBreaks(p.br, ps, pe) });
    });
    const op = isObj(d.opt) ? d.opt : {};
    o.opt = {
      from: [op.from].map(Number).filter(v => isFinite(v) && v >= 0 && v < DAY_MAX && v % 60 === 0)[0] ?? DEF_OPT.from,
      to: [op.to].map(Number).filter(v => isFinite(v) && v > 0 && v <= DAY_MAX && v % 60 === 0)[0] ?? DEF_OPT.to,
      snap: [5, 10, 15, 30].includes(+op.snap) ? +op.snap : DEF_OPT.snap,
      autoBreak: op.autoBreak !== false,
    };
    if (ver === 1) { o.opt.from = Math.min(o.opt.from, DEF_OPT.from); o.opt.to = DEF_OPT.to; }   // 1 から：日別の表示は 6:00〜24:00 を含むように
    if (o.opt.to <= o.opt.from) { o.opt.from = DEF_OPT.from; o.opt.to = DEF_OPT.to; }
    const gIds = o.groups.map(g => g.id), rIds = o.roles.map(r => r.id), fallbackRole = rIds[rIds.length - 1];
    const mMap = new Map();
    o.members = [];
    (Array.isArray(d.members) ? d.members : []).filter(m => isObj(m) && m.id != null).forEach(m => {
      const key = String(m.id); if (mMap.has(key)) return;
      const id = okId(m.id) && !o.members.some(x => x.id === m.id) ? m.id : 'm' + uid();
      mMap.set(key, id);
      const rr = rMap.get(String(ver < 3 && String(m.role) in OLD_ROLE_MAP ? OLD_ROLE_MAP[m.role] : m.role));
      const group = gIds.includes(m.group) ? m.group : 'gs', g = o.groups.find(x => x.id === group);
      o.members.push({ id, name: str(m.name, 30) || '（名前なし）', group, sub: g.subs.some(sb => sb.id === m.sub) ? m.sub : '', role: rr && rIds.includes(rr) ? rr : fallbackRole, note: str(m.note, 60) });
    });
    const dIds = new Set(o.days.map(x => x.d)), seenS = new Set();
    o.shifts = [];
    (Array.isArray(d.shifts) ? d.shifts : []).filter(isObj).forEach(sh => {
      const m = mMap.get(String(sh.m)), a = clamp(Math.round(+sh.s), 0, DAY_MAX), b = clamp(Math.round(+sh.e), 0, DAY_MAX);
      if (!m || !dIds.has(sh.d) || !isFinite(a) || !isFinite(b) || b <= a) return;
      const id = okId(sh.id) && !seenS.has(sh.id) ? sh.id : 's' + uid();
      seenS.add(id);
      // 持ち場：1 の「担当」（自由な文字）は、同じ名前の持ち場に（なければ足す）
      const du = sh.duty != null && uMap.has(String(sh.duty)) ? uMap.get(String(sh.duty)) : ver === 1 && str(sh.task, 20) ? dutyByName(str(sh.task, 20)) : '';
      o.shifts.push({ id, m, d: sh.d, s: a, e: b, br: cleanBreaks(sh.br, a, b), duty: du, note: str(sh.note, 80) });
    });
    // イベント：s＝始まり、e＝終わり（s と同じなら時刻だけ）、cat＝区分（会場の行）、line＝表の上から下まで線を引く
    const seenE = new Set();
    o.events = [];
    (Array.isArray(d.events) ? d.events : []).filter(isObj).forEach(ev => {
      const a = clamp(Math.round(+ev.s), 0, DAY_MAX), b = clamp(Math.round(+(ev.e == null ? ev.s : ev.e)), 0, DAY_MAX), name = str(ev.name, 24);
      if (!name || !dIds.has(ev.d) || !isFinite(a) || !isFinite(b) || b < a) return;
      const id = okId(ev.id) && !seenE.has(ev.id) ? ev.id : 'e' + uid();
      seenE.add(id);
      o.events.push({ id, d: ev.d, s: a, e: b, name, cat: str(ev.cat, 10), color: isHex(ev.color) ? ev.color.toLowerCase() : EV_COLORS[0], line: !!ev.line, note: str(ev.note, 60) });
    });
    return o;
  }
  const brMin = sh => sh.br.reduce((t, b) => t + (b.e - b.s), 0);
  const workMin = sh => (sh.e - sh.s) - brMin(sh);
  // 持ち場が「人数に数えない」（シフト不可など）のものは、シフト中の人数・延べ時間・入る人に入れない
  const dutyOf = id => (id && D.duties.find(u => u.id === id)) || null;
  const isOff = sh => { const u = dutyOf(sh.duty); return !!(u && u.off); };
  const onMin = sh => isOff(sh) ? 0 : workMin(sh);

  // ---------- サンプル（架空の名前。渉外局の当番表の完成版を参考に、時刻や名前はぼかしてある） ----------
  const SUR = ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤', '吉田', '山田', '佐々木', '山口', '松本', '井上', '木村', '林', '斎藤', '清水',
    '山崎', '森', '池田', '橋本', '阿部', '石川', '山下', '中島', '石井', '小川', '前田', '岡田', '長谷川', '藤田', '後藤', '近藤', '村上', '遠藤', '青木', '坂本',
    '福田', '太田', '西村', '藤井', '金子', '岡本', '藤原', '中野', '三浦', '原田'];
  const GIV = ['翔太', '陽菜', '蓮', '結衣', '湊', '葵', '大和', '美咲', '悠真', 'さくら', '陸', '凛', '颯太', '芽依', '樹', '心春', '海斗', '七海', '蒼', '結菜',
    '大輝', '花音', '拓海', '彩花', '健太', '優奈', '直樹', '真央', '亮', '莉子', '航', '紗希', '優斗', '楓', '隼', '千尋', '涼', '美月', '奏太', 'ひなた',
    '俊介', '愛子', '和也', '杏', '雄大', '舞', '光', '茜', '誠', '桃子'];
  const sampleName = i => SUR[i] + ' ' + GIV[(i * 7 + 3) % GIV.length];   // 前の版のサンプルも同じ名前
  function sampleData() {
    // 当番表の列の人数に合わせる：GS（３年2・２年5・１年11）、広報（局長1・３年2、情宣 ２年6・１年8、出版 ２年6・１年6）
    const plan = [['gs', '', 'sannen', 2], ['gs', '', 'shunin', 1], ['gs', '', 'joukyu', 4], ['gs', '', 'nashi', 11],
      ['pr', '', 'kyokucho', 1], ['pr', '', 'sannen', 2], ['pr', 'jo', 'shunin', 1], ['pr', 'jo', 'joukyu', 5], ['pr', 'jo', 'nashi', 8],
      ['pr', 'sh', 'shunin', 1], ['pr', 'sh', 'joukyu', 5], ['pr', 'sh', 'nashi', 6]];
    const members = [];
    plan.forEach(([g, sub, r, n]) => { for (let k = 0; k < n; k++) { const i = members.length; members.push({ id: 'm' + (i + 1), name: sampleName(i), group: g, sub, role: r }); } });
    const rnd = (a, b, c) => (((a + 1) * 2654435761 + (b + 1) * 40503 * 97 + (c || 0) * 7919) >>> 0) % 100;
    const shifts = [], events = [];
    const T = (h, m) => h * 60 + (m || 0);
    const add = (m, d, s, e, duty, br) => { if (e > s) shifts.push({ id: 's' + (shifts.length + 1), m: m.id, d, s, e, br: br || [], duty }); };
    const ev = (d, s, e, name, cat, color, line) => events.push({ id: 'e' + (events.length + 1), d, s, e, name, cat: cat || '', color: color || '#ffffff', line: !!line });
    // 30〜90分の持ち場を、すき間を少しはさみながら順に回す（当番表の1年の列のように）
    const rota = (m, d, from, to, pool, seed) => {
      let t = from, j = 0;
      while (t < to - 20) {
        const r = rnd(seed, j, 3), len = [30, 45, 60, 60, 90, 45][r % 6];
        t += r % 7 === 0 ? 30 : r % 9 === 0 ? 15 : 0;
        const e = Math.min(to, t + len);
        if (e - t >= 30) add(m, d, t, e, pool[(seed * 3 + j * 5) % pool.length]);
        t = e; j++;
      }
    };
    const GS_POOL = ['d07', 'd18', 'd19', 'd20', 'd21', 'd03', 'd02', 'd05', 'd13'];
    const JO_POOL = ['d10', 'd09', 'd26', 'd07', 'd20', 'd19', 'd10', 'd09'];
    const PAMPH = ['d11', 'd12'];
    // 本祭の日の流れ：開場・持ち場を回す時間・控室の準備と片付け（1日目は午後から、2・3日目は朝から）
    const FEST = [
      { open: T(12), rs: T(13), re: T(17), prep: [T(11), T(11, 30)], close: [T(17), T(17, 45)], early: [T(8), T(9, 30)], pr: [T(12), T(17, 30)] },
      { open: T(10), rs: T(10), re: T(16, 30), prep: [T(9), T(9, 30)], close: [T(16, 30), T(17, 15)], early: null, pr: [T(10), T(17)] },
      { open: T(10), rs: T(10), re: T(16), prep: [T(8, 30), T(9)], close: [T(17), T(18)], early: null, pr: [T(10), T(16, 30)] },
    ];
    DEF_DAYS.forEach((day, k) => {
      members.forEach((m, i) => {
        const r = rnd(i, k), top = m.role === 'kyokucho' || m.role === 'sannen', lead = m.role === 'shunin' || m.role === 'joukyu';
        if (k === 0) {                                  // 準準備日（水）：授業のあと
          if (m.group === 'gs' && !top && r < 60) add(m, day.d, T(16, 30), T(19, 30), r < 30 ? 'd23' : 'd17');
          else if (m.sub === 'jo' && r < 35) add(m, day.d, T(17), T(19, 30), 'd10');
          else if (m.sub === 'sh' && r < 40) add(m, day.d, T(17), T(19), 'd15');
          else if (!top && r > 92) add(m, day.d, T(17), T(20), 'off');
        } else if (k === 1) {                           // 準備日（木）
          if (m.group === 'gs' && !top && r < 85) add(m, day.d, T(13), T(20), r < 45 ? 'd17' : 'd23', [{ s: T(16, 30), e: T(17) }]);
          else if (m.sub === 'jo' && r < 65) add(m, day.d, T(15), T(19, 30), 'd10');
          else if (m.sub === 'sh' && r < 60) add(m, day.d, T(15), T(18, 30), 'd11');
          else if (top && r < 50) add(m, day.d, T(17), T(20), 'd26');
          else if (r > 88) add(m, day.d, T(9), T(14, 30), 'off');
        } else if (day.kind === 'fest') {               // 本祭（3日間）
          const f = FEST[k - 2], seed = i * 13 + k;
          if (top) { if (r < 80) add(m, day.d, f.open - 60, f.re + 60, 'd26', [{ s: T(12, 30), e: T(13) }]); return; }
          if (m.group === 'gs') {
            if (f.early) add(m, day.d, f.early[0], f.early[1], 'd27');
            add(m, day.d, f.prep[0], f.prep[1], i % 2 ? 'd17' : 'd23');
            if (lead && i % 4 === 2) add(m, day.d, f.rs, f.re, 'd07', [{ s: f.rs + 150, e: f.rs + 180 }]);        // 10芝の通し
            else if (lead && i % 4 === 3) add(m, day.d, f.rs, f.re, 'd01', [{ s: f.rs + 120, e: f.rs + 150 }]);   // 一体の通し
            else rota(m, day.d, f.rs, f.re, GS_POOL, seed);
            add(m, day.d, f.close[0], f.close[1], i % 2 ? 'd25' : 'd24');
            if (k === 4 && lead) add(m, day.d, T(16), T(17), 'd01');
          } else if (m.sub === 'jo') {
            if (k === 3 && i % 8 === 1) { rota(m, day.d, f.pr[0], T(12), JO_POOL, seed); add(m, day.d, T(12), T(13), 'off'); rota(m, day.d, T(13), f.pr[1], JO_POOL, seed + 5); }
            else rota(m, day.d, f.pr[0], f.pr[1], JO_POOL, seed);
          } else {                                       // 出版：10号館と2号館のパンフを交互に
            let t = f.pr[0] + (i % 3) * 30, j = 0;
            while (t < f.pr[1] - 30) { const len = [60, 45, 75, 60][(i + j) % 4], e = Math.min(f.pr[1], t + len); add(m, day.d, t, e, PAMPH[(i + j) % 2]); t = e + [30, 45, 60, 30][(i * 3 + j) % 4]; j++; }
          }
        } else {                                        // 片付け日
          if (m.group === 'gs' && !top && r < 75) add(m, day.d, T(9), T(17), r < 40 ? 'd24' : 'd25', [{ s: T(12), e: T(12, 45) }]);
          else if (m.group === 'pr' && !top && r < 40) add(m, day.d, T(10), T(15), m.sub === 'jo' ? 'd16' : 'd15');
        }
      });
    });
    // イベント（会場ごとの行。時刻は架空）
    const [d6, d7, d8] = ['2026-11-06', '2026-11-07', '2026-11-08'];
    ev('2026-11-05', T(19), T(19), '全体ミーティング', '', '#fce5cd', true);
    ev(d6, T(12), T(12), '開場', '', '#fce5cd', true); ev(d6, T(18), T(18), '撤退', '', '#fce5cd', true);
    ev(d6, T(8), T(9, 30), '機材搬入', '10芝', '#d9d9d9'); ev(d6, T(12, 15), T(12, 45), '開会式', '10芝', '#f4cccc'); ev(d6, T(14), T(17), '公演', '10芝', '#ffffff');
    ev(d6, T(7, 30), T(8, 15), '機材搬入', '一体', '#d9d9d9'); ev(d6, T(13, 15), T(13, 15), '開場', '一体', '#fff2cc'); ev(d6, T(13, 30), T(17), '公演', '一体', '#ffffff');
    ev(d6, T(14), T(17, 30), '出店', '出店', '#ffffff'); ev(d6, T(15), T(17), '企画（10301）', 'その他', '#d9d2e9');
    ev(d7, T(10), T(10), '開場', '', '#fce5cd', true); ev(d7, T(18), T(18), '撤退', '', '#fce5cd', true);
    ev(d7, T(11), T(16, 15), '公演', '10芝', '#ffffff'); ev(d7, T(10, 45), T(10, 45), '開場', '一体', '#fff2cc'); ev(d7, T(11), T(16, 30), '公演', '一体', '#ffffff');
    ev(d7, T(11), T(16, 30), '出店', '出店', '#ffffff'); ev(d7, T(10, 30), T(12), '企画（10301）', 'その他', '#d9d2e9'); ev(d7, T(14, 30), T(16), '企画（10301）', 'その他', '#d9d2e9');
    ev(d8, T(10), T(10), '開場', '', '#fce5cd', true); ev(d8, T(18), T(18), '撤退', '', '#fce5cd', true);
    ev(d8, T(10, 45), T(13), '公演', '10芝', '#ffffff'); ev(d8, T(16, 15), T(18), '機材撤収', '10芝', '#d9d9d9'); ev(d8, T(13), T(16), '公演', '一体', '#ffffff');
    ev(d8, T(11), T(16), '出店', '出店', '#ffffff'); ev(d8, T(12), T(13, 30), '企画（10301）', 'その他', '#d9d2e9');
    return normalize({ v: DATA_V, sample: true, members, shifts, events, duties: DEF_DUTIES, roles: DEF_ROLES, groups: DEF_GROUPS });
  }

  // ---------- 保存と元に戻す ----------
  let D, V, undoS = [], redoS = [];
  // 前の版のサンプルに手を付けていないか（50人・m1〜m50・表示名もそのまま）。手を付けていれば実際のデータとして移す
  // 前の版のサンプルに手を付けていない（50人・名前もそのまま）。名前を本物に直していたら、サンプルとは見なさずに移す
  const pristineOldSample = j => j.sample && Array.isArray(j.members) && j.members.length === 50 && (j.title || '渉外局 シフト') === '渉外局 シフト' &&
    j.members.every((m, i) => m && m.id === 'm' + (i + 1) && m.name === sampleName(i));
  function loadData() {
    let raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) {}
    if (raw) { try { return normalize(JSON.parse(raw)); } catch (e) {} }
    for (const k of OLD_STORE_KEYS) {                           // 新しい順に、前の版のデータを探す（見つけた場所は控えとしてそのまま）
      let old = null;
      try { old = localStorage.getItem(k); } catch (e) {}
      if (!old) continue;
      try {
        const j = JSON.parse(old);
        if (j && pristineOldSample(j)) return sampleData();    // 前の版のサンプルのまま → 新しいサンプル
        if (j) return normalize(j);                             // 手を入れたデータ → 新しい形に移す
      } catch (e) {}
    }
    return sampleData();
  }
  let saveErrShown = false;
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(D)); saveErrShown = false; }
    catch (e) { if (!saveErrShown) { saveErrShown = true; toast('この端末に保存できませんでした（プライベートモードや容量の不足）。「書き出し」で控えを取ってください', { err: true, ms: 7000 }); } }
  }
  function loadView() {
    let v = {};
    try { v = JSON.parse([VIEW_KEY].concat(OLD_VIEW_KEYS).map(k => localStorage.getItem(k)).find(Boolean) || '{}') || {}; } catch (e) {}
    return {
      view: v.view === 'week' ? 'week' : 'day', grp: typeof v.grp === 'string' ? v.grp : 'all', day: v.day || '',
      colorBy: v.vv >= 2 && v.colorBy === 'group' ? 'group' : 'duty', vv: 3, hideEmpty: !!v.hideEmpty, hourPx: isFinite(v.hourPx) && v.hourPx > 0 ? v.hourPx : null,
      rowH: ROW_STEPS.includes(v.rowH) ? v.rowH : null, evHide: !!v.evHide,
      collapsed: v.collapsed && typeof v.collapsed === 'object' ? v.collapsed : {}, lastPreset: v.lastPreset || '', lastDuty: typeof v.lastDuty === 'string' ? v.lastDuty : '', q: '', hideNote: !!v.hideNote,
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
  // 部署の何番目か（0＝部署に分けない：部署のない課、役職が「部署の上」の人、部署が空の人）
  function secIdx(m) {
    const g = grp(m.group);
    if (!g.subs || !g.subs.length || !m.sub || role(m.role).top) return 0;
    return 1 + g.subs.findIndex(sb => sb.id === m.sub);
  }
  // 並び：課 → 部署（上の人が先）→ 役職（局長＞３年＞主任＞上級＞なし）→ 名簿に入れた順
  function sortedMembers(list) {
    const gi = id => D.groups.findIndex(g => g.id === id), idx = new Map(D.members.map((m, i) => [m.id, i]));
    return (list || D.members).slice().sort((a, b) => gi(a.group) - gi(b.group) || secIdx(a) - secIdx(b) || roleRank(a.role) - roleRank(b.role) || idx.get(a.id) - idx.get(b.id));
  }
  // 課の中を部署ごとに分ける：[{ sub: null, ms }, { sub: {id,name}, ms }, …]（人がいない部署は出さない）
  function sections(g, gm) {
    const out = [{ sub: null, ms: gm.filter(m => secIdx(m) === 0) }];
    (g.subs || []).forEach((sb, k) => out.push({ sub: sb, ms: gm.filter(m => secIdx(m) === k + 1) }));
    return out.filter((x, k) => k === 0 || x.ms.length);
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
  // 表示する時間の幅：設定の幅に、その日のシフト（課で絞っているときはその課の分）が収まるように広げる
  function dayRange(day, gid) {
    let a = D.opt.from, b = D.opt.to;
    const inG = gid && gid !== 'all' ? new Set(D.members.filter(m => m.group === gid).map(m => m.id)) : null;
    const fit = (s, e) => { a = Math.min(a, Math.floor(s / 60) * 60); b = Math.max(b, Math.ceil(e / 60) * 60); };
    D.shifts.forEach(s => { if (s.d === day && (!inG || inG.has(s.m))) fit(s.s, s.e); });
    D.events.forEach(ev => { if (ev.d === day) fit(ev.s, Math.max(ev.e, ev.s + 1)); });
    return [a, b];
  }
  const evCatRank = c => { const i = EV_CATS.indexOf(c); return i < 0 ? EV_CATS.length : i; };
  const evCatName = c => c || '全体';
  // 棒の色：持ち場で色分け＝持ち場の色（持ち場なしは課の色）、課で色分け＝課の色。人数に数えない持ち場（シフト不可）はいつも持ち場の色
  function barColor(m, sh) {
    const u = sh && dutyOf(sh.duty);
    return u && (V.colorBy === 'duty' || u.off) ? u.color : grp(m.group).color;
  }
  // 文字の色：白と黒のうち、その背景との差（コントラスト）が大きいほう。true＝白
  function isDark(hex) {
    const n = parseInt(String(hex).slice(1), 16); if (!isFinite(n)) return false;
    const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin(n >> 16 & 255) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255);
    return (1.05 / (L + 0.05)) > ((L + 0.05) / 0.05);
  }
  // 役職のバッジ（小さく）
  function roleBadge(rid, sm) {
    const r = role(rid);
    const nm = `<span class="f">${esc(r.name)}</span><span class="s">${esc(r.name.length > 2 ? r.name.slice(0, 2) : r.name)}</span>`;   // スマホの名前の欄は2文字まで
    return r.color ? `<span class="rb${sm ? ' sm' : ''}" style="background:${r.color};color:${isDark(r.color) ? '#fff' : '#000'}" title="${esc(r.name)}">${nm}</span>` : `<span class="rb none${sm ? ' sm' : ''}">${nm}</span>`;
  }
  // 30分ごとのシフト中の人数（休憩中と、シフト不可などの数えない持ち場を除く）。1分ごとに数えて、その30分の中で一番少ないとき（n）と多いとき（mx）
  //  → 15分の休憩が重なる時間帯も、人が減って見える
  function headcount(day, members, a, b) {
    const ids = new Set(members.map(m => m.id)), cnt = new Int16Array(DAY_MAX + 1), byM = new Map(), out = [];
    D.shifts.forEach(s => { if (s.d === day && ids.has(s.m) && !isOff(s)) { if (!byM.has(s.m)) byM.set(s.m, []); byM.get(s.m).push(s); } });
    byM.forEach(list => {
      const on = new Uint8Array(DAY_MAX + 1);
      list.forEach(s => { for (let t = s.s; t < s.e; t++) on[t] = 1; s.br.forEach(x => { for (let t = x.s; t < x.e; t++) on[t] = 0; }); });
      for (let t = 0; t < DAY_MAX; t++) cnt[t] += on[t];
    });
    for (let t = a; t < b; t += 30) {
      let n = Infinity, mx = 0, at = t;
      for (let u = t; u < Math.min(b, t + 30); u++) { if (cnt[u] < n) n = cnt[u]; if (cnt[u] > mx) { mx = cnt[u]; at = u; } }
      out.push({ t, n: n === Infinity ? 0 : n, mx, at });
    }
    return out;
  }
  function daySummary(day, members) {
    const ids = new Set(members.map(m => m.id)), list = D.shifts.filter(s => s.d === day && ids.has(s.m) && !isOff(s));
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
    $('sampleNote').hidden = !D.sample || V.hideNote;
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
  let printing = false, scrollKey = '';
  const PRINT_W = 1040, PRINT_ROWS = 15;          // 印刷：A4横に収まる幅と、1ページの行数（ページごとに時刻の見出しを付け直す）
  const rowH = () => V.rowH || (narrowScreen() ? 44 : 36);
  function renderDay() {
    const day = V.day, [a, b] = dayRange(day, V.grp), hours = (b - a) / 60;
    const nameW = cssNum('--name-w') || 200;
    const avail = printing ? PRINT_W - nameW : Math.max(200, tlWrap.clientWidth - nameW - 2);
    const hp = printing ? Math.floor(avail / hours * 10) / 10
      : V.hourPx ? clamp(V.hourPx, 20, 320) : Math.max(narrowScreen() ? 46 : 38, Math.min(170, Math.floor(avail / hours * 10) / 10));
    const W = Math.round(hours * hp), rh = rowH();
    G = { a, b, hp, W, day, nameW, rh };
    tl.style.setProperty('--hp', hp + 'px');
    tl.style.setProperty('--row-h', rh + 'px');
    tl.classList.toggle('dense', rh < 32);
    tl.classList.toggle('short', rh < 40);
    const ms = visibleMembers();
    const sum = daySummary(day, ms), hc = headcount(day, ms, a, b);
    const dd = dayOf(day), scope = V.grp === 'all' ? '全体' : esc(grp(V.grp).name);
    $('daySum').innerHTML = `<span>${dLabel(day)}</span>${dd.label ? `<span class="lbl">${esc(dd.label)}</span>` : ''}` +
      `<span>シフトに入る人 <b>${sum.people}</b>人</span><span>延べ <b>${hh(sum.work)}</b></span>`;
    $('printHead').innerHTML = `<b>${esc(D.title)}</b>　${dLabel(day)} ${esc(dd.label)}　${scope}　シフトに入る人 ${sum.people}人・延べ ${hh(sum.work)}`;

    const evs = D.events.filter(ev => ev.d === day);
    const evTog = `<button type="button" class="evtog" aria-expanded="${!V.evHide}" title="イベントの行を${V.evHide ? '出す' : 'たたむ'}">イベント${evs.length ? ' ' + evs.length : ''} ${V.evHide ? '▸' : '▾'}</button>`;
    let head = `<div class="tl-head"><div class="tl-name"><span class="hd">${dLabel(day)}　${scope}</span>${evTog}</div><div class="tl-hours" style="width:${W}px">`;
    for (let t = a; t < b; t += 60) {
      const toEnd = (b - t) / 60 * hp;   // 右の端の時刻と重なるときは、線だけ
      head += `<span style="left:${(t - a) / 60 * hp}px">${toEnd >= 86 ? fmt(t) : ''}</span>`;
      if (hp >= 96 && toEnd - hp / 2 >= 70) head += `<span class="mid" style="left:${(t + 30 - a) / 60 * hp}px">:30</span>`;
    }
    head += `<span class="end" style="left:${W}px">${fmt(b)}</span>`;   // 右の端（24:00 など）
    const now = jstNow(), showNow = !printing && now.ymd === day && now.min >= a && now.min <= b;
    const headNow = head + (showNow ? `<span class="nowtag" style="left:${(now.min - a) / 60 * hp}px">${fmt(now.min)}</span>` : '') + `</div></div>`;
    head += `</div></div>`;
    // イベントの行は時刻の見出しと一緒に上に貼り付ける。スマホは表の高さが足りないので、見出しだけ貼り付けてイベントは一緒に流す
    const band = V.evHide ? '' : evBandHtml(evs), pin = printing || !narrowScreen();
    const top = `<div class="tl-top">${headNow}${pin ? band : ''}</div>${pin ? '' : band}`;

    const groups = V.grp === 'all' ? D.groups : D.groups.filter(g => g.id === V.grp);
    let body = '', rowI = 0, onPage = 0;
    const pageBreak = () => { if (printing && onPage >= PRINT_ROWS * 36 / rh) { body += head.replace('class="tl-head"', 'class="tl-head pb"'); onPage = 0; } };
    groups.forEach(g => {
      let gm = ms.filter(m => m.group === g.id);
      if (!gm.length) return;
      const gs = daySummary(day, gm);
      if (V.hideEmpty) gm = gm.filter(m => D.shifts.some(s => s.m === m.id && s.d === day));
      const col = !!V.collapsed[g.id] && !printing;
      pageBreak();
      body += `<div class="tl-grp" data-g="${g.id}" style="width:${nameW + W}px"><div class="gin"><span class="car">${col ? '▸' : '▾'}</span><span class="gdot" style="background:${g.color}"></span>${esc(g.name)}` +
        `<span class="sub">${D.members.filter(m => m.group === g.id).length}人中 ${gs.people}人がシフトに入る・延べ ${hh(gs.work)}</span></div></div>`;
      onPage++;
      if (col) return;
      sections(g, gm).forEach(sec => {
        if (sec.sub) {
          const key = g.id + ':' + sec.sub.id, scol = !!V.collapsed[key] && !printing, ss = daySummary(day, sec.ms);
          pageBreak();
          body += `<div class="tl-grp sub" data-g="${key}" style="width:${nameW + W}px"><div class="gin"><span class="car">${scol ? '▸' : '▾'}</span>${esc(sec.sub.name)}` +
            `<span class="sub">${sec.ms.length}人・${ss.people}人がシフトに入る</span></div></div>`;
          onPage++;
          if (scol) return;
        }
        sec.ms.forEach(m => { pageBreak(); body += rowHtml(m, day, rowI++); onPage++; });
      });
    });
    if (!body) body = `<div class="tl-empty" style="width:${nameW + W}px">${D.members.length ? '条件に合うメンバーがいません' : 'メンバーがいません。「メンバー」から追加してください'}</div>`;

    const foot = `<div class="tl-foot"><div class="tl-name">シフト中の人数</div><div class="hc" style="width:${W}px">${hcCells(hc, hp, a)}</div></div>`;
    // 今の時刻の線（上）と、イベントの線（棒の下に薄く）
    const ov = showNow ? `<div class="tl-ov" style="left:${nameW}px;width:${W}px"><div class="tl-now" style="left:${(now.min - a) / 60 * hp}px"></div></div>` : '';
    const lines = evs.filter(ev => ev.line && !V.evHide);
    const evl = lines.length ? `<div class="tl-evl" style="left:${nameW}px;width:${W}px">${lines.map(ev => `<i style="left:${(ev.s - a) / 60 * hp}px;border-color:${ev.color}"></i>`).join('')}</div>` : '';
    tl.innerHTML = top + body + foot + evl + ov;
    // 日・課・表示を変えたときだけ、その日の最初のシフト（今日なら今の時刻）の少し前まで横に送る
    const key = [V.view, day, V.grp].join('|');
    if (!printing && key !== scrollKey) {
      scrollKey = key;
      const ids = new Set(ms.map(m => m.id)), first = D.shifts.filter(s => s.d === day && ids.has(s.m) && !isOff(s)).reduce((mn, s) => Math.min(mn, s.s), Infinity);
      const target = showNow ? now.min - 60 : first === Infinity ? a : first - 60;
      tlWrap.scrollLeft = Math.max(0, (target - a) / 60 * hp);
    }
  }
  // イベントの行：区分（会場）ごとに1行。重なるものは段を分ける。時刻だけのものは小さな旗
  function evBandHtml(evs) {
    const g = G, cats = [...new Set(evs.map(ev => ev.cat))].sort((x, y) => evCatRank(x) - evCatRank(y) || x.localeCompare(y, 'ja'));
    if (!cats.length) return `<div class="tl-evrow empty"><div class="tl-name evn">イベント</div><div class="tl-evlane" data-cat="" style="width:${g.W}px"><button type="button" class="evadd">＋ イベントを追加</button></div></div>`;
    return cats.map(c => {
      const list = evs.filter(ev => ev.cat === c).sort((x, y) => x.s - y.s || x.e - y.e);
      const tr = tracks(list.map(ev => ({ id: ev.id, s: ev.s, e: Math.max(ev.e, ev.s + Math.ceil(60 * 70 / g.hp)) }))), n = Math.max(1, ...[...tr.values()].map(x => x.n));
      const items = list.map(ev => {
        const t = tr.get(ev.id), x = (ev.s - g.a) / 60 * g.hp, top = 2 + t.k * 20, dk = isDark(ev.color);
        const tip = esc(`${ev.name}${ev.cat ? '（' + ev.cat + '）' : ''}\n${fmt(ev.s)}${ev.e > ev.s ? '〜' + fmt(ev.e) : ''}${ev.note ? '\n' + ev.note : ''}`);
        if (ev.e === ev.s) return `<div class="evpt${dk ? ' dk' : ''}" data-ev="${ev.id}" style="left:${x}px;top:${top}px;--ec:${ev.color}" title="${tip}"><b>${fmt(ev.s)}</b> ${esc(ev.name)}</div>`;
        const w = Math.max(6, (ev.e - ev.s) / 60 * g.hp), lab = w >= 120 ? `${esc(ev.name)} <b>${fmt(ev.s)}–${fmt(ev.e)}</b>` : esc(ev.name);
        return `<div class="evbar${dk ? ' dk' : ''}" data-ev="${ev.id}" style="left:${x}px;width:${w}px;top:${top}px;background:${ev.color}" title="${tip}">${lab}</div>`;
      }).join('');
      return `<div class="tl-evrow"><div class="tl-name evn" title="${esc(evCatName(c))}">${esc(evCatName(c))}</div><div class="tl-evlane" data-cat="${esc(c)}" style="width:${g.W}px;height:${4 + n * 20}px">${items}</div></div>`;
    }).join('');
  }
  function hcCells(hc, hp, a) {
    const max = Math.max(1, ...hc.map(x => x.n));
    return hc.map(x => {
      const l = (x.t - a) / 60 * hp + 1, w = hp / 2 - 2;
      const tip = `${fmt(x.t)}〜${fmt(x.t + 30)}　${x.n === x.mx ? x.n + '人' : '少ないとき ' + x.n + '人・多いとき ' + x.mx + '人'}`;
      const dip = x.mx > x.n ? ' dip' : '';
      if (!x.n) return `<i class="z${dip}" style="left:${l}px;width:${w}px" title="${tip}">${hp >= 40 ? '0' : ''}</i>`;
      const al = 0.05 + 0.2 * x.n / max;
      return `<i class="${dip.trim()}" style="left:${l}px;width:${w}px;background:rgba(255,255,255,${al.toFixed(2)})" title="${tip}">${hp >= 26 ? x.n : ''}</i>`;
    }).join('');
  }
  function nameCell(m, extra, tm) {
    const r = role(m.role);
    return `<div class="tl-name" data-m="${m.id}" title="${esc(m.name)}（${esc(grp(m.group).name)}・${esc(r.name)}）">` +
      `${r.color ? `<span class="rs" style="background:${r.color}"></span>` : ''}${roleBadge(m.role)}<span class="nmw"><span class="nm">${esc(m.name)}</span>${tm ? `<span class="tm">${esc(tm)}</span>` : ''}</span>${extra || ''}</div>`;
  }
  function rowHtml(m, day, i) {
    const list = shiftsOf(m.id, day), w = list.reduce((t, s) => t + onMin(s), 0);
    // スマホは名前の下に入り〜終わりと休憩の始まり（横にスクロールしなくても分かる）。シフト不可などは名前も
    const tm = list.map(s => fmt(s.s) + '–' + fmt(s.e) + (isOff(s) ? ' ' + dutyOf(s.duty).name : '') + (s.br.length ? ' 休' + s.br.map(b => fmt(b.s)).join('・') : '')).join(' / ');
    return `<div class="tl-row" data-m="${m.id}">${nameCell(m, w ? `<span class="hrs">${hh(w)}</span>` : '', tm)}` +
      `<div class="tl-lane${i % 2 ? ' alt' : ''}" data-m="${m.id}" style="width:${G.W}px">${laneHtml(m.id)}</div></div>`;
  }
  // 同じ人の時間が重なったら、重なった棒どうしを上下に分けて両方の端が見えるように
  function tracks(list) {
    const out = new Map();
    let cluster = [], end = -1;
    const flush = () => {
      const ends = [];
      cluster.forEach(sh => { let k = ends.findIndex(e => e <= sh.s); if (k < 0) { k = ends.length; ends.push(0); } ends[k] = sh.e; out.set(sh.id, { k, n: 0 }); });
      cluster.forEach(sh => { out.get(sh.id).n = ends.length; });
      cluster = [];
    };
    list.forEach(sh => { if (cluster.length && sh.s >= end) flush(); cluster.push(sh); end = Math.max(end, sh.e); });
    if (cluster.length) flush();
    return out;
  }
  function laneHtml(mId) {
    let list = D.shifts.filter(s => s.m === mId && s.d === G.day);
    if (drag && drag.moved) {
      list = list.filter(s => s.id !== drag.id);
      if (drag.cur.m === mId) list.push(Object.assign({ ghost: drag.kind === 'new', dragging: true }, drag.cur));
    }
    list.sort((x, y) => x.s - y.s || x.e - y.e);
    const cl = clashIds(list), m = mem(mId), tr = tracks(list), occ = { x: 0 };
    return list.map((sh, i) => barHtml(sh, m, cl.has(sh.id), occ, list[i + 1], null, tr.get(sh.id))).join('');
  }
  function shiftTitle(sh, m) {
    const r = role(m.role), u = dutyOf(sh.duty);
    return `${m.name}（${grp(m.group).name}${m.sub ? '・' + ((grp(m.group).subs || []).find(sb => sb.id === m.sub) || {}).name : ''}・${r.name}）\n${u ? '持ち場 ' + u.name + '\n' : ''}${fmt(sh.s)}〜${fmt(sh.e)}` +
      (u && u.off ? '（人数に数えません）' : `　シフト中 ${hm(workMin(sh))}` + (sh.br.length ? '\n休憩 ' + sh.br.map(b => fmt(b.s) + '〜' + fmt(b.e)).join('、') : '\n休憩なし')) +
      (sh.note ? '\n' + sh.note : '');
  }
  // occ.x：この行で左から描いた物（棒と横の時刻）の右の端。横の時刻どうしが重ならないように
  function barHtml(sh, m, clash, occ, next, geo, track) {
    const g = geo || G;
    const x = (sh.s - g.a) / 60 * g.hp, w = Math.max(4, (sh.e - sh.s) / 60 * g.hp);
    const narrow = w < 92;
    let brk = '';
    sh.br.forEach(b => {
      const bx = (b.s - sh.s) / 60 * g.hp, bw = (b.e - b.s) / 60 * g.hp;
      const lab = bw >= 96 ? '休 ' + fmt(b.s) + '–' + fmt(b.e) : bw >= 50 ? '休' + fmt(b.s) : bw >= 15 ? '休' : '';
      brk += `<div class="brk" style="left:${bx}px;width:${bw}px">${lab ? `<span>${lab}</span>` : ''}</div>`;
    });
    const u = dutyOf(sh.duty), col = barColor(m, sh), thin = !!geo || !!(track && track.n > 1), tall = !geo && (g.rh || 36) >= 34, two = !!u && !narrow && !thin && tall;
    const cl = clash && w >= 140 ? '<span class="cl">重複</span>' : '';
    let inner = '';
    if (two) inner = `<span class="ln1"><span class="t">${fmt(sh.s)}</span>${cl}<span class="e2">${fmt(sh.e)}</span></span><span class="ln2"><span class="tk">${esc(u.name)}</span></span>`;
    else if (!narrow) inner = `<span class="t">${fmt(sh.s)}</span>${cl}${u && w >= 118 ? `<span class="tk">${esc(u.name)}</span>` : ''}<span class="e2">${fmt(sh.e)}</span>`;
    else if (u && w >= 30 && !thin) {
      const sp = u.name.indexOf(' '), l1 = sp > 0 && tall ? u.name.slice(0, sp) : '', l2 = sp > 0 && tall ? u.name.slice(sp + 1) : u.name;
      inner = `<span class="nl">${l1 ? `<span>${esc(l1)}</span>` : ''}<span>${esc(l2)}</span></span>`;
    }
    let out = '', edge = x + w;
    if (narrow && !geo) {
      const label = `<b>${fmt(sh.s)}</b>–<b>${fmt(sh.e)}</b>`, need = 86;
      const freeR = (next ? (next.s - g.a) / 60 * g.hp : g.W) - (x + w), freeL = x - (occ ? occ.x : 0);
      if (freeR >= need) { out = `<div class="bar-out" data-id="${sh.id}" style="left:${x + w + 5}px">${label}</div>`; edge += need; }
      else if (freeL >= need) out = `<div class="bar-out" data-id="${sh.id}" style="right:${g.W - x + 5}px">${label}</div>`;
    }
    if (occ) occ.x = Math.max(occ.x, edge);
    const cls = 'bar' + (narrow ? ' narrow' : '') + (two ? ' two' : '') + (clash ? ' clash' : '') + (sh.ghost ? ' ghost' : '') + (sh.dragging ? ' drag' : '') + (isDark(col) ? ' dk' : '') + (u && u.off ? ' off' : '');
    const hdl = !geo && w >= 22 ? '<i class="hdl l"></i><i class="hdl r"></i>' : '';
    const pad = (g.rh || 36) < 32 ? 2 : 4;
    const tk = track && track.n > 1 ? `top:calc(${pad}px + (100% - ${2 * pad}px) * ${track.k} / ${track.n});height:calc((100% - ${2 * pad}px) / ${track.n} - 2px);bottom:auto;` : '';
    return `<div class="${cls}" data-id="${sh.id}" style="left:${x}px;width:${w}px;${tk}background:${col};--bc:${col}" title="${esc(shiftTitle(sh, m))}${clash ? '\n※ 同じ人の時間が重なっています' : ''}">${brk}${inner}${hdl}</div>${out}`;
  }

  // 6日間（メンバー×日付）
  function chipHtml(sh, m, clash) {
    const u = dutyOf(sh.duty), col = barColor(m, sh);
    return `<div class="chip${clash ? ' clash' : ''}${isDark(col) ? ' dk' : ''}" data-id="${sh.id}" style="background:${col}" title="${esc(shiftTitle(sh, m))}">` +
      `<span class="t">${fmt(sh.s)}<span class="sep">–</span>${fmt(sh.e)}</span>` +
      (sh.br.length ? `<span class="b"><i>休</i>${sh.br.map(b => fmt(b.s) + '–' + fmt(b.e)).join(' ')}</span>` : '') +
      (u ? `<span class="k">${esc(u.name)}</span>` : '') + `</div>`;
  }
  function renderWeek() {
    const ms = visibleMembers();
    const groups = V.grp === 'all' ? D.groups : D.groups.filter(g => g.id === V.grp);
    const ids = new Set(ms.map(m => m.id));
    const all = D.shifts.filter(s => ids.has(s.m) && !isOff(s));
    $('printHead').innerHTML = `<b>${esc(D.title)}</b>　${dLabel(D.days[0].d)}〜${dLabel(D.days[D.days.length - 1].d)}　${V.grp === 'all' ? '全体' : esc(grp(V.grp).name)}`;
    $('weekSum').innerHTML = `<span>${dLabel(D.days[0].d)}〜${dLabel(D.days[D.days.length - 1].d)}</span>` +
      `<span>シフト <b>${all.length}</b>件</span><span>延べ <b>${hh(all.reduce((t, s) => t + workMin(s), 0))}</b></span>`;
    let h = `<table class="mx"><thead><tr><th class="nm">メンバー</th>`;
    D.days.forEach(x => {
      const s = daySummary(x.d, ms);
      h += `<th class="${x.kind === 'fest' ? 'fest' : ''}${x.d === V.day ? ' sel' : ''}" data-d="${x.d}">${dLabel(x.d)}${x.label ? `<span class="lbl">${esc(x.label)}</span>` : ''}<span class="c">${s.people}人・${hh(s.work)}</span></th>`;
    });
    h += `<th>合計</th></tr></thead><tbody>`;
    const cols = D.days.length + 2;
    // イベント（日ごとに時刻順）
    h += `<tr class="evr"><td class="nm"><div class="tl-name evn"><button type="button" class="evtog" aria-expanded="${!V.evHide}">イベント ${V.evHide ? '▸' : '▾'}</button></div></td>`;
    D.days.forEach(x => {
      const list = V.evHide ? [] : D.events.filter(ev => ev.d === x.d).sort((p, q) => p.s - q.s || evCatRank(p.cat) - evCatRank(q.cat));
      h += `<td class="evcell" data-d="${x.d}">${list.map(ev => `<div class="evchip${isDark(ev.color) ? ' dk' : ''}" data-ev="${ev.id}" style="--ec:${ev.color}"><b>${fmt(ev.s)}${ev.e > ev.s ? '–' + fmt(ev.e) : ''}</b> ${esc(ev.name)}${ev.cat ? `<small>${esc(ev.cat)}</small>` : ''}</div>`).join('')}` +
        (V.evHide ? '' : `<button type="button" class="evadd2" data-evadd="${x.d}" aria-label="${dLabel(x.d)}にイベントを追加">＋</button>`) + `</td>`;
    });
    h += `<td></td></tr>`;
    const memberRow = m => {
      let tot = 0, r = `<tr data-m="${m.id}"><td class="nm">${nameCell(m)}</td>`;
      D.days.forEach(x => {
        const list = shiftsOf(m.id, x.d), cl = clashIds(list);
        tot += list.reduce((t, s) => t + onMin(s), 0);
        r += `<td class="cell${list.length ? ' has' : ''}" data-d="${x.d}">${list.map(s => chipHtml(s, m, cl.has(s.id))).join('')}<span class="add">＋</span>` +
          (list.length ? `<button type="button" class="add2" data-add2 aria-label="${esc(m.name)} ${dLabel(x.d)}にもう1件追加" title="もう1件追加">＋</button>` : '') + `</td>`;
      });
      return r + `<td class="tot">${tot ? hh(tot) : '—'}</td></tr>`;
    };
    groups.forEach(g => {
      const gm = ms.filter(m => m.group === g.id);
      if (!gm.length) return;
      const col = !!V.collapsed[g.id];
      h += `<tr class="gh" data-g="${g.id}"><td colspan="${cols}"><span class="inner"><span class="car">${col ? '▸' : '▾'}</span><span class="gdot" style="background:${g.color}"></span>${esc(g.name)}<span class="sub">${gm.length}人</span></span></td></tr>`;
      if (col) return;
      sections(g, gm).forEach(sec => {
        if (sec.sub) {
          const key = g.id + ':' + sec.sub.id, scol = !!V.collapsed[key];
          h += `<tr class="gh sub" data-g="${key}"><td colspan="${cols}"><span class="inner"><span class="car">${scol ? '▸' : '▾'}</span>${esc(sec.sub.name)}<span class="sub">${sec.ms.length}人</span></span></td></tr>`;
          if (scol) return;
        }
        sec.ms.forEach(m => { h += memberRow(m); });
      });
    });
    h += `</tbody><tfoot><tr><td class="nm">シフトに入る人数</td>`;
    D.days.forEach(x => { const s = daySummary(x.d, ms); h += `<td><b>${s.people}</b>人</td>`; });
    h += `<td></td></tr></tfoot></table>`;
    if (!ms.length) h = `<div class="tl-empty">${D.members.length ? '条件に合うメンバーがいません' : 'メンバーがいません。「メンバー」から追加してください'}</div>`;
    $('mxWrap').innerHTML = h;
    // 開いたとき・日を変えたときは、選んでいる日（期間中は今日）の列が見えるところまで横に送る
    const key = 'week|' + V.day + '|' + V.grp;
    if (!printing && key !== scrollKey) {
      scrollKey = key;
      const th = $('mxWrap').querySelector('th.sel'), nm = $('mxWrap').querySelector('th.nm');
      if (th && nm) { const wrap = $('mxWrap'); if (th.offsetLeft + th.offsetWidth > wrap.clientWidth) wrap.scrollLeft = Math.max(0, th.offsetLeft - nm.offsetWidth - 8); }
    }
  }

  // 凡例：役職のバッジ、いま見ている範囲で使っている持ち場の色、休憩、重なり
  function renderLegend() {
    const ids = new Set(visibleMembers().map(m => m.id));
    const used = new Set(D.shifts.filter(s => ids.has(s.m) && s.duty && (V.view === 'week' || s.d === V.day)).map(s => s.duty));
    const sw = V.colorBy === 'duty'
      ? D.duties.filter(u => used.has(u.id)).map(u => `<span class="it"><span class="sw" style="background:${u.color}"></span>${esc(u.name)}</span>`).join('')
      : D.groups.map(g => `<span class="it"><span class="sw" style="background:${g.color}"></span>${esc(g.name)}</span>`).join('');
    const ranks = D.roles.filter(r => r.color), open = $('legend').classList.contains('open');
    $('legend').innerHTML = `<button type="button" class="lgt" id="lgToggle" aria-expanded="${open}">凡例 ${open ? '▴' : '▾'}</button>` + (ranks.length ? `<span class="it">役職：</span>${ranks.map(r => roleBadge(r.id, true)).join(' ')}<span class="sep"></span>` : '') +
      (sw ? `<span class="it">${V.colorBy === 'duty' ? '持ち場：' : '課：'}</span>${sw}<span class="sep"></span>` : '') +
      `<span class="it"><span class="sw brk"></span>休憩</span><span class="it"><span class="sw cl"></span>同じ人の時間の重なり</span>`;
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
    if (!lane || e.target.closest('.bar-out')) return;     // 短い棒の横の時刻は、押すとその棒の編集（click で）
    const bar = e.target.closest('.bar'), st = D.opt.snap;
    if (bar) {
      const sh = D.shifts.find(s => s.id === bar.dataset.id);
      if (!sh) return;
      const hd = e.target.closest('.hdl');
      drag = { kind: hd ? (hd.classList.contains('l') ? 'l' : 'r') : 'move', id: sh.id, orig: clone(sh), cur: clone(sh), x0: e.clientX, y0: e.clientY, t0: minAt(e.clientX), moved: false, lanes: new Set([sh.m]) };
    } else {
      const t = clamp(snapTo(minAt(e.clientX), st), G.a, G.b - st);
      drag = { kind: 'new', id: '__new', t0: t, cur: { id: '__new', m: lane.dataset.m, d: G.day, s: t, e: t + st, br: [], duty: V.lastDuty || '', note: '' }, x0: e.clientX, y0: e.clientY, moved: false, lanes: new Set([lane.dataset.m]) };
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
      c.s = clamp(o.s + snapTo(t - drag.t0, st), G.a, o.e - st); c.br = keepBreaks(o.br, c.s, c.e);
    } else {
      c.e = clamp(o.e + snapTo(t - drag.t0, st), o.s + st, G.b); c.br = keepBreaks(o.br, c.s, c.e);
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
      // 少し手がぶれただけ（12px未満・30分未満）はクリックと同じ扱い（いつもの長さで下書き）
      if (Math.abs(e.clientX - d.x0) < 12 || c.e - c.s < 30) openShiftEditor(newDraft(c.m, G.day, Math.floor(d.t0 / 30) * 30));
      else openShiftEditor(withAutoBreak({ m: c.m, d: c.d, s: c.s, e: c.e, br: [], duty: c.duty }));
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
    // イベントの行：たたむ・出す、押したら編集、空いている所は追加
    if (e.target.closest('.evtog')) { V.evHide = !V.evHide; render(); return; }
    const evEl = e.target.closest('[data-ev]');
    if (evEl) { const ev = D.events.find(x => x.id === evEl.dataset.ev); if (ev) openEventEditor(ev); return; }
    const evLane = e.target.closest('.tl-evlane');
    if (evLane) {
      const t = e.target.closest('.evadd') ? Math.max(G.a, Math.floor((tlWrap.scrollLeft / G.hp * 60 + G.a + 60) / 60) * 60) : clamp(Math.floor(minAt(e.clientX) / 15) * 15, 0, DAY_MAX - 15);
      openEventEditor({ d: G.day, s: t, e: Math.min(DAY_MAX, t + 60), cat: evLane.dataset.cat || '', name: '', color: EV_COLORS[0], line: false });
      return;
    }
    const grpEl = e.target.closest('.tl-grp');
    if (grpEl) { V.collapsed[grpEl.dataset.g] = !V.collapsed[grpEl.dataset.g]; render(); return; }
    const nm = e.target.closest('.tl-name[data-m]');
    if (nm) { openMember(nm.dataset.m); return; }
    const bar = e.target.closest('.bar, .bar-out');
    if (bar) { const sh = D.shifts.find(s => s.id === bar.dataset.id); if (sh) openShiftEditor(sh); return; }
    const lane = e.target.closest('.tl-lane');
    if (lane) {
      const t = clamp(Math.floor(minAt(e.clientX) / 30) * 30, 0, DAY_MAX - D.opt.snap);
      openShiftEditor(newDraft(lane.dataset.m, G.day, t));
    }
  });

  // 時間を変えたときの休憩：シフトの時間の中に収まるものだけ残す（端にかかるものは消す）
  function keepBreaks(br, s, e) { return cleanBreaks(br, s, e).filter(b => b.s > s && b.e < e); }

  // 新しいシフトの下書き（最後に使った定型の長さ・最後に選んだ持ち場で）
  function newDraft(mId, day, t) {
    const p = D.presets.find(x => x.id === V.lastPreset), duty = dutyOf(V.lastDuty) ? V.lastDuty : '';
    if (t == null) return withAutoBreak(p ? { m: mId, d: day, s: p.s, e: p.e, br: clone(p.br), duty } : { m: mId, d: day, s: 540, e: 1020, br: [], duty });
    const len = p ? p.e - p.s : 240;
    const s = clamp(t, 0, DAY_MAX - D.opt.snap), e = Math.min(DAY_MAX, s + len);
    return withAutoBreak({ m: mId, d: day, s, e, br: [], duty });
  }
  // 6時間を超えるのに休憩がないときは、真ん中に休憩を入れる（8時間を超えたら60分、それ以外は45分）。シフト不可などには入れない
  function withAutoBreak(dr) {
    if (!D.opt.autoBreak || dr.br.length || dr.e - dr.s <= 360 || isOff(dr)) return dr;
    dr.br = [suggestBreak(dr)]; dr.autoBr = true;
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
  let dlgDownOnBackdrop = false, dlgRefresh = null, dlgOpenedAt = 0;
  function openDlg(o) {
    dlg.className = 'dlg' + (o.wide ? ' wide' : '');
    parkToast();
    dlg.innerHTML = `<div class="dlg-h"><h2>${o.title}</h2><button type="button" class="btn ghost icon x" data-close aria-label="閉じる">×</button></div>` +
      `<div class="dlg-b">${o.body}</div>${o.foot ? `<div class="dlg-f">${o.foot}</div>` : ''}`;
    dlg._onClose = o.onClose || null;
    dlgRefresh = o.refresh || null;
    dlgOpenedAt = performance.now();
    if (!dlg.open) dlg.showModal();
    placeToast();
    const b = dlg.querySelector('.dlg-b'); if (b) b.scrollTop = 0;
    return dlg;
  }
  function closeDlg() { if (dlg.open) dlg.close(); }
  function refreshOpenDlg() { if (dlg.open && dlgRefresh) dlgRefresh(); }
  dlg.addEventListener('close', () => { const f = dlg._onClose; dlg._onClose = null; dlgRefresh = null; parkToast(); dlg.innerHTML = ''; if (f) f(); });
  // 外側を押したら閉じる。ただし開いた直後（ダブルクリックの2回目）は閉じない
  dlg.addEventListener('pointerdown', e => { dlgDownOnBackdrop = e.target === dlg && performance.now() - dlgOpenedAt > 400; });
  dlg.addEventListener('click', e => {
    if (e.target === dlg && dlgDownOnBackdrop && e.detail <= 1) { closeDlg(); return; }
    if (e.target.closest('[data-close]')) closeDlg();
  });

  // 日付を選ぶチップ（11/6(金) 本祭1日目）
  const dayChip = (x, type, name, checked, extra) => `<label class="${x.kind === 'fest' ? 'fest' : ''}"><input type="${type}"${name ? ` name="${name}"` : ''} value="${x.d}"${checked ? ' checked' : ''}>${dLabel(x.d)}${x.label ? `<small class="dl">${esc(x.label)}</small>` : ''}${extra || ''}</label>`;
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
      else if (b.s < dr.s || b.e > dr.e) errs.push([i, `休憩${i + 1}がシフトの時間（${fmt(dr.s)}〜${fmt(dr.e)}）の外です`]);
      else if (dr.br.some((x, j) => j !== i && x.s < b.e && b.s < x.e)) errs.push([i, `休憩${i + 1}がほかの休憩と重なっています`]);
    });
    return errs;
  }

  // 持ち場を選ぶチップ（色つき）と、その場で新しい持ち場を足す欄
  function dutyChips(sel) {
    return `<button type="button" class="duchip none${!sel ? ' on' : ''}" data-du="" aria-pressed="${!sel}">なし</button>` +
      D.duties.map(u => `<button type="button" class="duchip${u.id === sel ? ' on' : ''}${isDark(u.color) ? ' dk' : ''}" data-du="${u.id}" aria-pressed="${u.id === sel}" style="--c:${u.color}">${esc(u.name)}${u.off ? '<small>数えない</small>' : ''}</button>`).join('') +
      `<button type="button" class="duchip add" data-duadd>＋ 新しい持ち場</button>`;
  }
  function dutyPickerHtml(sel, pid) {
    return `<div class="duties" id="${pid}">${dutyChips(sel)}</div>
      <div class="duadd" id="${pid}Add" hidden><input class="inp" maxlength="20" placeholder="持ち場の名前（例：1号館 受付）" aria-label="新しい持ち場の名前">
        <input type="color" value="#22c55e" aria-label="新しい持ち場の色"><label class="chk"><input type="checkbox"> 人数に数えない</label>
        <button type="button" class="btn small primary" data-duok>足す</button><button type="button" class="btn small ghost" data-ducancel>やめる</button></div>`;
  }
  function bindDutyPicker(root, pid, getSel, onPick) {
    const box = () => root.querySelector('#' + pid), add = () => root.querySelector('#' + pid + 'Add');
    const redraw = () => { box().innerHTML = dutyChips(getSel()); };
    const addNew = () => {
      const f = add(), name = str(f.querySelector('input.inp').value, 20);
      if (!name) { toast('持ち場の名前を入れてください'); return; }
      let u = D.duties.find(x => x.name === name);
      if (u) toast(`「${name}」はもうあります。それを選びました`);
      else {
        u = { id: 'u' + uid(), name, color: f.querySelector('input[type=color]').value, off: f.querySelector('input[type=checkbox]').checked };
        const nu = u;
        commit(D2 => { D2.duties.push(nu); }, `持ち場「${name}」を足しました（設定で色や並びを変えられます）`);
      }
      f.hidden = true; f.querySelector('input.inp').value = '';
      onPick(u.id); redraw();
    };
    root.addEventListener('click', e => {
      const c = e.target.closest('.duchip');
      if (c && box().contains(c)) {
        if (c.hasAttribute('data-duadd')) { add().hidden = false; add().querySelector('input.inp').focus(); }
        else { onPick(c.dataset.du); redraw(); }
        return;
      }
      if (e.target.closest('[data-duok]') && add().contains(e.target)) addNew();
      else if (e.target.closest('[data-ducancel]') && add().contains(e.target)) add().hidden = true;
    });
    root.addEventListener('keydown', e => { if (e.key === 'Enter' && add().contains(e.target)) { e.preventDefault(); e.stopPropagation(); addNew(); } }, true);
    return redraw;
  }

  // イベントの追加・編集（会場ごとの行に出す。時刻だけのものは旗で、線を引くこともできる）
  function openEventEditor(src) {
    const isNew = !src.id || !D.events.some(x => x.id === src.id);
    const st = 5, dr = { id: isNew ? null : src.id, d: dayOf(src.d) ? src.d : V.day, s: src.s, e: src.e, name: src.name || '', cat: src.cat || '', color: src.color || EV_COLORS[0], line: !!src.line, note: src.note || '' };
    const pt0 = !isNew && dr.e === dr.s;
    const copyTo = new Set();
    const cats = [...new Set(EV_CATS.filter(Boolean).concat(D.events.map(x => x.cat).filter(Boolean)))];
    const names = [...new Set(D.events.map(x => x.name))];
    const body = `
      <div class="row" style="align-items:flex-start">
        <div class="fld" style="flex:2;min-width:160px"><label for="evN">名前</label><input class="inp" id="evN" maxlength="24" list="evNames" value="${esc(dr.name)}" placeholder="例：開場・公演・出店"></div>
        <div class="fld" style="flex:1;min-width:120px"><label for="evC">会場・区分（行）</label><input class="inp" id="evC" maxlength="10" list="evCats" value="${esc(dr.cat)}" placeholder="空欄＝全体"></div>
      </div>
      <datalist id="evNames">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      <datalist id="evCats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <div class="fld"><span class="lb">日付</span><div class="dchk" id="evD">${D.days.map(x => dayChip(x, 'radio', 'evD', x.d === dr.d)).join('')}</div></div>
      <div class="fld"><span class="lb">時間</span>
        <div class="row nw"><label class="lb" for="evS" style="font-size:12px;color:var(--muted)">始まり</label><select class="inp time" id="evS"></select><span id="evTo">〜</span><select class="inp time" id="evE"></select></div>
        <label class="chk"><input type="checkbox" id="evPt"${pt0 ? ' checked' : ''}> 時刻だけ（開場・撤退など、終わりのないもの）</label>
        <label class="chk"><input type="checkbox" id="evL"${dr.line ? ' checked' : ''}> シフト表の上から下まで線を引く</label></div>
      <div class="fld"><span class="lb">色</span><div class="evcols" id="evCol"></div></div>
      <div class="fld"><label for="evM">メモ</label><input class="inp" id="evM" maxlength="60" value="${esc(dr.note)}" placeholder="例：10301教室"></div>
      <div class="fld"><span class="lb">ほかの日にも同じ時間で作る</span><div class="dchk" id="evCopy"></div></div>
      <div class="msg" id="evMsg"></div>`;
    const foot = `${isNew ? '' : '<button type="button" class="btn danger" id="evDel">削除</button>'}<span class="grow"></span><button type="button" class="btn" data-close>キャンセル</button><button type="button" class="btn primary" id="evSave">${isNew ? '追加する' : '保存する'}</button>`;
    openDlg({ title: isNew ? 'イベントを追加' : 'イベントを編集', body, foot, refresh: () => { if (!isNew && !D.events.some(x => x.id === dr.id)) closeDlg(); } });
    const q = id => dlg.querySelector('#' + id);
    let point = pt0;
    function upd() {
      q('evS').innerHTML = timeOptions(dr.s, 0, DAY_MAX, st);
      q('evE').innerHTML = timeOptions(dr.e, st, DAY_MAX, st);
      q('evE').hidden = q('evTo').hidden = point;
      q('evCol').innerHTML = EV_COLORS.map(c => `<button type="button" class="evc${c === dr.color ? ' on' : ''}" data-c="${c}" style="background:${c}" aria-label="色 ${c}"></button>`).join('') +
        `<input type="color" id="evColor" value="${dr.color}" aria-label="ほかの色">`;
      q('evCopy').innerHTML = D.days.filter(x => x.d !== dr.d).map(x => dayChip(x, 'checkbox', '', copyTo.has(x.d))).join('');
      const bad = !point && dr.e <= dr.s;
      q('evMsg').innerHTML = bad ? '<div class="msg err">終わりは始まりより後にしてください</div>' : '';
      q('evSave').disabled = bad;
    }
    function save() {
      const name = str(q('evN').value, 24);
      if (!name) { toast('イベントの名前を入れてください'); q('evN').focus(); return; }
      if (!point && dr.e <= dr.s) return;
      const rec = { d: dr.d, s: dr.s, e: point ? dr.s : dr.e, name, cat: str(q('evC').value, 10), color: dr.color, line: q('evL').checked, note: str(q('evM').value, 60) };
      const extra = [...copyTo].filter(d => d !== rec.d);
      commit(D2 => {
        if (isNew) D2.events.push(Object.assign({ id: 'e' + uid() }, rec));
        else { const x = D2.events.find(y => y.id === dr.id); if (x) Object.assign(x, rec); }
        extra.forEach(d => D2.events.push(Object.assign({ id: 'e' + uid() }, rec, { d })));
      }, `イベント「${name}」を${isNew ? '追加' : '保存'}しました` + (extra.length ? `（ほか${extra.length}日）` : ''));
      closeDlg();
    }
    const b = dlg.querySelector('.dlg-b');
    b.addEventListener('change', e => {
      const t = e.target;
      if (t.name === 'evD') { dr.d = t.value; copyTo.delete(dr.d); }
      else if (t.id === 'evS') { const ns = +t.value, len = Math.max(st, dr.e - dr.s); dr.s = ns; if (dr.e <= ns) dr.e = Math.min(DAY_MAX, ns + len); }
      else if (t.id === 'evE') dr.e = +t.value;
      else if (t.id === 'evPt') { point = t.checked; if (point) q('evL').checked = true; else if (dr.e <= dr.s) dr.e = Math.min(DAY_MAX, dr.s + 60); }
      else if (t.id === 'evColor') dr.color = t.value;
      else if (t.closest('#evCopy')) { if (t.checked) copyTo.add(t.value); else copyTo.delete(t.value); return; }
      else return;
      upd();
    });
    b.addEventListener('click', e => { const c = e.target.closest('.evc'); if (c) { dr.color = c.dataset.c; upd(); } });
    b.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') { e.preventDefault(); save(); } });
    q('evSave').addEventListener('click', save);
    const del = q('evDel');
    if (del) del.addEventListener('click', () => { commit(D2 => { D2.events = D2.events.filter(x => x.id !== dr.id); }, `イベント「${dr.name}」を削除しました`); closeDlg(); });
    upd();
    if (isNew) q('evN').focus();
  }

  // シフトの追加・編集
  function openShiftEditor(src, opt) {
    opt = opt || {};
    const isNew = !src.id || !D.shifts.some(s => s.id === src.id);
    if (!D.members.length) { toast('先に「メンバー」から名簿を作ってください'); return; }
    const dr = { id: isNew ? null : src.id, m: mem(src.m) ? src.m : sortedMembers()[0].id, d: dayOf(src.d) ? src.d : V.day, s: src.s, e: src.e, br: clone(src.br || []), duty: dutyOf(src.duty) ? src.duty : '', note: src.note || '', autoBr: !!src.autoBr };
    const copyTo = new Set(), st = D.opt.snap;
    const m0 = mem(dr.m);
    const body = `
      <div class="fld"><label for="edM">メンバー</label><select class="inp" id="edM">${memberOptions(dr.m)}</select></div>
      <div class="fld"><span class="lb">持ち場</span>${dutyPickerHtml(dr.duty, 'edU')}</div>
      <div class="fld"><span class="lb">日付</span><div class="dchk" id="edD">${D.days.map(x => dayChip(x, 'radio', 'edD', x.d === dr.d)).join('')}</div></div>
      <div class="fld"><span class="lb">時間（定型から選ぶか、入り・終わりを選ぶ）</span>
        <div class="presets" id="edP"></div>
        <div class="row nw" style="margin-top:4px"><label class="lb" for="edS" style="font-size:12px;color:var(--muted)">入り</label><select class="inp time" id="edS"></select><span>〜</span>
          <label class="lb" for="edE" style="font-size:12px;color:var(--muted)">終わり</label><select class="inp time" id="edE"></select></div>
        <div class="dur" id="edDur"></div>
        <div class="timebar" id="edBar"></div>
      </div>
      <div class="fld"><span class="lb">休憩</span><div class="brl" id="edBrk"></div>
        <div class="row"><button type="button" class="btn small" id="edAddBr">＋ 休憩を追加</button><span class="msg" id="edBrHint"></span></div></div>
      <div class="fld"><label for="edN">メモ</label><input class="inp" id="edN" maxlength="80" value="${esc(dr.note)}" placeholder="例：無線を受け取る"></div>
      <div class="fld"><span class="lb">ほかの日にも同じ時間で作る</span><div class="dchk" id="edCopy"></div></div>
      <div class="msg" id="edMsg"></div>`;
    const foot = `${isNew ? '' : '<button type="button" class="btn danger" id="edDel">削除</button>'}<span class="grow"></span>` +
      `<button type="button" class="btn" data-close>キャンセル</button><button type="button" class="btn primary" id="edSave">${isNew ? '追加する' : '保存する'}</button>`;
    let done = false;
    let redrawDuty = () => {};
    openDlg({ title: isNew ? 'シフトを追加' : 'シフトを編集' + (m0 ? '：' + esc(m0.name) : ''), body, foot, onClose: () => { if (opt.back) opt.back(); },
      refresh: () => { if (!isNew && !D.shifts.some(s => s.id === dr.id)) { closeDlg(); return; } if (!dutyOf(dr.duty)) dr.duty = ''; redrawDuty(); upd(); } });
    const q = id => dlg.querySelector('#' + id);

    function upd() {
      q('edS').innerHTML = timeOptions(dr.s, 0, DAY_MAX - st, st);
      q('edE').innerHTML = timeOptions(dr.e, st, DAY_MAX, st);
      q('edP').innerHTML = presetChips(dr.s, dr.e);
      const bad = dr.e <= dr.s, bErr = bad ? [] : breakErrors(dr);
      q('edS').classList.toggle('err', bad); q('edE').classList.toggle('err', bad);
      const work = Math.max(0, dr.e - dr.s - dr.br.reduce((t, b) => t + Math.max(0, Math.min(b.e, dr.e) - Math.max(b.s, dr.s)), 0));
      q('edDur').innerHTML = bad ? '' : isOff(dr) ? `${esc(dutyOf(dr.duty).name)}：${fmt(dr.s)}〜${fmt(dr.e)}（シフト中の人数には数えません）`
        : `シフト中 <b>${hm(work)}</b>（${fmt(dr.s)}〜${fmt(dr.e)} の ${hm(dr.e - dr.s)}・休憩 ${hm(dr.br.reduce((t, b) => t + Math.max(0, b.e - b.s), 0))}）`;
      // 1日の中での位置
      const bar = q('edBar'), [ra, rb] = dayRange(dr.d), a = Math.min(ra, Math.floor(dr.s / 60) * 60), b = Math.max(rb, Math.ceil(dr.e / 60) * 60);
      const wpx = bar.clientWidth || 480, hp = wpx / ((b - a) / 60), m = mem(dr.m);
      let tk = '';
      for (let t = a; t < b; t += 60) if ((t / 60) % (hp < 26 ? 3 : hp < 40 ? 2 : 1) === 0) tk += `<span class="tk2" style="left:${(t - a) / 60 * hp}px">${t / 60}</span>`;
      bar.innerHTML = tk + (bad || !m ? '' : barHtml({ id: 'x', s: dr.s, e: dr.e, br: dr.br.filter(x => x.e > x.s && x.s >= dr.s && x.e <= dr.e), duty: dr.duty }, m, false, null, null, { a, b, hp, W: wpx }));
      // 休憩
      const errIdx = new Set(bErr.map(x => x[0]));
      q('edBrk').innerHTML = dr.br.length ? dr.br.map((x, i) => `<div class="row nw" data-i="${i}"><span class="lbl">休憩${i + 1}</span>` +
        `<select class="inp time${errIdx.has(i) ? ' err' : ''}" data-k="s" aria-label="休憩${i + 1}の始まり">${timeOptions(x.s, Math.min(dr.s, x.s), Math.max(dr.e, x.s), st)}</select><span>〜</span>` +
        `<select class="inp time${errIdx.has(i) ? ' err' : ''}" data-k="e" aria-label="休憩${i + 1}の終わり">${timeOptions(x.e, Math.min(dr.s, x.e), Math.max(dr.e, x.e), st)}</select>` +
        `<span class="dur">${x.e > x.s ? hm(x.e - x.s) : ''}</span><span class="grow" style="flex:1"></span><button type="button" class="btn ghost small icon" data-del aria-label="休憩${i + 1}を消す">×</button></div>`).join('')
        : '<div class="msg">休憩なし</div>';
      const long = !bad && dr.e - dr.s > 360 && !dr.br.length && !isOff(dr);
      q('edBrHint').innerHTML = long ? '<span class="msg warn">6時間を超えています。休憩を入れましょう</span>' : '';
      // ほかの日へ（その日にもう重なるシフトがある日は「重」の印）
      const ovOn = d => D.shifts.filter(s => s.m === dr.m && s.d === d && s.id !== dr.id && s.s < dr.e && dr.s < s.e);
      q('edCopy').innerHTML = D.days.filter(x => x.d !== dr.d).map(x => dayChip(x, 'checkbox', '', copyTo.has(x.d), !bad && ovOn(x.d).length ? '<span class="ov" title="この日はもう時間の重なるシフトがあります">重</span>' : '')).join('');
      // 注意
      const others = ovOn(dr.d);
      const msgs = [];
      if (bad) msgs.push(['err', '終わりは入りより後にしてください']);
      bErr.forEach(x => msgs.push(['err', x[1]]));
      if (others.length) msgs.push(['warn', `この日の ${others.map(s => fmt(s.s) + '〜' + fmt(s.e)).join('、')} と時間が重なっています（保存はできます）`]);
      const ovDays = [...copyTo].filter(d => d !== dr.d && ovOn(d).length);
      if (!bad && ovDays.length) msgs.push(['warn', `コピー先の ${ovDays.map(dLabel).join('・')} にも、時間の重なるシフトがあります`]);
      q('edMsg').innerHTML = msgs.map(x => `<div class="msg ${x[0]}">${x[1]}</div>`).join('');
      q('edSave').disabled = bad || bErr.length > 0;
    }
    function save() {
      if (dr.e <= dr.s || breakErrors(dr).length || done) return;
      done = true;
      const rec = { m: dr.m, d: dr.d, s: dr.s, e: dr.e, br: cleanBreaks(dr.br, dr.s, dr.e), duty: dutyOf(dr.duty) ? dr.duty : '', note: str(q('edN').value, 80) };
      const p = D.presets.find(x => x.s === rec.s && x.e === rec.e); if (p) V.lastPreset = p.id;
      if (!isOff(rec)) V.lastDuty = rec.duty;
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
      else if (t.closest('#edBrk')) { const i = +t.closest('[data-i]').dataset.i; dr.br[i][t.dataset.k] = +t.value; dr.autoBr = false; }
      else if (t.closest('#edCopy')) { if (t.checked) copyTo.add(t.value); else copyTo.delete(t.value); }
      else return;
      upd();
    });
    dlg.querySelector('.dlg-b').addEventListener('input', e => { if (e.target.id === 'edN') dr.note = e.target.value; });
    // 持ち場を選ぶ。シフト不可などに変えたら、自動で入れた休憩は外す
    redrawDuty = bindDutyPicker(dlg.querySelector('.dlg-b'), 'edU', () => dr.duty, id => { dr.duty = id; if (isOff(dr) && dr.autoBr) { dr.br = []; dr.autoBr = false; } upd(); });
    dlg.querySelector('.dlg-b').addEventListener('click', e => {
      const pc = e.target.closest('.pchip');
      if (pc) { const p = D.presets.find(x => x.id === pc.dataset.p); if (p) { dr.s = p.s; dr.e = p.e; dr.br = clone(p.br); dr.autoBr = false; if (!dr.br.length) withAutoBreak(dr); upd(); } return; }
      if (e.target.closest('#edAddBr')) { if (dr.e > dr.s) { dr.br.push(suggestBreak(dr)); dr.br.sort((x, y) => x.s - y.s); dr.autoBr = false; upd(); } return; }
      const del = e.target.closest('[data-del]');
      if (del) { dr.br.splice(+del.closest('[data-i]').dataset.i, 1); dr.autoBr = false; upd(); }
    });
    dlg.querySelector('.dlg-b').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'edN') { e.preventDefault(); save(); } });
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

  // メンバー1人（名前・課・部署・役職と、6日間のシフト）
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
          ${subSelectHtml(mm, 'mdS', 'fld" style="flex:1;min-width:100px')}
          <div class="fld" style="flex:1;min-width:100px"><label for="mdR">役職</label><select class="inp" id="mdR">${D.roles.map(r => `<option value="${r.id}"${r.id === mm.role ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
        </div>
        <div class="kv"><span>${roleBadge(mm.role)}</span><span>6日間で <b>${all.filter(s => !isOff(s)).length}</b>件</span><span>シフト中 <b>${hm(all.reduce((t, s) => t + onMin(s), 0))}</b></span><span>シフトに入る日 <b>${new Set(all.filter(s => !isOff(s)).map(s => s.d)).size}</b>日</span></div>
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
      const t = e.target, f = { mdN: 'name', mdG: 'group', mdR: 'role', mdS: 'sub' }[t.id];
      if (!f) return;
      const v = f === 'name' ? str(t.value, 30) : t.value;
      if (!v && f === 'name') { t.value = mem(id).name; return; }
      commit(D2 => { const x = D2.members.find(y => y.id === id); if (x) x[f] = v; }, '名簿を更新しました');
      // 名前だけなら描き直さない（描き直すと、次に押した＋やシフトが1回目で効かない）。課・部署・役職はバッジのために描き直して、選んでいた欄に戻る
      if (f !== 'name') { b.innerHTML = draw(); const el = b.querySelector('#' + t.id); if (el) el.focus(); }
    });
    b.addEventListener('click', e => {
      const chip = e.target.closest('.chip');
      if (chip) { const sh = D.shifts.find(s => s.id === chip.dataset.id); if (sh) { dlg._onClose = null; openShiftEditor(sh, { back }); } return; }
      const add = e.target.closest('[data-add]');
      if (add) { dlg._onClose = null; openShiftEditor(newDraft(id, add.dataset.add), { back }); }
    });
    $('mdDel').addEventListener('click', () => removeMembers([id]));
  }
  // 部署の選択（部署のある課だけ。ない課は「—」）
  function subSelectHtml(m, id, cls) {
    const g = grp(m.group), subs = g.subs || [];
    const opts = subs.length ? `<option value="">（なし）</option>` + subs.map(sb => `<option value="${sb.id}"${sb.id === m.sub ? ' selected' : ''}>${esc(sb.name)}</option>`).join('') : '<option value="">—</option>';
    const sel = `<select class="inp" ${id.startsWith('md') ? `id="${id}"` : `data-f="sub"`} aria-label="${esc(m.name)}の部署"${subs.length ? '' : ' disabled'}>${opts}</select>`;
    return cls ? `<div class="${cls}"><label for="${id}">部署</label>${sel}</div>` : sel;
  }
  function removeMembers(ids) {
    const n = D.shifts.filter(s => ids.includes(s.m)).length, names = ids.map(i => (mem(i) || {}).name).filter(Boolean);
    if (!confirm(`${names.length === 1 ? names[0] + ' さん' : names.length + '人'}を名簿から外しますか？${n ? `\nシフト${n}件も消えます。` : ''}（「元に戻す」で戻せます）`)) return;
    commit(D2 => { D2.members = D2.members.filter(m => !ids.includes(m.id)); D2.shifts = D2.shifts.filter(s => !ids.includes(s.m)); if (!D2.members.length) D2.sample = false; },
      `${names.length === 1 ? names[0] + ' さん' : names.length + '人'}を名簿から外しました`);
    refreshOpenDlg();
  }

  // 名簿（全員）
  // 貼り付けた1マスから課を当てる。「渉外局」のような局の名前そのものは課として扱わない
  function guessGroup(t) {
    t = nk(t).trim();
    if (!t || /^[-ー－—―]$/.test(t)) return null;
    const exact = D.groups.find(g => nk(g.name) === t); if (exact) return exact.id;
    if (/gs/i.test(t)) return 'gs';
    if (D.groups.some(g => (g.subs || []).some(sb => t.includes(nk(sb.name))))) return D.groups.find(g => (g.subs || []).some(sb => t.includes(nk(sb.name)))).id;
    if (/広報/.test(t)) return 'pr';
    return null;
  }
  // 部署：情宣・出版の名前が入っていれば
  function guessSub(t, gid) { t = nk(t); const g = D.groups.find(x => x.id === gid); const sb = g && (g.subs || []).find(x => t.includes(nk(x.name))); return sb ? sb.id : null; }
  // 役職：名前どおり（全角・半角は区別しない）。「1年」はなし、「2年」は上級、「3年」は３年
  function guessRole(t) {
    t = nk(t).trim();
    if (!t) return null;
    const exact = D.roles.find(r => nk(r.name) === t); if (exact) return exact.id;
    const hit = D.roles.slice().sort((a, b) => b.name.length - a.name.length).find(r => nk(r.name).length > 1 && t.includes(nk(r.name)));
    if (hit) return hit.id;
    const byName = n => (D.roles.find(r => nk(r.name) === n) || {}).id || null;
    if (/^1年/.test(t)) return byName('なし') || D.roles[D.roles.length - 1].id;
    if (/^2年/.test(t)) return byName('上級');
    if (/^3年/.test(t)) return byName('3年');
    return null;
  }
  const normName = n => String(n || '').replace(/[\s\u3000]/g, '');
  function parseRoster(text) {
    const out = [], defG = V.grp !== 'all' ? V.grp : 'gs', defR = D.roles[D.roles.length - 1].id;
    text.split(/\r?\n/).forEach(line => {
      const cells = line.split(/\t|,|、|，/).map(x => x.trim());
      const name = str(cells[0], 30);
      if (!name || /^(名前|氏名|なまえ)$/.test(name)) return;
      // 「情宣 上級」のように1マスで部署と役職の両方が分かることもある
      let r = null, g = null, sb = null;
      cells.slice(1).forEach(c => { const rr = guessRole(c), gg = guessGroup(c); if (rr && !r) r = rr; if (gg && !g) g = gg; });
      const grpId = g || defG;
      cells.slice(1).forEach(c => { const x = guessSub(c, grpId); if (x && !sb) sb = x; });
      out.push({ name, group: grpId, sub: sb || '', role: r || defR });
    });
    return out;
  }
  function openRoster() {
    // 開いている間は並びを変えない（課や役職を直しても、その行がどこかへ行かない）。閉じて開き直すと「課 → 部署 → 役職」の順に
    const order = new Map(sortedMembers().map((m, i) => [m.id, i]));
    const rowsInOrder = () => { const ms = sortedMembers(); return ms.filter(m => order.has(m.id)).sort((a, b) => order.get(a.id) - order.get(b.id)).concat(ms.filter(m => !order.has(m.id))); };
    const draw = () => {
      const ms = rowsInOrder();
      const cnt = id => D.shifts.filter(s => s.m === id).length;
      return `<div class="row"><span class="msg">名前・課・部署・役職を変えるとすぐに保存されます。開き直すと「課 → 部署 → 役職」の順に並びます。部署は広報課の情宣・出版です（局長・３年は部署に分けずに上に並びます）。シフトの持ち場は、シフトごとに選びます。</span></div>
        <div class="ed-wrap"><table class="ed stack roster"><thead><tr><th style="width:34%">名前</th><th>課</th><th>部署</th><th>役職</th><th style="width:56px">シフト</th><th style="width:40px"></th></tr></thead><tbody>
        ${ms.map(m => `<tr data-m="${m.id}"><td class="c-name"><input class="inp" data-f="name" maxlength="30" value="${esc(m.name)}" aria-label="名前"></td>
          <td class="c-grp"><select class="inp" data-f="group" aria-label="${esc(m.name)}の課">${D.groups.map(g => `<option value="${g.id}"${g.id === m.group ? ' selected' : ''}>${esc(g.name)}</option>`).join('')}</select></td>
          <td class="c-sub">${subSelectHtml(m, 'rs', '')}</td>
          <td class="c-role"><select class="inp" data-f="role" aria-label="${esc(m.name)}の役職">${D.roles.map(r => `<option value="${r.id}"${r.id === m.role ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select></td>
          <td class="num c-cnt" style="color:var(--muted);text-align:center">${cnt(m.id)}</td><td class="c-rm"><button type="button" class="btn ghost small icon" data-rm aria-label="${esc(m.name)}を外す">×</button></td></tr>`).join('')}
        ${ms.length ? '' : '<tr><td colspan="6" class="msg" style="padding:14px">まだいません</td></tr>'}
        </tbody></table></div>
        <div class="row"><button type="button" class="btn" id="rsAdd">＋ 1人追加</button><span class="msg">全体 ${D.members.length}人（${D.groups.map(g => esc(g.name) + ' ' + D.members.filter(m => m.group === g.id).length).join('・')}）</span></div>
        <details class="fld" id="rsPasteBox"><summary class="sect" style="cursor:pointer">まとめて貼り付け <small>Excel・スプレッドシートからコピーした名簿</small></summary>
          <div class="msg" style="margin:6px 0">1行に1人。「名前, 課（または部署）, 役職」の順（タブ・カンマ区切り）。「情宣」「出版」と書けば広報課のその部署に。役職は「局長・３年・主任・上級・なし」（「1年」はなし、「2年」は上級として読みます）。課を省くと「${V.grp !== 'all' ? esc(grp(V.grp).name) : esc(grp('gs').name)}」、役職を省くと「${esc(D.roles[D.roles.length - 1].name)}」。名簿にもういる名前は、足さずに課・部署・役職を直します。</div>
          <textarea class="inp" id="rsText" placeholder="山田 太郎, GS課, 主任&#10;鈴木 花子, 情宣, 上級&#10;佐藤 次郎, 出版, 1年&#10;高橋 三郎, 広報課, ３年"></textarea>
          <div class="rsprev" id="rsRows"></div>
          <div class="row" style="margin-top:8px"><span class="msg" id="rsPrev"></span><span style="flex:1"></span>
            <button type="button" class="btn" id="rsAppend">名簿に足す</button><button type="button" class="btn danger" id="rsReplace">名簿を置き換える</button></div>
        </details>`;
    };
    openDlg({ title: 'メンバー（名簿）', wide: true, body: draw(), foot: `${D.sample ? '<button type="button" class="btn danger" id="rsClearSample">サンプルを全部消す</button>' : ''}<span class="grow"></span><button type="button" class="btn primary" data-close>閉じる</button>`,
      refresh: () => {
        const b = dlg.querySelector('.dlg-b'), open = b.querySelector('#rsPasteBox')?.open, txt = b.querySelector('#rsText')?.value || '', sc = b.scrollTop;
        const ae = document.activeElement, keep = ae && ae.closest && ae.closest('tr[data-m]') ? [ae.closest('tr[data-m]').dataset.m, ae.dataset.f] : null;
        b.innerHTML = draw(); b.scrollTop = sc;
        if (open) { b.querySelector('#rsPasteBox').open = true; b.querySelector('#rsText').value = txt; preview(); }
        if (keep) { const el = b.querySelector(`tr[data-m="${keep[0]}"] [data-f="${keep[1]}"]`); if (el) el.focus(); }
      } });
    const b = dlg.querySelector('.dlg-b');
    const redraw = () => refreshOpenDlg();
    function preview() {
      const rows = parseRoster(b.querySelector('#rsText').value), have = new Set(D.members.map(m => normName(m.name)));
      b.querySelector('#rsPrev').textContent = rows.length ? `${rows.length}人（${D.groups.map(g => g.name + ' ' + rows.filter(r => r.group === g.id).length).join('・')}）` +
        (rows.some(r => have.has(normName(r.name))) ? `　うち ${rows.filter(r => have.has(normName(r.name))).length}人はもういる人（足すときは課・部署・役職を直します）` : '') : '';
      const subName = r => r.sub ? ' ' + ((grp(r.group).subs || []).find(sb => sb.id === r.sub) || {}).name : '';
      b.querySelector('#rsRows').innerHTML = rows.slice(0, 80).map(r => `<div class="r${have.has(normName(r.name)) ? ' upd' : ''}"><span class="gdot" style="background:${grp(r.group).color}"></span>${esc(grp(r.group).name + subName(r))}　${roleBadge(r.role, true)}　${esc(r.name)}${have.has(normName(r.name)) ? '（いる人）' : ''}</div>`).join('') + (rows.length > 80 ? `<div class="r">ほか ${rows.length - 80}人</div>` : '');
    }
    b.addEventListener('change', e => {
      const t = e.target, tr = t.closest('tr[data-m]');
      if (!tr || !t.dataset.f) return;
      const v = t.dataset.f === 'name' ? str(t.value, 30) : t.value;
      if (!v && t.dataset.f !== 'sub') { redraw(); return; }
      commit(D2 => { const x = D2.members.find(y => y.id === tr.dataset.m); if (x) x[t.dataset.f] = v; });
      if (t.dataset.f !== 'name') { redraw(); const row = b.querySelector(`tr[data-m="${tr.dataset.m}"]`); if (row) row.classList.add('hi'); }
    });
    b.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset && e.target.dataset.f === 'name') e.target.blur(); });
    b.addEventListener('input', e => { if (e.target.id === 'rsText') preview(); });
    b.addEventListener('click', e => {
      const rm = e.target.closest('[data-rm]');
      if (rm) { removeMembers([rm.closest('tr').dataset.m]); return; }
      if (e.target.id === 'rsAdd') {
        const nid = 'm' + uid();
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
        let added = 0, updated = 0;
        commit(D2 => {
          if (rep) { D2.members = []; D2.shifts = []; D2.sample = false; }
          rows.forEach(r => {
            const ex = D2.members.find(m => normName(m.name) === normName(r.name));
            if (ex) { ex.group = r.group; ex.sub = r.sub; ex.role = r.role; updated++; }
            else { D2.members.push({ id: 'm' + uid(), name: r.name, group: r.group, sub: r.sub, role: r.role }); added++; }
          });
        }, rep ? `${rows.length}人を名簿にしました` : `${added}人を足しました` + (updated ? `（${updated}人は課・部署・役職を直しました）` : ''));
        b.querySelector('#rsText').value = '';
        redraw();
      }
    });
    const cs = $('rsClearSample'); if (cs) cs.addEventListener('click', clearSample);
  }
  function clearSample() {
    if (!confirm('サンプルの名簿・シフト・イベントを全部消して、空の状態から始めますか？（「元に戻す」で戻せます）')) return;
    commit(D2 => { D2.members = []; D2.shifts = []; D2.events = []; D2.sample = false; }, 'サンプルを消しました。「メンバー」から名簿を作ってください');
    closeDlg();
  }

  // まとめて追加（何人か × 何日か）
  function openBulk() {
    if (!D.members.length) { toast('先に「メンバー」から名簿を作ってください'); return; }
    const p0 = D.presets.find(x => x.id === V.lastPreset) || D.presets[0];
    const st = D.opt.snap;
    const dr = { s: p0 ? p0.s : 540, e: p0 ? p0.e : 1020, br: p0 ? clone(p0.br) : [], duty: dutyOf(V.lastDuty) ? V.lastDuty : '' };
    const days = new Set([V.day]), pick = new Set();
    let skip = true;
    const body = `
      <div class="fld"><span class="lb">日付（いくつでも）</span><div class="dchk" id="bkD">${D.days.map(x => dayChip(x, 'checkbox', '', days.has(x.d))).join('')}</div></div>
      <div class="fld"><span class="lb">時間</span><div class="presets" id="bkP"></div>
        <div class="row nw" style="margin-top:4px"><span class="msg">入り</span><select class="inp time" id="bkS"></select><span>〜</span><span class="msg">終わり</span><select class="inp time" id="bkE"></select></div>
        <div class="row nw"><label class="chk"><input type="checkbox" id="bkBr"> 休憩</label><select class="inp time" id="bkBs"></select><span>〜</span><select class="inp time" id="bkBe"></select></div>
        <div class="dur" id="bkDur"></div></div>
      <div class="fld"><span class="lb">持ち場</span>${dutyPickerHtml(dr.duty, 'bkU')}</div>
      <div class="fld"><span class="lb">メンバー</span><div class="mlist" id="bkM"></div></div>
      <label class="chk"><input type="checkbox" id="bkSkip" checked> その日にもうシフトがある人は飛ばす</label>`;
    let redrawDuty = () => {};
    openDlg({ title: 'まとめて追加', body, wide: true, foot: `<span class="msg grow" id="bkSum"></span><button type="button" class="btn" data-close>キャンセル</button><button type="button" class="btn primary" id="bkGo">追加する</button>`,
      refresh: () => { if (!dutyOf(dr.duty)) dr.duty = ''; redrawDuty(); drawMembers(); upd(); } });
    const q = id => dlg.querySelector('#' + id);
    // その日にもうシフトがあるか（シフト不可などの数えない持ち場は、追加する時間と重なるときだけ）
    const busy = (mId, d) => D.shifts.some(s => s.m === mId && s.d === d && (!isOff(s) || (s.s < dr.e && dr.s < s.e)));
    const hasOn = mId => [...days].some(d => busy(mId, d));
    function drawMembers() {
      const sc = q('bkM').scrollTop;
      const groups = V.grp === 'all' ? D.groups : D.groups.filter(g => g.id === V.grp).concat(D.groups.filter(g => g.id !== V.grp));
      const row = m => `<label><input type="checkbox" value="${m.id}"${pick.has(m.id) ? ' checked' : ''}>${roleBadge(m.role, true)}<span class="nm">${esc(m.name)}</span>${hasOn(m.id) ? '<span class="has">シフトあり</span>' : ''}</label>`;
      const hd = (key, label, ms, cls, dot) => `<div class="gh${cls}">${dot || ''}${label}<span class="msg">${ms.filter(m => pick.has(m.id)).length}/${ms.length}</span>` +
        `<button type="button" class="btn small" data-all="${key}">全員</button><button type="button" class="btn small ghost" data-none="${key}">外す</button></div>`;
      q('bkM').innerHTML = groups.map(g => {
        const ms = sortedMembers().filter(m => m.group === g.id);
        if (!ms.length) return '';
        return hd(g.id, esc(g.name), ms, '', `<span class="gdot" style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${g.color}"></span>`) +
          sections(g, ms).map(sec => (sec.sub ? hd(g.id + ':' + sec.sub.id, esc(sec.sub.name), sec.ms, ' sub') : '') + sec.ms.map(row).join('')).join('');
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
      q('bkDur').innerHTML = bad ? '<span class="msg err">時間を確かめてください（終わりは入りより後、休憩はシフトの時間の中）</span>'
        : isOff(dr) ? `${esc(dutyOf(dr.duty).name)}（シフト中の人数には数えません）` : `シフト中 <b>${hm(dr.e - dr.s - brMin(dr))}</b>${dr.br.length ? '' : dr.e - dr.s > 360 ? '　<span class="msg warn">6時間を超えています。休憩を入れましょう</span>' : ''}`;
      const targets = plan();
      q('bkSum').textContent = `${pick.size}人 × ${days.size}日` + (skip ? `（飛ばす分を除いて ${targets.length}件）` : ` = ${targets.length}件`);
      q('bkGo').disabled = bad || !targets.length;
    }
    function plan() {
      const out = [];
      days.forEach(d => pick.forEach(mId => { if (!(skip && busy(mId, d))) out.push({ m: mId, d }); }));
      return out;
    }
    const b = dlg.querySelector('.dlg-b');
    b.addEventListener('change', e => {
      const t = e.target;
      if (t.closest('#bkD')) { if (t.checked) days.add(t.value); else days.delete(t.value); drawMembers(); }
      else if (t.closest('#bkM')) { if (t.checked) pick.add(t.value); else pick.delete(t.value); drawMembers(); }
      else if (t.id === 'bkS') { const ns = +t.value; if (dr.e <= ns) dr.e = Math.min(DAY_MAX, ns + 60); dr.s = ns; dr.br = cleanBreaks(dr.br, dr.s, dr.e); drawMembers(); }
      else if (t.id === 'bkE') { dr.e = +t.value; dr.br = cleanBreaks(dr.br, dr.s, dr.e); drawMembers(); }
      else if (t.id === 'bkBr') dr.br = t.checked ? [suggestBreak({ s: dr.s, e: dr.e, br: [] })] : [];
      else if (t.id === 'bkBs' || t.id === 'bkBe') { const bs = +q('bkBs').value, be = +q('bkBe').value; dr.br = [{ s: bs, e: be }]; }
      else if (t.id === 'bkSkip') skip = t.checked;
      else return;
      upd();
    });
    redrawDuty = bindDutyPicker(b, 'bkU', () => dr.duty, id => { dr.duty = id; upd(); });
    b.addEventListener('click', e => {
      const pc = e.target.closest('.pchip');
      if (pc) { const p = D.presets.find(x => x.id === pc.dataset.p); if (p) { dr.s = p.s; dr.e = p.e; dr.br = clone(p.br); if (!dr.br.length) withAutoBreak(dr); V.lastPreset = p.id; drawMembers(); upd(); } return; }
      const all = e.target.closest('[data-all]'), none = e.target.closest('[data-none]');
      if (all || none) {
        const [gid, sid] = (all || none).dataset[all ? 'all' : 'none'].split(':');
        D.members.filter(m => m.group === gid && (!sid || (secIdx(m) > 0 && m.sub === sid))).forEach(m => all ? pick.add(m.id) : pick.delete(m.id)); drawMembers(); upd();
      }
    });
    q('bkGo').addEventListener('click', () => {
      const targets = plan();
      if (!targets.length || dr.e <= dr.s || breakErrors(dr).length) return;
      const rec = { s: dr.s, e: dr.e, br: cleanBreaks(dr.br, dr.s, dr.e), duty: dutyOf(dr.duty) ? dr.duty : '', note: '' };
      if (!isOff(rec)) V.lastDuty = rec.duty;
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
      <div class="fld"><span class="lb">コピー先</span><div class="dchk" id="cpD">${D.days.filter(x => x.d !== V.day).map(x => dayChip(x, 'checkbox', '', false)).join('')}</div></div>
      <div class="fld"><span class="lb">コピー先にもうシフトがあるとき</span>
        <label class="chk"><input type="radio" name="cpM" value="rep" checked> 消してから入れる（${esc(scopeName())}の分だけ）</label>
        <label class="chk"><input type="radio" name="cpM" value="add"> そのまま残して足す（まったく同じシフトは足さない）</label></div>
      <div class="msg" id="cpMsg"></div>`;
    openDlg({ title: 'この日を別の日にコピー', body, foot: `<span class="grow"></span><button type="button" class="btn" data-close>キャンセル</button><button type="button" class="btn primary" id="cpGo"${src.length ? '' : ' disabled'}>コピーする</button>` });
    // 足すときに、コピー先の同じ人と時間が重なる件数・まったく同じで飛ばす件数
    const plan = () => {
      const to = [...dlg.querySelectorAll('#cpD input:checked')].map(x => x.value), rep = dlg.querySelector('input[name=cpM]:checked').value === 'rep';
      let add = 0, same = 0, ov = 0;
      to.forEach(d => src.forEach(s => {
        const there = rep ? [] : D.shifts.filter(x => x.d === d && x.m === s.m);
        if (there.some(x => x.s === s.s && x.e === s.e)) same++;
        else { add++; if (there.some(x => x.s < s.e && s.s < x.e)) ov++; }
      }));
      return { to, rep, add, same, ov };
    };
    const upd = () => {
      const p = plan();
      dlg.querySelector('#cpMsg').innerHTML = !p.to.length ? '' : (p.rep ? `${p.to.length}日の ${esc(scopeName())} のシフトを消して、${p.add}件を入れます` :
        `${p.add}件を足します` + (p.same ? `（同じシフト ${p.same}件は飛ばします）` : '') + (p.ov ? `<div class="msg warn">うち ${p.ov}件は、同じ人のシフトと時間が重なります</div>` : ''));
    };
    dlg.querySelector('.dlg-b').addEventListener('change', upd);
    $('cpGo').addEventListener('click', () => {
      const p = plan();
      if (!p.to.length) { toast('コピー先の日を選んでください'); return; }
      commit(D2 => {
        if (p.rep) D2.shifts = D2.shifts.filter(s => !(p.to.includes(s.d) && ids.has(s.m)));
        p.to.forEach(d => src.forEach(s => {
          if (!p.rep && D2.shifts.some(x => x.d === d && x.m === s.m && x.s === s.s && x.e === s.e)) return;
          D2.shifts.push(Object.assign(clone(s), { id: 's' + uid(), d }));
        }));
      }, `${dLabel(V.day)}（${scopeName()}）を ${p.to.map(dLabel).join('・')} にコピーしました` + (p.ov ? `（${p.ov}件は時間が重なっています）` : ''));
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
    const w = clone({ title: D.title, days: D.days, roles: D.roles, groups: D.groups, presets: D.presets, duties: D.duties, opt: D.opt });
    const delU = new Set();     // この画面で消した持ち場（保存のとき、ほかで足された持ち場と区別する）
    const st = () => w.opt.snap;
    const hourOpts = (sel, a, b) => { let h = ''; for (let t = a; t <= b; t += 60) h += `<option value="${t}"${t === sel ? ' selected' : ''}>${fmt(t)}</option>`; return h; };
    const draw = () => `
      <div class="fld"><label for="stTitle">表示名</label><input class="inp" id="stTitle" maxlength="30" value="${esc(w.title)}"></div>
      <div class="fld"><span class="sect">日付と区分 <small>本祭の日は白く目立たせます</small></span>
        <div class="ed-wrap"><table class="ed stack days2"><tbody>${w.days.map((x, i) => `<tr data-i="${i}"><td style="width:90px;font-weight:800">${dLabel(x.d)}</td>
          <td><input class="inp" data-f="dlabel" maxlength="12" value="${esc(x.label)}" aria-label="${dLabel(x.d)}の名前"></td>
          <td style="width:120px"><select class="inp" data-f="dkind" aria-label="${dLabel(x.d)}の区分">${KINDS.map(k => `<option value="${k[0]}"${k[0] === x.kind ? ' selected' : ''}>${k[1]}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div></div>
      <div class="fld"><span class="sect">表示と入力</span>
        <div class="row"><span class="msg">日別の表示</span><select class="inp time" id="stFrom">${hourOpts(w.opt.from, 0, 23 * 60)}</select><span>〜</span><select class="inp time" id="stTo">${hourOpts(w.opt.to, 60, DAY_MAX)}</select>
          <span class="msg">（シフトがはみ出す日は自動で広げます）</span></div>
        <div class="row"><span class="msg">時間の刻み</span><select class="inp" id="stSnap">${[5, 10, 15, 30].map(v => `<option value="${v}"${v === w.opt.snap ? ' selected' : ''}>${v}分</option>`).join('')}</select>
          <label class="chk"><input type="checkbox" id="stAuto"${w.opt.autoBreak ? ' checked' : ''}> 新しく作るとき（ドラッグ・クリック・定型）、6時間を超えていれば休憩を自動で入れる</label></div></div>
      <div class="fld"><span class="sect">持ち場 <small>シフトごとに選ぶ色。「人数に数えない」はシフト不可など</small></span>
        <div class="ed-wrap"><table class="ed stack duties2"><tbody>${w.duties.map((u, j) => `<tr data-j="${j}">
          <td class="c-sw" style="width:28px"><span class="dusw" style="background:${u.color}"></span></td>
          <td class="c-name"><input class="inp" data-f="uname" maxlength="20" value="${esc(u.name)}" aria-label="持ち場の名前"></td>
          <td class="c-ctl" style="width:290px"><div class="pair"><input type="color" data-f="ucolor" value="${u.color}" aria-label="${esc(u.name)}の色">
            <label class="chk"><input type="checkbox" data-f="uoff"${u.off ? ' checked' : ''}> 人数に数えない</label><span style="flex:1"></span>
            <button type="button" class="btn ghost small icon" data-uup aria-label="上へ"${j ? '' : ' disabled'}>↑</button><button type="button" class="btn ghost small icon" data-udown aria-label="下へ"${j < w.duties.length - 1 ? '' : ' disabled'}>↓</button><button type="button" class="btn ghost small icon" data-udel aria-label="${esc(u.name)}を消す">×</button></div></td></tr>`).join('')}
          ${w.duties.length ? '' : '<tr><td class="msg" style="padding:12px">まだありません</td></tr>'}</tbody></table></div>
        <div class="row"><button type="button" class="btn small" id="stAddDuty">＋ 持ち場を追加</button><button type="button" class="btn small ghost" id="stDefDuty">当番表の持ち場を足し直す</button></div></div>
      <div class="fld"><span class="sect">役職 <small>名前の左の小さな印。上ほど上に並びます。色なし＝印を出さない。「部署の上」＝広報課で情宣・出版に分けずに上に並べる</small></span>
        <div class="ed-wrap"><table class="ed stack roles"><tbody>${w.roles.map((r, i) => `<tr data-i="${i}">
          <td style="width:64px">${roleBadgeOf(r)}</td>
          <td class="c-name"><input class="inp" data-f="rname" maxlength="10" value="${esc(r.name)}" aria-label="役職の名前"></td>
          <td class="c-ctl" style="width:340px"><div class="pair"><input type="color" data-f="rcolor" value="${r.color || r._c || '#8b8b95'}" aria-label="${esc(r.name)}の色"${r.color ? '' : ' disabled'}>
            <label class="chk"><input type="checkbox" data-f="rhas"${r.color ? ' checked' : ''}> 色を付ける</label><label class="chk"><input type="checkbox" data-f="rtop"${r.top ? ' checked' : ''}> 部署の上</label><span style="flex:1"></span>
            <button type="button" class="btn ghost small icon" data-up aria-label="上へ"${i ? '' : ' disabled'}>↑</button><button type="button" class="btn ghost small icon" data-down aria-label="下へ"${i < w.roles.length - 1 ? '' : ' disabled'}>↓</button><button type="button" class="btn ghost small icon" data-rdel aria-label="消す"${w.roles.length > 1 ? '' : ' disabled'}>×</button></div></td></tr>`).join('')}</tbody></table></div>
        <div class="row"><button type="button" class="btn small" id="stAddRole">＋ 役職を追加</button></div></div>
      <div class="fld"><span class="sect">課と部署</span>
        <div class="ed-wrap"><table class="ed"><tbody>${w.groups.map((g, i) => `<tr data-i="${i}"><td><input class="inp" data-f="gname" maxlength="12" value="${esc(g.name)}" aria-label="課の名前"></td>
          <td style="width:50px"><input type="color" data-f="gcolor" value="${g.color}" aria-label="色"></td>
          <td>${(g.subs || []).map((sb, k) => `<input class="inp sbn" data-f="sname" data-k="${k}" maxlength="10" value="${esc(sb.name)}" aria-label="${esc(g.name)}の部署${k + 1}の名前">`).join('') || '<span class="msg">部署なし</span>'}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="fld"><span class="sect">定型の時間 <small>シフトの追加・まとめて追加で一度に選べます</small></span>
        <div class="ed-wrap"><table class="ed stack presets"><thead><tr><th>名前</th><th>入り</th><th>終わり</th><th>休憩</th><th></th></tr></thead><tbody>${w.presets.map((p, i) => `<tr data-i="${i}">
          <td class="c-name"><input class="inp" data-f="pname" maxlength="10" value="${esc(p.name)}" aria-label="定型の名前"></td>
          <td><select class="inp time" data-f="ps" aria-label="${esc(p.name)}の入り">${timeOptions(p.s, 0, DAY_MAX - st(), st())}</select></td>
          <td><select class="inp time" data-f="pe" aria-label="${esc(p.name)}の終わり">${timeOptions(p.e, st(), DAY_MAX, st())}</select></td>
          <td class="c-br"><div class="pair"><span class="msg">休</span><select class="inp time" data-f="pbs" aria-label="${esc(p.name)}の休憩の始まり"><option value="">なし</option>${timeOptions(p.br[0] ? p.br[0].s : null, p.s + st(), p.e - 2 * st(), st())}</select><span>〜</span>
            <select class="inp time" data-f="pbe" aria-label="${esc(p.name)}の休憩の終わり"${p.br[0] ? '' : ' disabled'}>${p.br[0] ? timeOptions(p.br[0].e, p.br[0].s + st(), p.e - st(), st()) : '<option>—</option>'}</select></div></td>
          <td class="c-del" style="width:40px"><button type="button" class="btn ghost small icon" data-pdel aria-label="${esc(p.name)}を消す">×</button></td></tr>`).join('')}</tbody></table></div>
        <div class="row"><button type="button" class="btn small" id="stAddPreset">＋ 定型を追加</button><span class="msg err" id="stPErr"></span></div></div>
`;
    function roleBadgeOf(r) { return r.color ? `<span class="rb sm" style="background:${r.color};color:${isDark(r.color) ? '#fff' : '#000'}">${esc(r.name)}</span>` : `<span class="rb none sm">${esc(r.name)}</span>`; }
    openDlg({ title: '設定', wide: true, body: draw(), foot: `<span class="grow"></span><button type="button" class="btn" data-close>キャンセル</button><button type="button" class="btn primary" id="stSave">保存する</button>` });
    const b = dlg.querySelector('.dlg-b');
    // 定型の休憩はシフトの時間の内側に（端にかからない）
    const presetErr = () => { const p = w.presets.find(x => x.br.some(y => y.e <= y.s || y.s <= x.s || y.e >= x.e)); return p ? `「${p.name}」の休憩を、入り〜終わりの内側にしてください` : ''; };
    const redraw = () => { const sc = b.scrollTop; b.innerHTML = draw(); b.scrollTop = sc; b.querySelector('#stPErr').textContent = presetErr(); };
    b.addEventListener('input', e => {
      const t = e.target, i = +(t.closest('[data-i]') || {}).dataset?.i, j = +(t.closest('[data-j]') || {}).dataset?.j, f = t.dataset.f;
      if (t.id === 'stTitle') w.title = t.value;
      else if (f === 'uname') w.duties[j].name = t.value;
      else if (f === 'ucolor') { w.duties[j].color = t.value; const sw = t.closest('tr').querySelector('.dusw'); if (sw) sw.style.background = t.value; }
      else if (f === 'dlabel') w.days[i].label = t.value;
      else if (f === 'rname') w.roles[i].name = t.value;
      else if (f === 'gname') w.groups[i].name = t.value;
      else if (f === 'sname') w.groups[i].subs[+t.dataset.k].name = t.value;
      else if (f === 'pname') w.presets[i].name = t.value;
      else if (f === 'rcolor') { w.roles[i].color = t.value; const bd = t.closest('tr').querySelector('.rb'); if (bd) bd.style.background = t.value; }
      else if (f === 'gcolor') w.groups[i].color = t.value;
    });
    b.addEventListener('change', e => {
      const t = e.target, i = +(t.closest('[data-i]') || {}).dataset?.i, j = +(t.closest('[data-j]') || {}).dataset?.j, f = t.dataset.f;
      if (f === 'dkind') w.days[i].kind = t.value;
      else if (f === 'uoff') w.duties[j].off = t.checked;
      else if (f === 'rtop') w.roles[i].top = t.checked;
      else if (f === 'rhas') { const r = w.roles[i]; if (!t.checked) { r._c = r.color || r._c; r.color = ''; } else r.color = r._c || '#8b8b95'; redraw(); }
      else if (f === 'rcolor') { w.roles[i]._c = t.value; redraw(); }
      else if (f === 'ps' || f === 'pe') { const p = w.presets[i]; p[f === 'ps' ? 's' : 'e'] = +t.value; if (p.e <= p.s) p.e = Math.min(DAY_MAX, p.s + 60); p.br = keepBreaks(p.br, p.s, p.e); redraw(); }
      else if (f === 'pbs') { const p = w.presets[i]; if (t.value === '') p.br = []; else { const s = +t.value, old = p.br[0]; p.br = [{ s, e: Math.min(p.e - st(), old && old.e > s ? old.e : s + 45) }]; } redraw(); }
      else if (f === 'pbe') { const p = w.presets[i]; if (p.br[0]) p.br[0].e = +t.value; redraw(); }
      else if (t.id === 'stFrom') w.opt.from = +t.value;
      else if (t.id === 'stTo') w.opt.to = +t.value;
      else if (t.id === 'stSnap') { w.opt.snap = +t.value; redraw(); }
      else if (t.id === 'stAuto') w.opt.autoBreak = t.checked;
    });
    b.addEventListener('click', e => {
      const tr = e.target.closest('[data-i]'), i = tr ? +tr.dataset.i : -1, tj = e.target.closest('[data-j]'), j = tj ? +tj.dataset.j : -1;
      const used = id => D.shifts.filter(x => x.duty === id).length;
      if (e.target.closest('[data-uup]') && j > 0) { const u = w.duties.splice(j, 1)[0]; w.duties.splice(j - 1, 0, u); redraw(); }
      else if (e.target.closest('[data-udown]') && j >= 0 && j < w.duties.length - 1) { const u = w.duties.splice(j, 1)[0]; w.duties.splice(j + 1, 0, u); redraw(); }
      else if (e.target.closest('[data-udel]') && j >= 0) {
        const u = w.duties[j], n = used(u.id);
        if (n && !confirm(`「${u.name}」のシフト ${n}件は持ち場なしになります。消しますか？（保存するまでは戻せます）`)) return;
        delU.add(u.id); w.duties.splice(j, 1); redraw();
      }
      else if (e.target.id === 'stAddDuty') { w.duties.push({ id: 'u' + uid(), name: '新しい持ち場', color: '#22c55e', off: false }); redraw(); const ins = b.querySelectorAll('[data-f=uname]'); const last = ins[ins.length - 1]; if (last) { last.focus(); last.select(); } }
      else if (e.target.id === 'stDefDuty') {
        const add = DEF_DUTIES.filter(x => !w.duties.some(u => u.id === x.id || u.name === x.name));
        if (!add.length) { toast('当番表の持ち場はすべて入っています'); return; }
        w.duties.push(...clone(add)); redraw(); toast(`${add.length}件を足しました（保存すると使えます）`);
      }
      else if (e.target.closest('[data-up]') && i > 0) { const r = w.roles.splice(i, 1)[0]; w.roles.splice(i - 1, 0, r); redraw(); }
      else if (e.target.closest('[data-down]') && i < w.roles.length - 1) { const r = w.roles.splice(i, 1)[0]; w.roles.splice(i + 1, 0, r); redraw(); }
      else if (e.target.closest('[data-rdel]') && w.roles.length > 1) {
        const r = w.roles[i], n = D.members.filter(m => m.role === r.id).length;
        if (n && !confirm(`「${r.name}」の ${n}人は「${w.roles[w.roles.length - 1 === i ? w.roles.length - 2 : w.roles.length - 1].name}」になります。消しますか？`)) return;
        w.roles.splice(i, 1); redraw();
      }
      else if (e.target.closest('[data-pdel]')) { w.presets.splice(i, 1); redraw(); }
      else if (e.target.id === 'stAddRole') { w.roles.splice(Math.max(0, w.roles.length - 1), 0, { id: 'r' + uid(), name: '新しい役職', color: '#22c55e', top: false }); redraw(); }
      else if (e.target.id === 'stAddPreset') { w.presets.push({ id: 'p' + uid(), name: '新しい定型', s: 540, e: 1020, br: [{ s: 720, e: 765 }] }); redraw(); }
    });
    $('stSave').addEventListener('click', () => {
      if (w.opt.to <= w.opt.from) { toast('表示の終わりは始まりより後にしてください'); return; }
      if (w.roles.some(r => !str(r.name, 10)) || w.presets.some(p => !str(p.name, 10)) || w.duties.some(u => !str(u.name, 20))) { toast('持ち場・役職・定型の名前を入れてください'); return; }
      if (presetErr()) { toast(presetErr()); b.querySelector('#stPErr').textContent = presetErr(); return; }
      const dupU = w.duties.map(u => str(u.name, 20)).find((n, k, a) => a.indexOf(n) !== k);
      if (dupU) { toast(`持ち場「${dupU}」が2つあります。名前を変えるか、片方を消してください`); return; }
      const keep = new Set(w.roles.map(r => r.id)), fb = w.roles[w.roles.length - 1].id;
      commit(D2 => {
        D2.title = w.title; D2.days = w.days; D2.groups = w.groups; D2.presets = w.presets; D2.opt = w.opt;
        D2.roles = w.roles.map(r => ({ id: r.id, name: r.name, color: r.color, top: !!r.top }));
        const wIds = new Set(w.duties.map(u => u.id));
        D2.duties = w.duties.map(u => ({ id: u.id, name: u.name, color: u.color, off: !!u.off })).concat(D2.duties.filter(u => !wIds.has(u.id) && !delU.has(u.id)));
        const keepU = new Set(D2.duties.map(u => u.id));
        D2.shifts.forEach(x => { if (x.duty && !keepU.has(x.duty)) x.duty = ''; });
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
    const tx = v => /^[=+\-@]/.test(v || '') ? "'" + v : v;   // 入力した文字が = + - @ で始まると、Excel が式として読むので ' を前に
    const order = new Map(sortedMembers().map((m, i) => [m.id, i])), di = new Map(D.days.map((x, i) => [x.d, i]));
    const rows = [['日付', '曜日', '日の名前', '課', '部署', '役職', '名前', '持ち場', '入り', '終わり', '休憩', '休憩(分)', 'シフト中(分)', 'シフト中(時間)', 'メモ']];
    D.shifts.slice().sort((a, b) => di.get(a.d) - di.get(b.d) || order.get(a.m) - order.get(b.m) || a.s - b.s).forEach(s => {
      const m = mem(s.m), x = dayOf(s.d), p = dParts(s.d);
      const u = dutyOf(s.duty), sb = m.sub && (grp(m.group).subs || []).find(y => y.id === m.sub);   // シフト不可などの数えない持ち場は、シフト中の時間を0に
      rows.push([s.d, WD[p.w], tx(x.label), tx(grp(m.group).name), tx(sb ? sb.name : ''), tx(role(m.role).name), tx(m.name), tx(u ? u.name : ''), fmt2(s.s), fmt2(s.e), s.br.map(b => fmt2(b.s) + '-' + fmt2(b.e)).join(' / '), brMin(s), onMin(s), (onMin(s) / 60).toFixed(2), tx(s.note)]);
    });
    download(`shift-${stamp()}.csv`, '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n'), 'text/csv');
    toast('CSVを書き出しました（Excelで開けます）');
  }
  $('fileIn').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      let n;
      try {
        const j = JSON.parse(rd.result);
        if (!j || !Array.isArray(j.members) || !Array.isArray(j.shifts)) throw new Error('shape');
        n = normalize(j);
      } catch (err) { toast('シフトのファイルとして読めませんでした（このツールで書き出したJSONを選んでください）', { err: true, ms: 5000 }); return; }
      openImport(n, f.name);
    };
    rd.readAsText(f);
  });
  // 読み込み：全部を置き換えるか、1つの課だけを入れ替えるか（GS課と広報課を別々の端末で作って、1台にまとめるとき）
  function openImport(n, fname) {
    const cnt = gid => { const ids = new Set(n.members.filter(m => m.group === gid).map(m => m.id)); return [ids.size, n.shifts.filter(s => ids.has(s.m)).length]; };
    const def = V.grp !== 'all' ? V.grp : 'all';
    const body = `<div class="msg">「${esc(fname)}」：${n.members.length}人・シフト${n.shifts.length}件</div>
      <div class="fld"><span class="lb">取り込み方</span>
        <label class="chk"><input type="radio" name="imM" value="all"${def === 'all' ? ' checked' : ''}> 全部を置き換える（名簿・シフト・イベント・設定。いまのものは消えます）</label>
        ${D.groups.map(g => { const [a, b] = cnt(g.id); return `<label class="chk"><input type="radio" name="imM" value="${g.id}"${def === g.id ? ' checked' : ''}> ${esc(g.name)}だけ入れ替える（ファイルの${a}人・${b}件。ほかの課・イベント・設定はこの端末のまま）</label>`; }).join('')}
      </div><div class="msg">「元に戻す」で読み込む前に戻せます。</div>`;
    openDlg({ title: 'JSONを読み込む', body, foot: `<span class="grow"></span><button type="button" class="btn" data-close>キャンセル</button><button type="button" class="btn primary" id="imGo">読み込む</button>` });
    $('imGo').addEventListener('click', () => {
      const mode = dlg.querySelector('input[name=imM]:checked').value;
      if (mode === 'all') {
        commit(D2 => { Object.keys(D2).forEach(k => delete D2[k]); Object.assign(D2, clone(n), { sample: false }); }, `${n.members.length}人・シフト${n.shifts.length}件を読み込みました`);
      } else {
        const g = grp(mode), fm = n.members.filter(m => m.group === mode), fIds = new Set(fm.map(m => m.id));
        const fs = n.shifts.filter(s => fIds.has(s.m));
        commit(D2 => {
          const old = new Set(D2.members.filter(m => m.group === mode).map(m => m.id));
          D2.members = D2.members.filter(m => !old.has(m.id)); D2.shifts = D2.shifts.filter(s => !old.has(s.m));
          const usedM = new Set(D2.members.map(m => m.id)), usedS = new Set(D2.shifts.map(s => s.id)), idMap = new Map();
          fm.forEach(m => {
            const fr = n.roles.find(r => r.id === m.role), lr = fr && (D2.roles.find(r => r.name === fr.name) || D2.roles.find(r => r.id === fr.id));
            const id = usedM.has(m.id) ? 'm' + uid() : m.id; usedM.add(id); idMap.set(m.id, id);
            D2.members.push({ id, name: m.name, group: mode, sub: m.sub, role: lr ? lr.id : D2.roles[D2.roles.length - 1].id, note: m.note });
          });
          // 持ち場は名前で合わせる（この端末にない持ち場は足す）
          const dutyFor = fid => {
            const fu = fid && n.duties.find(u => u.id === fid); if (!fu) return '';
            let lu = D2.duties.find(u => u.name === fu.name);
            if (!lu) { lu = { id: D2.duties.some(u => u.id === fu.id) ? 'u' + uid() : fu.id, name: fu.name, color: fu.color, off: !!fu.off }; D2.duties.push(lu); }
            return lu.id;
          };
          fs.forEach(s => { const id = usedS.has(s.id) ? 's' + uid() : s.id; usedS.add(id); D2.shifts.push(Object.assign(clone(s), { id, m: idMap.get(s.m), duty: dutyFor(s.duty) })); });
          D2.sample = false;
        }, `${g.name}を入れ替えました（${fm.length}人・シフト${fs.length}件）`);
      }
      closeDlg();
    });
  }

  // ---------- メニュー ----------
  const menu = $('menu');
  function openMenu(anchor) {
    const items = [
      ['bulk', 'まとめて追加…'],
      ['event', 'イベントを追加…', V.view === 'day' ? dLabel(V.day) : ''],
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
    else if (a === 'event') openEventEditor({ d: V.day, s: 600, e: 660, cat: '', name: '', color: EV_COLORS[0], line: false });
    else if (a === 'copy') openCopyDay();
    else if (a === 'clear') clearDay();
    else if (a === 'json') exportJson();
    else if (a === 'import') $('fileIn').click();
    else if (a === 'csv') exportCsv();
    else if (a === 'print') window.print();
    else if (a === 'settings') openSettings();
    else if (a === 'sample') {
      if (!confirm('サンプル（架空の名前の名簿とシフト・イベント）を読み込みますか？\nいまの名簿・シフト・イベントは置き換わります（設定はそのまま）。（「元に戻す」で戻せます）')) return;
      // サンプルは既定の持ち場・役職のidを使う。この端末にない持ち場・役職は足す
      const sd = sampleData(); V.hideNote = false;
      commit(D2 => {
        sd.duties.forEach(u => { if (!D2.duties.some(x => x.id === u.id)) D2.duties.push(u); });
        sd.roles.forEach(r => { if (!D2.roles.some(x => x.id === r.id)) D2.roles.splice(Math.max(0, D2.roles.length - 1), 0, r); });
        D2.members = sd.members; D2.shifts = sd.shifts; D2.events = sd.events; D2.sample = true;
      }, 'サンプルを読み込みました');
    }
    else if (a === 'reset') { if (confirm('名簿・シフト・イベントをすべて消しますか？（設定は残ります。「元に戻す」で戻せます）')) commit(D2 => { D2.members = []; D2.shifts = []; D2.events = []; D2.sample = false; }, 'すべて消しました'); }
  });
  document.addEventListener('pointerdown', e => { if (!menu.hidden && !menu.contains(e.target) && e.target.id !== 'btnMenu') closeMenu(); });

  // ---------- お知らせ ----------
  let toastT = null;
  function parkToast() { const t = $('toast'); if (t.parentNode !== document.body) document.body.appendChild(t); }
  function placeToast() {
    const t = $('toast'), host = dlg.open ? dlg : document.body;
    if (t.parentNode !== host) host.appendChild(t);
  }
  function toast(msg, o) {
    o = o || {};
    const t = $('toast');
    placeToast();
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
    // スマホ：虫めがねで検索欄を出す・しまう（しまうときは絞り込みも外す）
    $('btnSearch').addEventListener('click', () => {
      const open = !document.body.classList.contains('search-open');
      document.body.classList.toggle('search-open', open);
      $('btnSearch').setAttribute('aria-expanded', String(open));
      if (open) $('q').focus(); else if (V.q) { V.q = ''; $('q').value = ''; render(); }
    });
    // 印刷：日別は用紙の幅で描き直す（終わったら画面の幅に戻す）
    const beforePrint = () => { if (printing) return; printing = true; if (V.view === 'day') renderDay(); };
    const afterPrint = () => { if (!printing) return; printing = false; render(); };
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);
    const mqp = window.matchMedia && window.matchMedia('print');
    if (mqp && mqp.addEventListener) mqp.addEventListener('change', e => { if (e.matches) beforePrint(); else afterPrint(); });
    $('zoomIn').addEventListener('click', () => { V.hourPx = clamp(Math.round((G ? G.hp : 60) * 1.25), 20, 320); render(); });
    $('zoomOut').addEventListener('click', () => { V.hourPx = clamp(Math.round((G ? G.hp : 60) / 1.25), 20, 320); render(); });
    $('zoomFit').addEventListener('click', () => { V.hourPx = null; render(); });
    // 縦の縮尺：1行の高さを段階で
    const stepRow = dir => {
      const cur = rowH();
      V.rowH = dir > 0 ? (ROW_STEPS.find(x => x > cur) || ROW_STEPS[ROW_STEPS.length - 1]) : (ROW_STEPS.slice().reverse().find(x => x < cur) || ROW_STEPS[0]);
      render();
    };
    $('zoomVIn').addEventListener('click', () => stepRow(1));
    $('zoomVOut').addEventListener('click', () => stepRow(-1));
    $('btnAdd').addEventListener('click', () => {
      if (!D.members.length) { openRoster(); return; }
      const first = visibleMembers()[0] || sortedMembers()[0];
      openShiftEditor(newDraft(first.id, V.day));
    });
    $('btnBulk').addEventListener('click', openBulk);
    $('btnMembers').addEventListener('click', openRoster);
    $('btnMenu').addEventListener('click', e => { if (menu.hidden) openMenu(e.currentTarget); else closeMenu(); });
    // たびマップへ戻る：地図から来たときは、ブラウザの「戻る」と同じに（地図がそのまま戻ることがある）。ほかはリンクのとおり支援ツールを開く
    $('btnBack').addEventListener('click', e => {
      if (e.button || e.ctrlKey || e.metaKey || e.shiftKey) return;
      let ref = null; try { ref = new URL(document.referrer); } catch (err) {}
      if (ref && ref.origin === location.origin && /\/index-google\.html$/.test(ref.pathname) && history.length > 1) { e.preventDefault(); history.back(); }
    });
    $('btnUndo').addEventListener('click', undo);
    $('btnRedo').addEventListener('click', redo);
    $('btnClearSample').addEventListener('click', clearSample);
    $('btnHideNote').addEventListener('click', () => { V.hideNote = true; render(); });
    $('legend').addEventListener('click', e => { if (e.target.closest('#lgToggle')) { $('legend').classList.toggle('open'); renderLegend(); } });
    $('weekView').addEventListener('click', e => {
      if (e.target.closest('.evtog')) { V.evHide = !V.evHide; render(); return; }
      const evEl = e.target.closest('[data-ev]');
      if (evEl) { const ev = D.events.find(x => x.id === evEl.dataset.ev); if (ev) openEventEditor(ev); return; }
      const ea = e.target.closest('[data-evadd]');
      if (ea) { openEventEditor({ d: ea.dataset.evadd, s: 600, e: 660, cat: '', name: '', color: EV_COLORS[0], line: false }); return; }
      if (e.target.closest('.evcell')) return;
      const th = e.target.closest('th[data-d]');
      if (th) { V.day = th.dataset.d; V.view = 'day'; render(); return; }
      const gh = e.target.closest('tr.gh');
      if (gh) { V.collapsed[gh.dataset.g] = !V.collapsed[gh.dataset.g]; render(); return; }
      const nm = e.target.closest('.tl-name[data-m]');
      if (nm) { openMember(nm.dataset.m); return; }
      const chip = e.target.closest('.chip');
      if (chip) { const sh = D.shifts.find(s => s.id === chip.dataset.id); if (sh) openShiftEditor(sh); return; }
      const cell = e.target.closest('td.cell');
      if (!cell) return;
      const mId = cell.closest('tr').dataset.m, list = shiftsOf(mId, cell.dataset.d);
      if (!e.target.closest('[data-add2]') && list.length === 1) openShiftEditor(list[0]);
      else if (e.target.closest('[data-add2]') || !list.length) openShiftEditor(newDraft(mId, cell.dataset.d));
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
    setInterval(() => { if (!drag && !printing && !dlg.open && V.view === 'day' && dayOf(jstNow().ymd)) render(); }, 60000);
  }

  D = loadData();
  V = loadView();
  if (dayOf(jstNow().ymd)) V.day = jstNow().ymd;   // 期間中は、開いたら今日（前に見ていた日ではなく）
  bind();
  render();
  if (!localStorageHas()) save();
  function localStorageHas() { try { return !!localStorage.getItem(STORE_KEY); } catch (e) { return false; } }
  window.shiftApp = { get data() { return D; }, render };   // 動作確認用
})();
