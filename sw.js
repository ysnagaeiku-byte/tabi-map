// たびマップ Service Worker — アプリシェルをキャッシュしオフライン起動を可能に。
// 地図タイル/Places/Routes 等のクロスオリジンは常にネットワーク（キャッシュしない）。
const CACHE = 'tabimap-v6';   // アプリ情報（manifest）を変えたら上げる（保存済みの古いアプリ情報を使い続けないように）
const PHOTO_CACHE = 'tabimap-photos-v1';   // 温泉郷・観光特集の写真（guide/photos/）。見た分だけ保存し、件数に上限を設ける
const PHOTO_MAX = 200;                     // 写真の保存は新しい順に200枚まで（1枚おおむね50KB＝約10MB）。古いものから消す
const SHELL = ['./index-google.html', './manifest.json', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  './manifest-senshu.json', './icon-senshu-192.png', './icon-senshu-512.png', './icon-senshu-maskable-512.png', './apple-touch-icon-senshu.png'];   // 本祭支援ツール（別アプリ）

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== PHOTO_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// 写真の保存数を上限までに（cache.keys() は保存した順）
async function trimPhotos(c) {
  const ks = await c.keys();
  for (let i = 0; i < ks.length - PHOTO_MAX; i++) await c.delete(ks[i]);
}
// 「?v=」付きの資産を保存したら、同じファイルの別の版を消す（更新後に古いデータが残り続けない・混ざらない）
async function dropOldVersions(c, req) {
  const u = new URL(req.url);
  if (!u.searchParams.has('v')) return;
  for (const k of await c.keys()) {
    const ku = new URL(k.url);
    if (ku.pathname === u.pathname && ku.search !== u.search) await c.delete(k);
  }
}
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.headers.has('Authorization')) return;      // 認証付きの要求（車両の位置の閲覧API等）は保存しない
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;        // 地図/API等はそのままネットワーク
  if (/\/(api|ingest)\//.test(url.pathname)) return;  // 位置のAPIは同じオリジンでも保存しない
  if (/\/shift\//.test(url.pathname)) return;        // シフト管理（shift/）は別のページ：地図のキャッシュに混ぜず、いつもネットワークから
  if (req.mode === 'navigate') {                      // ページ遷移：ネット優先・失敗時はキャッシュのシェル
    e.respondWith(
      fetch(req).then(r => { if (url.pathname.endsWith('index-google.html')) { const cp = r.clone(); caches.open(CACHE).then(c => c.put('./index-google.html', cp)); } return r; })
                .catch(() => caches.match('./index-google.html'))
    );
    return;
  }
  if (/\/guide\/photos\/[0-9a-f]{16}\.webp$/.test(url.pathname)) {   // 写真：名前＝中身のハッシュなので保存分をそのまま使える
    e.respondWith(caches.open(PHOTO_CACHE).then(c => c.match(req).then(hit => hit || fetch(req).then(r => {
      if (r.ok) { const cp = r.clone(); e.waitUntil(c.put(req, cp).then(() => trimPhotos(c))); }
      return r;
    }))));
    return;
  }
  e.respondWith(                                      // 同一オリジン資産：キャッシュ優先・無ければ取得して保存
    caches.match(req).then(c => c || fetch(req).then(r => {
      if (r.ok) { const cp = r.clone(); e.waitUntil(caches.open(CACHE).then(ca => ca.put(req, cp).then(() => dropOldVersions(ca, req)))); }
      return r;
    }))
  );
});
