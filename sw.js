// たびマップ Service Worker — アプリシェルをキャッシュしオフライン起動を可能に。
// 地図タイル/Places/Routes 等のクロスオリジンは常にネットワーク（キャッシュしない）。
const CACHE = 'tabimap-v1';
const SHELL = ['./index-google.html', './manifest.json', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;        // 地図/API等はそのままネットワーク
  if (req.mode === 'navigate') {                      // ページ遷移：ネット優先・失敗時はキャッシュのシェル
    e.respondWith(
      fetch(req).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put('./index-google.html', cp)); return r; })
                .catch(() => caches.match('./index-google.html'))
    );
    return;
  }
  e.respondWith(                                      // 同一オリジン資産：キャッシュ優先・無ければ取得して保存
    caches.match(req).then(c => c || fetch(req).then(r => { const cp = r.clone(); caches.open(CACHE).then(ca => ca.put(req, cp)); return r; }))
  );
});
