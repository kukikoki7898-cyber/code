/*
 * 우리 반 1인 1역 - 인터넷이 끊겨도 앱 화면이 열리도록 보관하는 서비스 워커
 *
 *   앱 화면(같은 주소의 파일): 인터넷이 되면 항상 새로 받아 보관하고, 끊겼거나 4초 안에 응답이 없으면 보관본을 쓴다.
 *   글꼴(Google Fonts): 한 번 받은 것을 계속 쓴다.
 *   그 밖의 주소(구글 로그인, 구글 시트·드라이브 API)는 건드리지 않는다.
 *
 * 같은 파일이 저장소 맨 위(sw.js)와 docs/sw.js 에 있다. GitHub Pages 를 어느 폴더로 설정해도 동작하게 하기 위해서다.
 */
var CACHE = 'one-role-v1';
var CORE = ['./', 'index.html', 'privacy.html', 'config.js', 'manifest.json', 'icon.svg',
  'docs/', 'docs/index.html', 'docs/privacy.html', 'docs/config.js', 'docs/manifest.json', 'docs/icon.svg'];
var FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    // 없는 파일(폴더 설정에 따라 다름)이 있어도 설치가 실패하지 않게 하나씩 넣는다
    return Promise.all(CORE.map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('one-role-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function keyOf(url) { var u = new URL(url); return u.origin + u.pathname; }   // ?c=학급 같은 꼬리는 떼고 보관

function networkFirst(req) {
  return caches.open(CACHE).then(function (c) {
    var net = fetch(req).then(function (res) {
      if (res && res.ok) c.put(keyOf(req.url), res.clone());
      return res;
    });
    return c.match(keyOf(req.url)).then(function (hit) {
      if (!hit) return net;                       // 보관본이 없으면 인터넷을 기다린다
      var slow = new Promise(function (resolve) { setTimeout(function () { resolve(hit); }, 4000); });
      return Promise.race([net.catch(function () { return hit; }), slow]);
    });
  });
}

function cacheFirst(req) {
  return caches.open(CACHE).then(function (c) {
    return c.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) { if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()); return res; });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var u = new URL(req.url);
  if (u.origin === self.location.origin) { e.respondWith(networkFirst(req)); return; }
  if (FONT_HOSTS.indexOf(u.hostname) >= 0) { e.respondWith(cacheFirst(req)); return; }
  // 구글 로그인·API 는 그대로 보낸다
});
