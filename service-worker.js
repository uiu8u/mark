const CACHE_NAME = 'grocery-store-v2.2'; // ◄ غيّرته v2.1→v2.2 لإجبار الأجهزة القديمة على التحديث فوراً (مرة واحدة فقط)

const CORE_ASSETS = ['/', '/index.html', '/style.css', '/app.js']; // يتحدّث دائماً من الشبكة
const STATIC_ASSETS = [ // ثابتة فعلياً — كاش أولاً
  '/manifest.json', '/icon-192.png', '/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll([...CORE_ASSETS, ...STATIC_ASSETS])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => k !== CACHE_NAME && caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return; // ◄ يتجاهل طلبات Auth/POST بدل تمريرها عبر الكاش بلا فائدة
  const url = e.request.url;
  if (url.includes('firestore') || url.includes('/api/')) return;

  const path = new URL(url).pathname;
  const isCore = e.request.mode === 'navigate' || CORE_ASSETS.includes(path);

  if (isCore) {
    // ◄ Network First: يضمن وصول آخر نسخة من الكود دائماً، ويسقط على الكاش فقط عند انقطاع النت
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    e.respondWith(caches.match(e.request).then((cached) => cached || fetch(e.request)));
  }
});
