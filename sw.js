// Ontei Service Worker
//  - ページ本体（index.html / ナビゲーション）: ネットワーク優先。オンラインなら必ず最新版を読み込み、
//    オフライン時だけキャッシュを使う。（以前の stale-while-revalidate では、更新後も 1 回目の
//    再読み込みで古い版が表示されていた）
//  - Vite が出力するハッシュ付きファイル（assets/*）: 中身が変わると名前も変わるのでキャッシュ優先。
const CACHE_NAME = 'ontei-cache-v2';

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(['./', './manifest.json'])));
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
            .then(() => self.clients.claim())
    );
});

function isHashedAsset(url) {
    return /\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.[a-z0-9]+$/.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (!url.protocol.startsWith('http') || url.origin !== self.location.origin) return;

    // ハッシュ付きアセット: キャッシュ優先
    if (isHashedAsset(url)) {
        event.respondWith(
            caches.open(CACHE_NAME).then((cache) =>
                cache.match(req).then((hit) => hit || fetch(req).then((res) => {
                    if (res.ok) cache.put(req, res.clone());
                    return res;
                }))
            )
        );
        return;
    }

    // それ以外（ページ本体・manifest・MIDI など）: ネットワーク優先、失敗時のみキャッシュ
    event.respondWith(
        fetch(req, { cache: 'no-store' }).then((res) => {
            if (res.ok) {
                const copy = res.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
            }
            return res;
        }).catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./') : undefined)))
    );
});
