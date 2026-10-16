// たびマップ 本祭支援ツール：高度な設定（情報組込）— 本部版だけ
// fest-schedule.js の後に読み込む。上部のタブ「高度な設定（情報組込）」か黒帯を押すと開く。
//  - 黒帯の表示：日付で絞る（期間中はその日の情報だけ）・情報ごとの ON／文字の色／1ページの秒数・流す順番と回数
//  - 開錠・施錠時間／学内施設時間（食堂・セブンイレブンなど）／イベント時間（屋台＝出店グランプリ・ステージ・フリマなど。ステージは出演ごとの時間も）／インフォメーション
// 値は受信APIの時刻表（/api/v1/schedule）にまとめて保存する（受信APIでも本部版のキーだけが変えられる）。
// 編集中の内容は、保存する前からこの端末の黒帯で試せる（festSched.setPreview）。
(function () {
  'use strict';
  const S = window.festSched;
  if (!S || S.adv) return;
  const U = S.u, $ = U.$, esc = U.esc;
  const TITLE = { top: '高度な設定（情報組込）', lock: '開錠・施錠時間', fac: '学内施設時間', evt: 'イベント時間', act: 'ステージ出演', info: 'インフォメーション' };
  const EVT_PRESET = ['屋台（出店グランプリ）', 'LIVE STAGE', 'Green Stage', 'フリーマーケット'];
  const A = S.adv = { view: 'top', draft: null, base: null, dirty: false, tab: { lock: 0, fac: 0, evt: 0 }, actOpen: {} };   // actOpen：出演の時間を開いているイベント（日のタブ:行）

  const pad = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? m[1].padStart(2, '0') + ':' + m[2] : ''; };
  const unpad = v => v ? v.replace(/^0(\d)/, '$1') : '';
  const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const nowMs = () => (typeof window.festClockNow === 'function' ? window.festClockNow() : Date.now());
  function msg(t, err) { const m = $('faMsg'); if (m) { m.textContent = t || ''; m.classList.toggle('err', !!err); } }

  function open() {
    if (!U.isFull()) { if (typeof showStatus === 'function') { showStatus('高度な設定は本部版だけで使えます', false); hideStatusLater(); } return; }
    const ov = $('festAdvOverlay'); if (!ov) return;
    A.view = 'top'; A.draft = null; A.dirty = false; ov.classList.add('open'); render();
    if (U.hasKey()) S.reload();
  }
  function close() {
    if (A.dirty && !confirm('保存していない変更があります。閉じますか？（変更は消えます）')) return;
    $('festAdvOverlay').classList.remove('open'); A.draft = null; A.dirty = false; S.setPreview(null);
  }
  A.open = open; A.close = close;
  function ensureDraft() { if (!A.draft) { A.draft = U.normDoc(S.data); A.base = S.updatedAtMs; A.dirty = false; } }
  function changed(rerender) { A.dirty = true; S.setPreview(A.draft); if (rerender) render(); }   // この端末の黒帯で試す
  // 新しい版が届いた：まだ手を付けていない下書きは作り直す
  S.hooks.push(() => { const ov = $('festAdvOverlay'); if (ov && ov.classList.contains('open') && (!A.draft || (!A.dirty && A.base !== S.updatedAtMs))) { A.draft = null; render(); } });

  // ---------- 日付のタブ（開錠・施錠／学内施設／イベントで共通） ----------
  function dayList(kind) { const D = A.draft; return kind === 'lock' ? D.days.map(x => x.d) : kind === 'fac' ? D.fac.days : D.evt.map(x => x.d); }
  function tabsHtml(kind) {
    const L = dayList(kind); if (A.tab[kind] >= L.length) A.tab[kind] = Math.max(0, L.length - 1);
    return '<div class="fs-tabs">' + L.map((d, i) => '<button type="button" data-act="tab" data-kind="' + kind + '" data-i="' + i + '" class="' + (i === A.tab[kind] ? 'on' : '') + '">' + U.dayLabel(d, true) + '</button>').join('')
      + '<span class="fs-add"><input type="date" id="faNewDay" aria-label="追加する日" /><button type="button" data-act="addDay" data-kind="' + kind + '">日を追加</button></span></div>';
  }
  function addDay(kind) {
    const v = $('faNewDay').value, D = A.draft;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { msg('追加する日を選んでください', true); return; }
    if (dayList(kind).indexOf(v) >= 0) { msg('その日はすでにあります', true); return; }
    if (kind === 'lock') D.days.push({ d: v, items: [] });
    else if (kind === 'fac') D.fac.days.push(v);
    else D.evt.push({ d: v, items: [] });
    if (kind === 'fac') D.fac.days.sort(); else (kind === 'lock' ? D.days : D.evt).sort((a, b) => a.d < b.d ? -1 : 1);
    A.tab[kind] = dayList(kind).indexOf(v); changed(true);
  }
  function delDay(kind) {
    const L = dayList(kind), d = L[A.tab[kind]], D = A.draft; if (!d) return;
    if (!confirm(U.dayLabel(d, true) + ' の' + TITLE[kind] + 'を削除します')) return;
    if (kind === 'lock') D.days.splice(A.tab[kind], 1);
    else if (kind === 'fac') { D.fac.days.splice(A.tab[kind], 1); D.fac.items.forEach(x => delete x.h[d]); }
    else D.evt.splice(A.tab[kind], 1);
    A.tab[kind] = 0; changed(true);
  }
  const delDayBtn = (kind, d) => '<button type="button" class="set-save ghost fs-del" data-act="delDay" data-kind="' + kind + '">この日（' + U.dayLabel(d, true) + '）を削除</button>';
  const noDay = '<div class="set-help">日がありません。「日を追加」で作成してください。</div>';

  // ---------- 各画面 ----------
  function viewTop() {
    const D = A.draft, b = D.band, day = S.bandDay();   // 編集中は S.preview（この下書き）で判定する
    const nAct = D.evt.reduce((t, d) => t + d.items.reduce((u, x) => u + x.acts.length, 0), 0);
    const cnt = { lock: D.days.length + '日', fac: D.fac.items.length + '施設', evt: D.evt.length + '日' + (nAct ? '・出演' + nAct + '件' : ''), info: D.info.filter(m => m.on).length + '/' + D.info.length + '件' };
    let h = '<div class="fa-menu">' + ['lock', 'fac', 'evt', 'info'].map(k => '<button type="button" data-go="' + k + '"><b>' + TITLE[k] + '</b><small>' + cnt[k] + '</small></button>').join('') + '</div>';
    h += '<div class="fs-sec"><div class="set-label">黒帯の表示</div>'
      + '<label class="fa-line"><input type="checkbox" data-k="dateOnly"' + (b.dateOnly ? ' checked' : '') + ' /><span>日付で絞る（期間中はその日の情報だけを流す）</span></label>'
      + '<div class="fa-line fa-period"><span>期間</span><input type="date" data-k="from" value="' + esc(b.from) + '" /><span>〜</span><input type="date" data-k="to" value="' + esc(b.to) + '" /></div>'
      + '<div class="set-help">期間外と、OFFのときは全日程の情報を順に流します。期間が空欄なら、情報のある日の最初〜最後です。今日は<b>' + (day ? U.dayLabel(day, true) + 'の情報だけ' : '全日程') + '</b>を流します。</div>';
    h += '<div class="fa-src"><span>流す</span><span>情報</span><span>文字の色</span><span>1ページ</span>'
      + U.SRC.map(k => { const c = b.src[k]; return '<input type="checkbox" data-k="src.on" data-s="' + k + '"' + (c.on ? ' checked' : '') + ' aria-label="' + U.SRC_NAME[k] + 'を流す" />'
        + '<b>' + TITLE[k] + '</b><input type="color" data-k="src.col" data-s="' + k + '" value="' + esc(c.col) + '" aria-label="' + U.SRC_NAME[k] + 'の文字の色" />'
        + '<span class="fa-sec-in"><input type="number" min="2" max="60" step="0.5" inputmode="decimal" data-k="src.sec" data-s="' + k + '" value="' + c.sec + '" />秒</span>'; }).join('') + '</div>';
    h += '<div class="set-label fa-sub">流す順番</div><div class="fa-seq">'
      + b.seq.map((q, i) => '<div class="fa-seq-row"><span class="fa-no">' + (i + 1) + '</span><select data-k="seq.s" data-i="' + i + '">' + U.SRC.map(k => '<option value="' + k + '"' + (q.s === k ? ' selected' : '') + '>' + TITLE[k] + '</option>').join('') + '</select>'
        + '<span>を</span><input type="number" min="1" max="20" inputmode="numeric" data-k="seq.n" data-i="' + i + '" value="' + q.n + '" /><span>回</span>'
        + '<button type="button" data-act="seqUp" data-i="' + i + '"' + (i ? '' : ' disabled') + ' aria-label="上へ">↑</button><button type="button" data-act="seqDown" data-i="' + i + '"' + (i < b.seq.length - 1 ? '' : ' disabled') + ' aria-label="下へ">↓</button>'
        + '<button type="button" data-act="seqDel" data-i="' + i + '"' + (b.seq.length > 1 ? '' : ' disabled') + '>削除</button></div>').join('')
      + '</div><button type="button" class="set-save ghost fa-addbtn" data-act="seqAdd"' + (b.seq.length >= 12 ? ' disabled' : '') + '>手順を追加</button>'
      + '<div class="set-help">上から順に流し、最後まで流したら最初に戻ります。1回＝その情報の全ページを1度ずつ。例：開錠・施錠時間を3回 → イベント時間を1回。<br>ステージ出演は「イベント時間」の各ステージの中で入力します。長い文は、表示してから左へ流して最後まで見せます。</div></div>';
    return h;
  }
  function viewLock() {
    const D = A.draft, day = D.days[A.tab.lock];
    let h = '<div class="set-help">各号館の開錠・施錠時刻。4号館は420教室、10号館は10101教室が基準です。</div>' + tabsHtml('lock');
    if (!day) return h + noDay;
    h += '<div class="fs-grid"><span></span><span>開錠</span><span>施錠</span>' + U.FAC.map(([f, n]) => { const it = day.items.find(x => x.f === f) || { o: '', c: '' };
      return '<span class="fs-fac">' + n + (U.FAC_NOTE[f] ? '<small>' + U.FAC_NOTE[f] + '</small>' : '') + '</span><input type="time" data-k="lock" data-f="' + f + '" data-o="o" value="' + pad(it.o) + '" /><input type="time" data-k="lock" data-f="' + f + '" data-o="c" value="' + pad(it.c) + '" />'; }).join('') + '</div>';
    return h + delDayBtn('lock', day.d);
  }
  function viewFac() {
    const D = A.draft, d = D.fac.days[A.tab.fac];
    let h = '<div class="set-help">食堂・セブンイレブンなど、学内施設の営業時間。施設名はすべての日で共通です。</div>' + tabsHtml('fac');
    if (!d) return h + noDay;
    h += '<div class="fa-fac">' + D.fac.items.map((x, i) => {
      const v = x.h[d] || '', m = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(v), closed = v === '休業', free = v && !m && !closed;
      return '<div class="fa-row"><input type="text" maxlength="30" data-k="fac.n" data-i="' + i + '" value="' + esc(x.n) + '" placeholder="施設名（例：食堂）" /><button type="button" data-act="facDel" data-i="' + i + '">削除</button>'
        + '<div class="fa-row-t">' + (free ? '<input type="text" class="fa-free" maxlength="24" data-k="fac.free" data-i="' + i + '" value="' + esc(v) + '" />'
          : '<input type="time" data-k="fac.from" data-i="' + i + '" value="' + (m ? pad(m[1]) : '') + '"' + (closed ? ' disabled' : '') + ' aria-label="開始" /><span>〜</span><input type="time" data-k="fac.to" data-i="' + i + '" value="' + (m ? pad(m[2]) : '') + '"' + (closed ? ' disabled' : '') + ' aria-label="終了" />')
        + '<label><input type="checkbox" data-k="fac.off" data-i="' + i + '"' + (closed ? ' checked' : '') + ' />休業</label></div></div>';
    }).join('') + '</div><button type="button" class="set-save ghost fa-addbtn" data-act="facAdd"' + (D.fac.items.length >= 20 ? ' disabled' : '') + '>施設を追加</button>';
    return h + '<div class="set-help">時刻も休業も入れない日は流しません。</div>' + delDayBtn('fac', d);
  }
  function viewEvt() {
    const D = A.draft, day = D.evt[A.tab.evt];
    let h = '<div class="set-help">屋台（出店グランプリと同じ時間）・LIVE STAGE・Green Stage・フリーマーケットなど。</div>' + tabsHtml('evt');
    if (!day) return h + noDay;
    h += '<div class="fa-evt">' + day.items.map((x, i) => '<div class="fa-row"><input type="text" maxlength="30" data-k="evt.n" data-i="' + i + '" value="' + esc(x.n) + '" placeholder="名称" />'
      + '<span class="fa-bts"><button type="button" data-act="evtUp" data-i="' + i + '"' + (i ? '' : ' disabled') + ' aria-label="上へ">↑</button><button type="button" data-act="evtDel" data-i="' + i + '">削除</button></span>'
      + '<div class="fa-row-t"><input type="time" data-k="evt.from" data-i="' + i + '" value="' + pad(x.from) + '" aria-label="開始" /><span>〜</span><input type="time" data-k="evt.to" data-i="' + i + '" value="' + pad(x.to) + '" aria-label="終了" />'
      + '<input type="text" maxlength="40" class="fa-note" data-k="evt.note" data-i="' + i + '" value="' + esc(x.note) + '" placeholder="メモ（例：開場15:00）" /></div>' + actsHtml(x, i) + '</div>').join('')
      + '</div><div class="fa-presets"><span>追加：</span>' + EVT_PRESET.concat(['その他']).map(n => '<button type="button" data-act="evtAdd" data-n="' + esc(n === 'その他' ? '' : n) + '">' + esc(n) + '</button>').join('') + '</div>';
    return h + delDayBtn('evt', day.d);
  }
  function actsHtml(x, i) {   // ステージの出演ごとの時間（黒帯では「ステージ出演」として流す）
    const open = A.actOpen[A.tab.evt + ':' + i];
    let h = '<div class="fa-acts-h"><button type="button" data-act="actToggle" data-i="' + i + '">' + (open ? '出演の時間を閉じる' : '出演の時間（' + x.acts.length + '件）') + '</button></div>';
    if (!open) return h;
    return h + '<div class="fa-acts">' + x.acts.map((a, j) => '<div class="fa-row"><input type="text" maxlength="40" data-k="act.n" data-i="' + i + '" data-j="' + j + '" value="' + esc(a.n) + '" placeholder="出演者・団体" />'
      + '<span class="fa-bts"><button type="button" data-act="actUp" data-i="' + i + '" data-j="' + j + '"' + (j ? '' : ' disabled') + ' aria-label="上へ">↑</button><button type="button" data-act="actDel" data-i="' + i + '" data-j="' + j + '">削除</button></span>'
      + '<div class="fa-row-t"><input type="time" data-k="act.from" data-i="' + i + '" data-j="' + j + '" value="' + pad(a.from) + '" aria-label="開始" /><span>〜</span><input type="time" data-k="act.to" data-i="' + i + '" data-j="' + j + '" value="' + pad(a.to) + '" aria-label="終了" />'
      + '<input type="text" maxlength="30" class="fa-note" data-k="act.note" data-i="' + i + '" data-j="' + j + '" value="' + esc(a.note) + '" placeholder="メモ（例：チケット制）" /></div></div>').join('')
      + '<button type="button" class="set-save ghost fa-addbtn" data-act="actAdd" data-i="' + i + '"' + (x.acts.length >= 20 ? ' disabled' : '') + '>出演を追加</button></div>';
  }
  function viewInfo() {
    const D = A.draft, ds = U.datesOf(D);
    let h = '<div class="set-help">「流す」に印のある文を、黒帯の順番どおりに流します（流す日を選ぶと、期間中はその日だけ）。<br>「今すぐ1回流す」は保存と同時に各端末へ届き、次のページの前に1回はさみます（1分以内・30分を過ぎたら流しません）。</div>';
    h += '<div class="fa-info">' + (D.info.length ? D.info.map((m, i) => {
      const opts = [''].concat(ds, m.d && ds.indexOf(m.d) < 0 ? [m.d] : []);
      return '<div class="fa-msg-card' + (m.on ? '' : ' off') + '"><textarea maxlength="120" rows="2" data-k="info.t" data-i="' + i + '">' + esc(m.t) + '</textarea>'
        + '<div class="fa-msg-ops"><label><input type="checkbox" data-k="info.on" data-i="' + i + '"' + (m.on ? ' checked' : '') + ' />流す</label>'
        + '<select data-k="info.d" data-i="' + i + '" aria-label="流す日">' + opts.map(d => '<option value="' + d + '"' + (m.d === d ? ' selected' : '') + '>' + (d ? U.dayLabel(d, true) + 'だけ' : '毎日') + '</option>').join('') + '</select>'
        + '<button type="button" data-act="infoNow" data-i="' + i + '">今すぐ1回流す</button><button type="button" data-act="infoDel" data-i="' + i + '">削除</button></div></div>';
    }).join('') : '<div class="set-help">まだありません。</div>') + '</div>';
    h += '<div class="set-label fa-sub">メッセージを追加</div><textarea id="faNewMsg" maxlength="120" rows="2" placeholder="黒帯に流す文（120文字まで）"></textarea>'
      + '<div class="share-row"><button type="button" class="set-save ghost" data-act="infoAdd">追加</button><button type="button" class="set-save ghost" data-act="infoAddNow">追加して今すぐ1回流す</button></div>';
    return h;
  }

  function render() {
    const body = $('festAdvBody'); if (!body) return;
    $('faTitle').textContent = TITLE[A.view];
    if (!U.hasKey() || S.error === 'auth') { body.innerHTML = '<div class="set-help">閲覧キーが使えません。本部版のリンクを開き直してください。</div>'; return; }
    if (!S.loaded) { body.innerHTML = '<div class="set-help">' + (S.error && !S.loading ? '時刻表を読み込めませんでした（通信を確認してください）。読み込めるまで編集できません。' : '時刻表を読み込んでいます…') + '</div>'; return; }
    ensureDraft();
    const V = { top: viewTop, lock: viewLock, fac: viewFac, evt: viewEvt, info: viewInfo }[A.view];
    const keepMsg = $('faMsg') && $('faMsg').textContent, keepErr = $('faMsg') && $('faMsg').classList.contains('err');
    body.innerHTML = (A.view !== 'top' ? '<button type="button" class="fa-back" data-go="top">‹ 高度な設定に戻る</button>' : '') + V()
      + '<div class="fa-foot"><div class="share-row"><button class="set-save" type="button" data-act="save">保存</button><button class="set-save ghost" type="button" data-act="reset">変更を取り消す</button></div>'
      + '<div class="set-msg" id="faMsg"></div><div class="fa-note-s">' + (A.dirty ? '保存していない変更があります（この端末の黒帯で試しています）。保存すると各端末に1分以内に届きます。' : (S.updatedAtMs ? '最終更新 ' + new Date(S.updatedAtMs + 9 * 3600000).toISOString().slice(5, 16).replace('T', ' ').replace('-', '/') : '')) + '</div></div>';
    if (keepMsg) msg(keepMsg, keepErr);
  }
  A.render = render;

  // ---------- 入力 → 下書き ----------
  function onInput(e) {
    const t = e.target, k = t.dataset && t.dataset.k; if (!k || !A.draft) return;
    const D = A.draft, b = D.band, i = +t.dataset.i, v = t.value;
    const live = e.type === 'input';   // 文字の入力中は描き直さない
    switch (k) {
      case 'dateOnly': if (live) return; b.dateOnly = t.checked; return changed(true);
      case 'from': case 'to': if (live) return; b[k] = v || ''; return changed(true);
      case 'src.on': if (live) return; b.src[t.dataset.s].on = t.checked; return changed();
      case 'src.col': b.src[t.dataset.s].col = v; return changed();
      case 'src.sec': { if (live) return; const n = Math.round(Math.min(60, Math.max(2, +v || 7.5)) * 2) / 2; b.src[t.dataset.s].sec = n; t.value = n; return changed(); }
      case 'seq.s': if (live) return; b.seq[i].s = v; return changed();
      case 'seq.n': { if (live) return; const n = Math.min(20, Math.max(1, Math.round(+v) || 1)); b.seq[i].n = n; t.value = n; return changed(); }
      case 'lock': {
        if (live) return;
        const day = D.days[A.tab.lock], f = t.dataset.f; let it = day.items.find(x => x.f === f);
        if (!it) { it = { f, o: '', c: '' }; day.items.push(it); }
        it[t.dataset.o] = unpad(v);
        day.items = day.items.filter(x => x.o || x.c).sort((a, c) => U.FAC.findIndex(x => x[0] === a.f) - U.FAC.findIndex(x => x[0] === c.f));
        return changed();
      }
      case 'fac.n': D.fac.items[i].n = v; return changed();
      case 'fac.free': { const d = D.fac.days[A.tab.fac]; if (v.trim()) D.fac.items[i].h[d] = v.trim(); else delete D.fac.items[i].h[d]; return changed(); }
      case 'fac.from': case 'fac.to': case 'fac.off': {
        if (live) return;
        const d = D.fac.days[A.tab.fac], x = D.fac.items[i], row = t.closest('.fa-fac');
        const from = unpad(row.querySelector('[data-k="fac.from"][data-i="' + i + '"]') ? row.querySelector('[data-k="fac.from"][data-i="' + i + '"]').value : '');
        const to = unpad(row.querySelector('[data-k="fac.to"][data-i="' + i + '"]') ? row.querySelector('[data-k="fac.to"][data-i="' + i + '"]').value : '');
        if (k === 'fac.off' ? t.checked : false) x.h[d] = '休業';
        else if (from && to) x.h[d] = from + '-' + to;
        else delete x.h[d];
        return changed(k === 'fac.off');
      }
      case 'evt.n': case 'evt.note': D.evt[A.tab.evt].items[i][k.slice(4)] = v; return changed();
      case 'evt.from': case 'evt.to': if (live) return; D.evt[A.tab.evt].items[i][k.slice(4)] = unpad(v); return changed();
      case 'act.n': case 'act.note': D.evt[A.tab.evt].items[i].acts[+t.dataset.j][k.slice(4)] = v; return changed();
      case 'act.from': case 'act.to': if (live) return; D.evt[A.tab.evt].items[i].acts[+t.dataset.j][k.slice(4)] = unpad(v); return changed();
      case 'info.t': D.info[i].t = v; return changed();
      case 'info.on': if (live) return; D.info[i].on = t.checked; return changed(true);
      case 'info.d': if (live) return; D.info[i].d = v; return changed();
    }
  }
  function swap(L, i, j) { const x = L[i]; L[i] = L[j]; L[j] = x; }
  function onClick(e) {
    const g = e.target.closest('[data-go]');
    if (g) { A.view = g.dataset.go; render(); msg(''); $('festAdvBody').scrollTop = 0; const m = $('festAdvOverlay').querySelector('.modal'); if (m) m.scrollTop = 0; return; }
    const a = e.target.closest('[data-act]'); if (!a || !A.draft) return;
    const D = A.draft, i = +a.dataset.i;
    switch (a.dataset.act) {
      case 'save': return save();
      case 'reset': A.draft = null; A.dirty = false; S.setPreview(null); render(); return;
      case 'tab': A.tab[a.dataset.kind] = i; A.actOpen = {}; return render();
      case 'addDay': return addDay(a.dataset.kind);
      case 'delDay': return delDay(a.dataset.kind);
      case 'seqUp': swap(D.band.seq, i, i - 1); return changed(true);
      case 'seqDown': swap(D.band.seq, i, i + 1); return changed(true);
      case 'seqDel': D.band.seq.splice(i, 1); return changed(true);
      case 'seqAdd': D.band.seq.push({ s: 'evt', n: 1 }); return changed(true);
      case 'facAdd': D.fac.items.push({ n: '', h: {} }); return changed(true);
      case 'facDel': if (D.fac.items[i].n && !confirm('「' + D.fac.items[i].n + '」を削除します（すべての日）')) return; D.fac.items.splice(i, 1); return changed(true);
      case 'evtAdd': D.evt[A.tab.evt].items.push({ n: a.dataset.n || '', from: '', to: '', note: '', acts: [] }); return changed(true);
      case 'actToggle': { const key = A.tab.evt + ':' + i; A.actOpen[key] = !A.actOpen[key]; return render(); }
      case 'actAdd': D.evt[A.tab.evt].items[i].acts.push({ n: '', from: '', to: '', note: '' }); A.actOpen[A.tab.evt + ':' + i] = true; return changed(true);
      case 'actUp': { const L = D.evt[A.tab.evt].items[i].acts, j = +a.dataset.j; swap(L, j, j - 1); return changed(true); }
      case 'actDel': D.evt[A.tab.evt].items[i].acts.splice(+a.dataset.j, 1); return changed(true);
      case 'evtUp': swap(D.evt[A.tab.evt].items, i, i - 1); return changed(true);
      case 'evtDel': if (D.evt[A.tab.evt].items[i].acts.length && !confirm('「' + D.evt[A.tab.evt].items[i].n + '」と出演の時間（' + D.evt[A.tab.evt].items[i].acts.length + '件）を削除します')) return; D.evt[A.tab.evt].items.splice(i, 1); A.actOpen = {}; return changed(true);
      case 'infoDel': if (!confirm('このメッセージを削除します')) return; D.info.splice(i, 1); return changed(true);
      case 'infoNow': D.info[i].u = Math.round(nowMs()); A.dirty = true; return save('「' + D.info[i].t.slice(0, 20) + (D.info[i].t.length > 20 ? '…' : '') + '」を各端末に送りました（1分以内に1回流れます）');
      case 'infoAdd': case 'infoAddNow': {
        const t = ($('faNewMsg').value || '').trim();
        if (!t) { msg('流す文を入れてください', true); return; }
        if (D.info.length >= 30) { msg('メッセージは30件までです', true); return; }
        const now = a.dataset.act === 'infoAddNow';
        D.info.push({ id: newId(), t, on: true, d: '', u: now ? Math.round(nowMs()) : 0 });
        if (now) { A.dirty = true; return save('追加して各端末に送りました（1分以内に1回流れます）'); }
        return changed(true);
      }
    }
  }

  // ---------- 保存 ----------
  function check(D) {
    if (D.fac.items.some(x => !String(x.n).trim())) return '学内施設時間：施設名が空の行があります';
    if (D.evt.some(d => d.items.some(x => !String(x.n).trim()))) return 'イベント時間：名称が空の行があります';
    if (D.evt.some(d => d.items.some(x => x.acts.some(y => !String(y.n).trim())))) return 'イベント時間：出演者・団体が空の行があります';
    if (D.info.some(m => !String(m.t).trim())) return 'インフォメーション：空のメッセージがあります';
    if (D.band.from && D.band.to && D.band.from > D.band.to) return '黒帯の表示：期間の始めが終わりより後です';
    if (!D.band.seq.length) return '黒帯の表示：流す順番がありません';
    return '';
  }
  async function save(okText) {
    if (!A.draft) return;
    if (!A.dirty) { msg('変更はありません'); return; }
    const D = A.draft, bad = check(D);
    if (bad) { msg(bad, true); return; }
    const had = ((S.data && S.data.days) || []).map(d => d.d), keep = D.days.map(d => d.d), gone = had.filter(d => keep.indexOf(d) < 0);
    if (gone.length && !confirm('次の日の開錠・施錠時刻が消えます：' + gone.map(d => U.dayLabel(d, true)).join('、') + '\nこのまま保存しますか？')) return;
    msg('保存しています…');
    const r = await U.saveDoc(D, A.base);
    if (r.ok) { A.draft = null; A.dirty = false; S.setPreview(null); render(); msg(typeof okText === 'string' ? okText : r.text); return; }
    msg(r.text, true);
  }

  // ---------- 初期化 ----------
  const ov = $('festAdvOverlay');
  if (ov) {
    $('festAdvClose').onclick = close;
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    const body = $('festAdvBody');
    body.addEventListener('click', onClick);
    body.addEventListener('input', onInput);
    body.addEventListener('change', onInput);
  }
})();
