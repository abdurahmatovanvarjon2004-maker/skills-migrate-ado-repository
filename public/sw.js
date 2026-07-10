/* ============================================================
 *  NAVBATSIZ service worker — ataylab MINIMAL (mijoz oqimi uchun)
 *  Strategiya: network-first, tarmoq bo'lmasa keshdan (offline'da
 *  sahifa hech bo'lmaganda ochiladi va "aloqa uzildi" holatini
 *  ko'rsatadi). Panel/admin keshlanmaydi — ular doim jonli bo'lsin.
 *  Yangi versiya chiqarganda CACHE nomini oshiring — eski kesh o'chadi.
 * ============================================================ */
var CACHE = 'navbatsiz-v1';
var ASSETS = [
  'mijoz.html',
  'navbatsiz-db.js',
  'qr.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // Har bir faylni alohida qo'shamiz — bittasi yiqilsa qolganlari kirsin
      return Promise.allSettled(ASSETS.map(function (a) { return c.add(a); }));
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  // Faqat o'z domenimizdagi GET so'rovlari; Supabase/API so'rovlariga tegmaymiz.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Panel/admin sahifalari keshlanmaydi (doim jonli)
  if (/panel\.html|admin\.html/.test(url.pathname)) return;

  e.respondWith(
    fetch(e.request).then(function (res) {
      // muvaffaqiyatli javobni keshga yangilab qo'yamiz
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
        return hit || caches.match('mijoz.html');
      });
    })
  );
});
