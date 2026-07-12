/* ============================================================
 *  NAVBATSIZ service worker — ataylab MINIMAL (mijoz oqimi uchun)
 *  Strategiya: network-first, tarmoq bo'lmasa keshdan (offline'da
 *  sahifa hech bo'lmaganda ochiladi va "aloqa uzildi" holatini
 *  ko'rsatadi). Panel/admin keshlanmaydi — ular doim jonli bo'lsin.
 *  Yangi versiya chiqarganda CACHE nomini oshiring — eski kesh o'chadi.
 * ============================================================ */
var CACHE = 'navbatsiz-v2';
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

/* ============================================================
 *  PUSH — "navbatingiz yaqinlashdi" / "chaqirildingiz"
 *  Payload: { title, body, url, tag }  (send-push Edge Function yuboradi)
 * ============================================================ */
self.addEventListener('push', function (e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { body: e.data ? e.data.text() : '' }; }
  var title = data.title || 'Navbatsiz';
  var opts = {
    body: data.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: data.tag || 'navbatsiz',      // bir xil tag -> eski bildirishnoma almashadi
    renotify: true,
    vibrate: [200, 80, 200],
    data: { url: data.url || 'mijoz.html' }
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || 'mijoz.html';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      // Ochiq mijoz oynasi bo'lsa — o'shani fokuslaymiz va yo'naltiramiz
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url.indexOf('mijoz.html') !== -1 && 'focus' in c) {
          if ('navigate' in c) { try { c.navigate(url); } catch (err) {} }
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
