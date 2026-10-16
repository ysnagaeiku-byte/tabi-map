// たびマップ 本祭支援ツール：構内図（8号館・9号館・10号館の各階）
// 大学公式サイトが公開している各号館の配置図（PDF）を、ページ（階）ごとの画像にして受信APIに置いたものを表示する
// （/api/v1/floor/…。公開リポジトリには写しを置かない。入れ替えは tracking-worker/scripts/upload-floor.mjs）。
// 閲覧キーのない端末や、まだ画像が無いときは、公式のPDFをそのまま開く。建物の詳細カードの「構内図（各階）」から開く
(function () {
  'use strict';
  if (window.festFloor) return;

  const OFFICIAL = 'https://www.senshu-u.ac.jp/about/campus/ikuta.html';   // 出典（生田キャンパス：各号館の配置図）
  const BLD = {
    '8号館': { k: 'b8', pdf: 'https://www.senshu-u.ac.jp/albums/abm.php?d=73&f=abm00048548.pdf' },
    '9号館': { k: 'b9', pdf: 'https://www.senshu-u.ac.jp/albums/abm.php?d=73&f=abm00066210.pdf' },
    '10号館': { k: 'b10', pdf: 'https://www.senshu-u.ac.jp/albums/abm.php?d=73&f=abm00049296.pdf' },
  };
  const ZOOMS = [1, 1.5, 2, 3];
  const $ = id => document.getElementById(id);
  const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(String(s)) : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]));

  const F = window.festFloor = { has: n => Object.prototype.hasOwnProperty.call(BLD, n), open };
  const idx = {}, imgs = {};   // 号館 → 一覧、号館/ページ → 画像（Blob の URL）。一度読んだら使い回す
  const st = { name: '', pages: [], page: 0, zoom: 0, seq: 0 };

  function cfg() { const h = window.festHttp; return h ? h.config : { apiBase: '', viewerToken: '' }; }
  async function api(path) {
    const c = cfg();
    const r = await fetch(c.apiBase + '/api/v1/floor/' + path, { headers: { Authorization: 'Bearer ' + c.viewerToken }, cache: 'no-store', credentials: 'omit', mode: 'cors', referrerPolicy: 'no-referrer' });
    if (r.status === 401) throw Object.assign(new Error('auth'), { auth: true });
    if (r.status === 404) throw Object.assign(new Error('none'), { none: true });
    if (!r.ok) throw new Error('http ' + r.status);
    return r;
  }

  // ---------- 画面 ----------
  function ui() {
    let ov = $('festFloorOverlay'); if (ov) return ov;
    ov = document.createElement('div'); ov.className = 'overlay'; ov.id = 'festFloorOverlay';
    ov.innerHTML = '<div class="modal ff-modal"><div class="modal-h"><b id="ffTitle">構内図</b><button id="ffClose" type="button" aria-label="閉じる">✕</button></div>'
      + '<div class="ff-tabs" id="ffTabs"></div>'
      + '<div class="ff-view" id="ffView"><img id="ffImg" alt="" draggable="false" /><div class="ff-msg" id="ffMsg"></div></div>'
      + '<div class="ff-bar"><div class="ff-zoom"><button type="button" data-z="-1" aria-label="縮小">−</button><span id="ffZoom">100%</span><button type="button" data-z="1" aria-label="拡大">＋</button></div>'
      + '<a id="ffPdf" target="_blank" rel="noopener">公式のPDFを開く</a></div>'
      + '<div class="ff-src">出典：専修大学 公式サイト「<a href="' + OFFICIAL + '" target="_blank" rel="noopener">生田キャンパス</a>」の配置図（避難経路・消火栓・AEDの位置つき）</div></div>';
    document.body.appendChild(ov);
    const close = () => { ov.classList.remove('open'); st.seq++; };
    $('ffClose').onclick = close;
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    $('ffTabs').addEventListener('click', e => { const b = e.target.closest('button[data-p]'); if (!b) return; st.page = +b.dataset.p; tabs(); show(); $('ffView').scrollTo(0, 0); });
    ov.querySelector('.ff-zoom').addEventListener('click', e => { const b = e.target.closest('button[data-z]'); if (!b) return;
      const z = Math.max(0, Math.min(ZOOMS.length - 1, st.zoom + (+b.dataset.z))); if (z === st.zoom) return;
      const v = $('ffView'), cx = (v.scrollLeft + v.clientWidth / 2) / (v.scrollWidth || 1), cy = (v.scrollTop + v.clientHeight / 2) / (v.scrollHeight || 1);
      st.zoom = z; size(); v.scrollTo(cx * v.scrollWidth - v.clientWidth / 2, cy * v.scrollHeight - v.clientHeight / 2); });   // 見ている所を中心のまま拡大・縮小
    let rt = null; window.addEventListener('resize', () => { if (!ov.classList.contains('open')) return; clearTimeout(rt); rt = setTimeout(size, 150); });
    return ov;
  }
  function msg(t) { const m = $('ffMsg'); m.textContent = t || ''; m.style.display = t ? '' : 'none'; }
  function tabs() {
    const L = st.pages.map(p => p.label);
    $('ffTabs').innerHTML = L.length > 1 ? L.map((l, i) => '<button type="button" data-p="' + i + '" class="' + (i === st.page ? 'on' : '') + '">' + esc(l) + '</button>').join('') : (L[0] ? '<span class="ff-one">' + esc(L[0]) + '</span>' : '');
  }
  function size() {   // 枠の幅に合わせて表示し、倍率をかける（画像は 250dpi なので拡大しても読める）
    const p = st.pages[st.page], im = $('ffImg'), v = $('ffView'); if (!p) return;
    const w = Math.max(200, v.clientWidth - 2) * ZOOMS[st.zoom];
    im.style.width = Math.round(w) + 'px'; im.style.height = Math.round(w * p.h / p.w) + 'px';
    $('ffZoom').textContent = Math.round(ZOOMS[st.zoom] * 100) + '%';
  }
  async function show() {
    const p = st.pages[st.page], im = $('ffImg'), my = ++st.seq; if (!p) return;
    size(); im.removeAttribute('src');
    const key = BLD[st.name].k + '/' + p.page + '@' + p.updatedAtMs;
    try {
      if (!imgs[key]) { msg('読み込んでいます…'); imgs[key] = URL.createObjectURL(await (await api(BLD[st.name].k + '/' + p.page)).blob()); }
      if (my !== st.seq) return;   // 読み込み中に別の階・号館に切り替えた
      im.src = imgs[key]; msg('');
    } catch (e) { if (my === st.seq) msg('構内図を読み込めませんでした（通信を確認してください）。下の「公式のPDFを開く」からも見られます。'); }
  }

  async function open(name) {
    const b = BLD[name]; if (!b) return;
    const c = cfg();
    if (!c.apiBase || !c.viewerToken) { window.open(b.pdf, '_blank', 'noopener'); return; }   // 閲覧キーのない端末：公式のPDFを開く
    const ov = ui(); ov.classList.add('open');
    $('ffTitle').textContent = name + ' 構内図';
    $('ffPdf').href = b.pdf;
    st.name = name; st.page = 0; st.zoom = 0; st.pages = []; const my = ++st.seq;
    tabs(); $('ffImg').removeAttribute('src'); $('ffImg').style.width = $('ffImg').style.height = '0'; $('ffZoom').textContent = '100%';
    msg('構内図を読み込んでいます…');
    try {
      if (!idx[name]) idx[name] = (await (await api(b.k)).json()).pages || [];
      if (my !== st.seq) return;
      st.pages = idx[name]; tabs(); await show();
    } catch (e) {
      if (my !== st.seq) return;
      msg(e && e.auth ? '閲覧キーが使えないため、地図の中では表示できません。下の「公式のPDFを開く」から見てください。'
        : e && e.none ? 'この号館の構内図はまだ入っていません。下の「公式のPDFを開く」から見てください。'
        : '構内図を読み込めませんでした（通信を確認してください）。下の「公式のPDFを開く」からも見られます。');
    }
  }
})();
