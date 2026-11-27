// 여러 접속 환경 검사: 기기 크기·터치, 화면 회전, 다크 모드, 움직임 줄이기, 느린 기기, 구글 설치 버전(iframe)
//   node tools/build-web.js --mock <web.html> && node test/build-preview.js <gas.html>
//   node test/run-env.js <web.html> <gas.html> <스크린샷 폴더> [배포본 주소, 예: http://127.0.0.1:8765/ (저장소 맨 위를 띄운 것)]
var { chromium, devices } = require('playwright');
var path = require('path');
var results = [];
function check(name, ok, detail) { results.push((ok ? '통과 ' : '실패 ') + name + (detail !== undefined && detail !== '' ? '  (' + detail + ')' : '')); }
async function toast(p, re) { await p.waitForFunction(function (s) { var t = document.querySelector('.toast'); return t && new RegExp(s).test(t.textContent); }, re.source, { timeout: 15000 }); }
var ROSTER = []; for (var k = 1; k <= 24; k++) ROSTER.push('학생' + k + ' 역할 ' + k + (k % 6 === 0 ? ' 3' : ''));

// 화면이 넘치거나 겹치는 곳을 잰다
function layout(p) {
  return p.evaluate(function () {
    var vw = innerWidth, vh = innerHeight, out = { hscroll: document.documentElement.scrollWidth > vw + 1, clipped: [], overlap: false, smallTargets: [] };
    var top = document.querySelector('.top'), first = document.querySelector('.card');
    if (top && first) out.overlap = first.getBoundingClientRect().top < top.getBoundingClientRect().bottom - 2 && !document.querySelector('.board.low');
    [].forEach.call(document.querySelectorAll('.top *, .card, .btn, .modal'), function (e) {
      var r = e.getBoundingClientRect(); if (!r.width) return;
      if (r.right > vw + 1 || r.left < -1) out.clipped.push((e.className || e.tagName).toString().slice(0, 20));
    });
    [].forEach.call(document.querySelectorAll('button, [data-act], input, a'), function (e) {
      var r = e.getBoundingClientRect(); if (!r.width || getComputedStyle(e).visibility === 'hidden') return;
      if (Math.min(r.width, r.height) < 32 && !e.closest('.card')) out.smallTargets.push((e.textContent || e.getAttribute('data-act') || e.tagName).trim().slice(0, 12) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    });
    return out;
  });
}

async function flow(b, name, opts, shots, url) {
  var ctx = await b.newContext(opts), p = await ctx.newPage(), errs = [];
  p.on('pageerror', function (e) { errs.push(String(e)); });
  var touch = !!opts.hasTouch;
  var press = async function (sel) { if (touch) { await p.tap(sel); } else await p.click(sel); };
  await p.goto(url); await p.waitForSelector('#nc-name');
  var m = await p.evaluate(function () { var r = document.querySelector('.modal').getBoundingClientRect(); return { h: Math.round(r.height), top: Math.round(r.top), vh: innerHeight, scroll: document.querySelector('.modal').scrollHeight > document.querySelector('.modal').clientHeight + 1 }; });
  check(name + ': 학급 만들기 창이 화면 안에 있다', m.top >= 0 && (m.h <= m.vh || m.scroll), m.h + '/' + m.vh);
  await p.fill('#nc-name', name.slice(0, 18)); await p.fill('#nc-pw', '1234'); await press('[data-act=createclass]');
  await p.waitForSelector('#bulk'); await p.fill('#bulk', ROSTER.join('\n'));
  await press('[data-act=bulkset]'); await press('[data-act=saveroster]'); await toast(p, /저장했어요/);
  var sl = await layout(p);
  check(name + ': 설정 화면 가로 넘침 없음', !sl.hscroll, sl.clipped.slice(0, 3).join(','));
  await press('[data-act=board]'); await p.waitForSelector('.card');
  await p.waitForTimeout(300);
  var bl = await layout(p);
  check(name + ': 칠판 가로 넘침·잘림 없음', !bl.hscroll && !bl.clipped.length, bl.clipped.slice(0, 3).join(','));
  check(name + ': 머리 부분과 이름표가 겹치지 않음', !bl.overlap);
  await p.locator('#card-23').scrollIntoViewIfNeeded();
  await press('#card-23'); await p.waitForTimeout(500);
  check(name + ': 마지막 이름표까지 눌러서 도장', (await p.evaluate(function () { return document.querySelectorAll('#card-23 .slot.on').length; })) === 1);
  await p.evaluate(function () { scrollTo(0, 0); });
  await p.screenshot({ path: path.join(shots, 'env-' + name + '.png') });
  await press('[data-act=stickers]'); await p.waitForSelector('table.st');
  var st = await p.evaluate(function () { var w = document.querySelector('.wrap'); return { hscroll: document.documentElement.scrollWidth > innerWidth + 1, inner: w.scrollWidth > w.clientWidth + 1 }; });
  check(name + ': 스티커판이 화면 밖으로 밀리지 않음 (표만 옆으로 밀림)', !st.hscroll, st.inner ? '표 안에서 옆으로 밀기' : '');
  check(name + ': 오류 없음', errs.length === 0, errs.join(' | '));
  await ctx.close();
  return { board: bl, settings: sl };
}

(async function () {
  var web = 'file://' + process.argv[2], gas = 'file://' + process.argv[3], shots = process.argv[4];
  var b = await chromium.launch();
  var small = {};

  // ---- 1. 여러 기기 ----
  var list = [
    ['전자칠판FHD', { viewport: { width: 1920, height: 1080 }, hasTouch: true }],
    ['노트북', { viewport: { width: 1366, height: 768 } }],
    ['갤럭시탭가로', Object.assign({}, devices['Galaxy Tab S4 landscape'])],
    ['갤럭시탭세로', Object.assign({}, devices['Galaxy Tab S4'])],
    ['아이패드가로', Object.assign({}, devices['iPad (gen 7) landscape'])],
    ['아이패드세로', Object.assign({}, devices['iPad (gen 7)'])],
    ['아이폰', Object.assign({}, devices['iPhone 13'])],
    ['갤럭시폰', Object.assign({}, devices['Galaxy S9+'])]
  ];
  for (var i = 0; i < list.length; i++) {
    var r = await flow(b, list[i][0], list[i][1], shots, web);
    small[list[i][0]] = r.board.smallTargets.concat(r.settings.smallTargets);
  }

  // ---- 2. 화면 회전: 세로 → 가로 → 세로 ----
  var rc = await b.newContext(devices['Galaxy Tab S4']), rp = await rc.newPage();
  await rp.goto(web); await rp.waitForSelector('#nc-name');
  await rp.fill('#nc-name', '회전반'); await rp.fill('#nc-pw', '1234'); await rp.tap('[data-act=createclass]');
  await rp.waitForSelector('#bulk'); await rp.fill('#bulk', ROSTER.join('\n')); await rp.tap('[data-act=bulkset]'); await rp.tap('[data-act=saveroster]'); await toast(rp, /저장했어요/);
  await rp.tap('[data-act=board]'); await rp.waitForSelector('.card');
  var fs1 = await rp.evaluate(function () { return getComputedStyle(document.getElementById('grid')).fontSize; });
  var vs = rp.viewportSize();
  await rp.setViewportSize({ width: vs.height, height: vs.width }); await rp.waitForTimeout(400);
  var rot = await layout(rp), fs2 = await rp.evaluate(function () { return getComputedStyle(document.getElementById('grid')).fontSize; });
  check('2. 화면을 돌리면 이름표 크기를 다시 맞춘다', fs1 !== fs2 && !rot.hscroll && !rot.clipped.length, fs1 + ' → ' + fs2);
  await rc.close();

  // ---- 3. 다크 모드 (기기 설정이 어두운 화면) ----
  var dc = await b.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: 'dark' }), dp = await dc.newPage();
  await dp.goto(web); await dp.waitForSelector('#nc-name');
  var dark = await dp.evaluate(function () { return [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.querySelector('.modal')).backgroundColor, getComputedStyle(document.querySelector('#nc-name')).backgroundColor, getComputedStyle(document.querySelector('#nc-name')).color]; });
  check('3. 다크 모드 기기에서도 밝은 화면 그대로', dark[0] === 'rgb(246, 236, 210)' && dark[2] === 'rgb(255, 255, 255)' && dark[3] !== 'rgb(255, 255, 255)', dark.join(' / '));
  await dp.screenshot({ path: path.join(shots, 'env-dark.png') });
  await dc.close();

  // ---- 4. 움직임 줄이기 설정 ----
  var mc = await b.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' }), mp = await mc.newPage();
  await mp.goto(web); await mp.waitForSelector('#nc-name');
  await mp.fill('#nc-name', '움직임반'); await mp.fill('#nc-pw', '1234'); await mp.click('[data-act=createclass]');
  await mp.waitForSelector('#bulk'); await mp.fill('#bulk', '가람 칠판\n나래 우유'); await mp.click('[data-act=bulkset]'); await mp.click('[data-act=saveroster]'); await toast(mp, /저장했어요/);
  await mp.click('[data-act=board]'); await mp.waitForSelector('.card');
  await mp.evaluate(function () { window.__parts = 0; var o = window.requestAnimationFrame; window.__presser = 0; new MutationObserver(function (m) { m.forEach(function (x) { [].forEach.call(x.addedNodes, function (n) { if (n.className === 'presser') window.__presser++; }); }); }).observe(document.body, { childList: true }); });
  await mp.click('#card-0'); await mp.waitForTimeout(600);
  var rm = await mp.evaluate(function () { return { presser: window.__presser, stamped: document.querySelectorAll('#card-0 .slot.on').length, anim: getComputedStyle(document.querySelector('.clock i')).animationName }; });
  check('4. 움직임 줄이기 설정이면 큰 움직임을 줄인다', rm.presser === 0 && rm.anim === 'none' && rm.stamped === 1, JSON.stringify(rm));
  await mc.close();

  // ---- 5. 느린 기기 (CPU 6배 느리게) ----
  var sc = await b.newContext({ viewport: { width: 1920, height: 1080 }, hasTouch: true }), sp = await sc.newPage();
  var cdp = await sc.newCDPSession(sp);
  await sp.goto(web); await sp.waitForSelector('#nc-name');
  await sp.fill('#nc-name', '느린반'); await sp.fill('#nc-pw', '1234'); await sp.click('[data-act=createclass]');
  await sp.waitForSelector('#bulk'); await sp.fill('#bulk', ROSTER.join('\n')); await sp.click('[data-act=bulkset]'); await sp.click('[data-act=saveroster]'); await toast(sp, /저장했어요/);
  await sp.click('[data-act=board]'); await sp.waitForSelector('.card');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  var t0 = Date.now();
  await sp.tap('#card-0');
  await sp.waitForFunction(function () { return document.querySelectorAll('#card-0 .slot.on').length === 1; });
  var tap1 = Date.now() - t0;
  for (var j = 1; j <= 6; j++) await sp.tap('#card-' + j);
  await sp.waitForTimeout(2500);
  var got = await sp.evaluate(function () { var n = 0; for (var i = 1; i <= 6; i++) n += document.querySelectorAll('#card-' + i + ' .slot.on').length; return n; });
  var fps = await sp.evaluate(function () { return new Promise(function (res) { var n = 0, t = performance.now(); document.querySelector('#card-7').click(); (function f() { n++; if (performance.now() - t < 1000) requestAnimationFrame(f); else res(n); })(); }); });
  check('5. 느린 기기에서도 누른 뒤 바로 도장이 보인다', tap1 < 600, tap1 + 'ms');
  check('5-1. 느린 기기에서 여러 명이 연달아 눌러도 빠짐없이 찍힌다', got === 6, got + '/6');
  check('5-2. 느린 기기에서 도장 효과 중 화면 움직임', fps >= 20, '초당 ' + fps + '장면');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await sc.close();

  // ---- 6. 구글 설치 버전: 구글은 앱을 다른 출처의 iframe 안에 넣어 보여 준다 ----
  var http = require('http'), fs = require('fs');
  var serve = function (port, handler) { return new Promise(function (res) { var sv = http.createServer(handler).listen(port, '127.0.0.1', function () { res(sv); }); }); };
  var appSrv = await serve(8791, function (q, r) { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(process.argv[3])); });
  var hostSrv = await serve(8792, function (q, r) { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    r.end('<!doctype html><body style="margin:0"><iframe id="f" src="http://127.0.0.1:8791/" style="border:0;width:100vw;height:100vh" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"></iframe></body>'); });
  var ic = await b.newContext({ viewport: { width: 1920, height: 1080 } }), ip = await ic.newPage(), ierrs = [];
  ip.on('pageerror', function (e) { ierrs.push(String(e)); });
  await ip.goto('http://127.0.0.1:8792/');
  var fr = ip.frameLocator('#f');
  await fr.locator('.card').first().waitFor({ timeout: 15000 });
  await fr.locator('#card-3').click(); await ip.waitForTimeout(600);
  var inFrame = await fr.locator('#card-3 .slot.on').count();
  check('6. 구글 설치 버전(다른 출처 iframe 안)에서 도장이 찍힌다', inFrame >= 1, inFrame);
  check('6-1. iframe 안이라 쓸 수 없는 전체화면 버튼은 숨긴다', await fr.locator('.fsbtn').count() === 0);
  await fr.locator('[data-act=settings]').click(); await fr.locator('#pw').fill('1234'); await fr.locator('[data-act=login]').click();
  await fr.locator('.tabs').waitFor();
  check('6-2. iframe 안에서 설정 화면이 열린다', true);
  check('6-3. 오류 없음', ierrs.length === 0, ierrs.join(' | '));
  await ip.screenshot({ path: path.join(shots, 'env-iframe.png') });
  await ic.close(); appSrv.close(); hostSrv.close();

  // ---- 7. 인터넷이 끊긴 채 앱 열기 (배포본, 이 기기에 저장 방식) ----
  var site = process.argv[5];
  if (site) {
    var oc = await b.newContext({ viewport: { width: 1920, height: 1080 } }), op = await oc.newPage(), oerrs = [];
    op.on('pageerror', function (e) { oerrs.push(String(e)); });
    await op.goto(site + 'docs/'); await op.waitForSelector('#nc-name');
    await op.fill('#nc-name', '끊김반'); await op.fill('#nc-pw', '1234'); await op.click('[data-act=createclass]');
    await op.waitForSelector('#bulk'); await op.fill('#bulk', '가람 칠판\n나래 우유'); await op.click('[data-act=bulkset]'); await op.click('[data-act=saveroster]');
    await toast(op, /저장했어요/); await op.click('[data-act=board]'); await op.waitForSelector('.card');
    await op.click('#card-0'); await op.waitForTimeout(500);
    var ctl = await op.evaluate(function () { return navigator.serviceWorker.ready.then(function () { return new Promise(function (r) { setTimeout(function () { r(!!navigator.serviceWorker.controller); }, 1500); }); }); });
    await op.reload(); await op.waitForSelector('.card');      // 보관본을 채운다
    await oc.setOffline(true);
    var r1 = await op.reload({ timeout: 10000 }).then(function () { return op.waitForSelector('.card', { timeout: 8000 }); }).then(function () { return 'ok'; }, function (e) { return String(e).split('\n')[0]; });
    check('7. 인터넷이 끊긴 채 새로 고쳐도 앱이 열린다', r1 === 'ok', r1 + (ctl ? '' : ' / 서비스 워커 연결 전'));
    if (r1 === 'ok') {
      check('7-1. 끊긴 채 연 앱에 기록이 그대로', (await op.evaluate(function () { return document.querySelectorAll('#card-0 .slot.on').length; })) === 1);
      await op.click('#card-1'); await op.waitForTimeout(500);
      check('7-2. 끊긴 채로도 도장을 찍고 저장한다', !/bad/.test(await op.getAttribute('#net', 'class')) && (await op.evaluate(function () { return document.querySelectorAll('#card-1 .slot.on').length; })) === 1);
      var fontOk = await op.evaluate(function () { return document.fonts.ready.then(function () { return document.fonts.check('20px Jua'); }); });
      check('7-3. 끊긴 채로도 글꼴이 그대로', fontOk);
    }
    var r2 = await op.goto(site, { timeout: 10000 }).then(function () { return op.waitForSelector('.card', { timeout: 8000 }); }).then(function () { return 'ok'; }, function (e) { return String(e).split('\n')[0]; });
    check('7-4. 끊긴 채 짧은 주소(…/code/)로 열어도 앱이 열린다', r2 === 'ok', r2);
    await oc.setOffline(false);
    await op.goto(site + 'docs/'); await op.waitForSelector('.card');
    check('7-5. 다시 연결되면 정상', (await op.evaluate(function () { return document.querySelectorAll('#card-1 .slot.on').length; })) === 1);
    check('7-6. 오류 없음', oerrs.length === 0, oerrs.join(' | '));
    await oc.close();
  }

  console.log(results.join('\n'));
  console.log('\n[32px보다 작은 누르는 곳 (이름표 안 제외)]');
  Object.keys(small).forEach(function (k) { var u = {}; small[k].forEach(function (x) { u[x.replace(/ \d+x\d+$/, '')] = x; }); console.log(k + ': ' + (Object.keys(u).length ? Object.keys(u).map(function (x) { return u[x]; }).join(', ') : '없음')); });
  await b.close();
  process.exit(results.some(function (x) { return x.indexOf('실패') === 0; }) ? 1 : 0);
})().catch(function (e) { console.log(results.join('\n')); console.error(String(e).split('\n')[0]); process.exit(2); });
