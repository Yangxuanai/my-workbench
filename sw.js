/* Service Worker：让工作台离线也能打开
   策略：
   - 应用外壳（HTML/CSS/JS/图标）预缓存，缓存优先
   - 内容与数据文件（news / music / data/*.json）走「网络优先」，取不到时回退缓存
     这样换内容立刻生效，断网时也有上一次的内容可看
*/
const VERSION = 'wb-v2.0.0';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './js/time.js',
  './js/data.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];
/* 内容库：安装时也预取一份，保证首次离线可用 */
const CONTENT = [
  './news.json',
  './music.json',
  './data/english.json',
  './data/life.json',
  './data/media.json',
  './data/expression.json',
  './data/plan.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) =>
      Promise.all(
        SHELL.concat(CONTENT).map((u) =>
          c.add(new Request(u, { cache: 'reload' })).catch(() => {
            /* 单个文件失败不影响整体安装 */
          })
        )
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isContent = /\/(news|music)\.json$/.test(url.pathname) ||
    /\/data\/[\w-]+\.json$/.test(url.pathname);

  if (isContent) {
    /* 内容文件：网络优先，离线回退缓存 */
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  /* 其他同源资源：缓存优先，后台补充 */
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req).then((hit) => {
        const fetching = fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
            return res;
          })
          .catch(() => hit);
        return hit || fetching;
      })
    );
    return;
  }

  /* 第三方（如网易云播放器）：直接网络请求，不缓存 */
});
