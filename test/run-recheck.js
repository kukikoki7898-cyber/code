// 재검토에서 의심된 문제를 재현하는 검사
//   node tools/build-web.js --mock <web.html> && node test/run-recheck.js <web.html 또는 주소> <스크린샷 폴더>
var { chromium } = require('playwright');
var results = [];
function check(name, ok, detail) { results.push((ok ? '통과 ' : '실패 ') + name + (detail !== undefined && detail !== '' ? '  (' + detail + ')' : '')); }
function kst(d) { return new Date(Date.now() + 9 * 3600000 + (d || 0) * 86400000).toISOString().slice(0, 10); }
function hm(min) { min = Math.max(0, Math.min(23 * 60 + 59, min)); return ('0' + Math.floor(min / 60)).slice(-2) + ':' + ('0' + (min % 60)).slice(-2); }
async function toast(p, re) { await p.waitForFunction(function (s) { var t = document.querySelector('.toast'); return t && new RegExp(s).test(t.textContent); }, re.source, { timeout: 15000 }); }
async function login(p) { await p.click('[data-act=settings]'); await p.fill('#pw', '1234'); await p.click('[data-act=login]'); await p.waitForSelector('.tabs'); }
async function toBoard(p) { await p.click('[data-act=board]'); await p.waitForSelector('.card'); }
function on(p, i) { return p.evaluate(function (i) { return document.querySelectorAll('#card-' + i + ' .slot.on').length; }, i); }
async function newClass(p, url, name, roster) {
  await p.goto(url); await p.waitForSelector('#nc-name');
  await p.fill('#nc-name', name); await p.fill('#nc-pw', '1234'); await p.click('[data-act=createclass]');
  await p.waitForSelector('#bulk'); await p.fill('#bulk', roster); await p.click('[data-act=bulkset]'); await p.click('[data-act=saveroster]');
  await toast(p, /저장했어요/); await toBoard(p);
}
async function watchBanners(p) {
  await p.evaluate(function () {
    window.__banners = [];
    new MutationObserver(function (m) { m.forEach(function (x) { [].forEach.call(x.addedNodes, function (n) { if (n.className === 'banner') window.__banners.push(n.textContent); }); }); })
      .observe(document.body, { childList: true });
  });
}

(async function () {
  var url = /^https?:/.test(process.argv[2]) ? process.argv[2] : 'file://' + process.argv[2];
  var b = await chromium.launch(), errs = [];

  // ---- 1. 이미 달성한 목표를 날마다 다시 축하하지 않는다 ----
  var p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  p.on('pageerror', function (e) { errs.push(String(e)); });
  await newClass(p, url, '목표반', '가람 칠판\n나래 우유');
  await login(p); await p.click('[data-act=tab][data-tab=rule]');
  await p.fill('#g-n', '1'); await p.fill('#g-t', '파티'); await p.click('[data-act=goalsave]'); await toast(p, /목표를 저장/);
  // 어제 모두 다 함 → 목표 1일은 이미 달성
  await p.evaluate(function (y) {
    var cls = JSON.parse(localStorage.getItem('or_classes')), c = cls[Object.keys(cls)[0]];
    c.goal = '1|' + y.replace(/-/g, '') + '|파티'; localStorage.setItem('or_classes', JSON.stringify(cls));
    var key = 'or_book_' + c.sheetId, bk = JSON.parse(localStorage.getItem(key));
    bk.sheets.forEach(function (s) { if (s.p.title !== '기록') return; var col = s.d[0].length; s.d[0].push(y); for (var r = 1; r < s.d.length; r++) { while (s.d[r].length < col) s.d[r].push(''); s.d[r][col] = '○'; } });
    localStorage.setItem(key, JSON.stringify(bk));
  }, kst(-1));
  await p.reload(); await p.waitForSelector('.card');
  check('1. 어제 이미 목표 달성으로 표시된다', /목표 달성/.test(await p.textContent('#goal')));
  await watchBanners(p);
  await p.click('#card-0'); await p.click('#card-1'); await p.waitForTimeout(5600);
  var bn = await p.evaluate(function () { return window.__banners; });
  check('1-1. 이미 달성한 뒤에는 "목표 달성" 축하를 다시 띄우지 않는다', !bn.some(function (t) { return /목표 달성/.test(t); }), JSON.stringify(bn));

  // ---- 2. 설정을 보고 나온 뒤 학생이 길게 눌러도 비밀번호를 묻는다 ----
  await login(p); await toBoard(p);
  var bx = await p.locator('#card-0').boundingBox();
  await p.mouse.move(bx.x + bx.width / 2, bx.y + 30); await p.mouse.down(); await p.waitForTimeout(950); await p.mouse.up(); await p.waitForTimeout(150);
  check('2. 설정에서 나온 직후에도 길게 누르면 비밀번호를 묻는다', await p.locator('#tpw').count() === 1, await p.locator('[data-act=tundo]').count() ? '비밀번호 없이 메뉴가 열림' : '');
  await p.keyboard.press('Escape').catch(function () {});
  await p.evaluate(function () { var s = document.getElementById('shade'); if (s) s.parentNode.removeChild(s); });

  // ---- 3. 터치 기기의 "길게 누르기" 신호(contextmenu)로도 메뉴가 열린다 ----
  await p.reload(); await p.waitForSelector('.card');
  await p.evaluate(function () {
    var c = document.getElementById('card-1'), r = c.getBoundingClientRect();
    c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 20 }));
  });
  await p.waitForTimeout(200);
  check('3. 브라우저의 길게 누르기 신호로도 선생님 메뉴가 열린다', await p.locator('#tpw').count() === 1);
  await p.fill('#tpw', '1234').catch(function () {}); await p.click('[data-act=tpwok]').catch(function () {});
  await p.waitForTimeout(300);
  check('3-1. 비밀번호를 넣으면 그 친구의 메뉴가 나온다', (await p.locator('.modal h3').count()) && /나래/.test(await p.textContent('.modal h3')));
  await p.evaluate(function () { var s = document.getElementById('shade'); if (s) s.parentNode.removeChild(s); });

  // ---- 4. 쉬는 날에 "그래도 오늘 기록하기"를 누르면 잠금이 걸리지 않는다 ----
  var q = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  q.on('pageerror', function (e) { errs.push(String(e)); });
  await newClass(q, url, '쉬는날반', '가람 칠판\n나래 우유');
  var nowMin = await q.evaluate(function () { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); });
  await login(q); await q.click('[data-act=tab][data-tab=rule]');
  while (await q.locator('[data-act=lockdel]').count()) await q.click('[data-act=lockdel] >> nth=0');
  await q.click('[data-act=lockadd]');
  await q.fill('input[data-l="0"][data-i="0"]', hm(nowMin - 5)); await q.fill('input[data-l="1"][data-i="0"]', hm(nowMin + 30));
  await q.click('[data-act=lockon][data-v="1"]'); await toast(q, /잠금을 켰어요/);
  await q.click('[data-act=tab][data-tab=rest]'); await q.click('[data-act=addrest]'); await q.fill('input[data-g=name]', '재량휴업일');
  await q.click('[data-act=saverest]'); await toast(q, /저장했어요/);
  await q.click('[data-act=board]'); await q.waitForSelector('[data-act=force]');
  await q.click('[data-act=force]'); await q.waitForSelector('.card');
  await q.click('#card-0'); await q.waitForTimeout(400);
  check('4. 쉬는 날 기록할 때는 수업 시간 잠금이 걸리지 않는다', await on(q, 0) === 1 && await q.locator('#lockov').count() === 0);

  // ---- 5. 이 기기의 저장 공간이 가득 찼을 때 ----
  var r = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  r.on('pageerror', function (e) { errs.push(String(e)); });
  await newClass(r, url, '공간반', '가람 칠판\n나래 우유');
  await r.evaluate(function () { var n = 0, size = 250000; while (size >= 1) { try { localStorage.setItem('fill_' + n, 'x'.repeat(size)); n++; } catch (e) { size = Math.floor(size / 2); } } });
  await r.click('#card-0');
  var full = await r.waitForFunction(function () { var t = document.querySelector('.toast'); return t && /저장 공간/.test(t.textContent) && t.textContent; }, null, { timeout: 8000 }).then(function (h) { return h.jsonValue(); }).catch(function () { return ''; });
  check('5. 저장 공간이 가득 차면 그 이유를 알려 준다', /저장 공간이 가득/.test(full), full.slice(0, 30));
  check('5-1. "인터넷 확인"이 아니라 "저장 못 함"으로 표시한다', /저장 못 함/.test(await r.textContent('#net')), await r.textContent('#net'));
  await r.evaluate(function () { Object.keys(localStorage).filter(function (k) { return /^fill_/.test(k); }).forEach(function (k) { localStorage.removeItem(k); }); });
  await r.waitForTimeout(5000); await r.reload(); await r.waitForSelector('.card');
  check('5-2. 공간이 생기면 밀린 도장을 자동으로 저장한다', await on(r, 0) === 1);

  // ---- 6. 기록 정리 ----
  await login(r); await r.click('[data-act=tab][data-tab=class]');
  await r.click('[data-act=newsheet]'); await r.click('[data-act=newsheet2]'); await toast(r, /새 기록장/);
  var nb = await r.evaluate(function () { return Object.keys(localStorage).filter(function (k) { return /^or_book_/.test(k); }).length; });
  check('6. "새 기록장으로 시작" 뒤 옛 기록이 공간을 차지하지 않는다', nb === 1, nb + '개');
  await r.click('[data-act=tab][data-tab=class]'); await r.click('[data-act=delclass]');
  check('6-1. 학급을 지울 때 기록도 지워진다고 사실대로 알린다', /모든 도장 기록이 지워지고/.test(await r.textContent('.modal p')));
  await r.click('[data-act=delclass2]'); await r.waitForTimeout(800);
  nb = await r.evaluate(function () { return Object.keys(localStorage).filter(function (k) { return /^or_book_/.test(k); }).length; });
  check('6-2. 지운 학급의 기록이 남지 않는다', nb === 0, nb + '개');

  // ---- 7. 아주 오래된 브라우저(fetch 없음)에서는 멈추지 않고 이유를 알려 준다 ----
  var oc = await b.newContext({ viewport: { width: 1400, height: 900 } });
  // fetch 를 아예 없는 것처럼 만든다 (검사용 가짜 서버가 다시 넣어도 무시)
  await oc.addInitScript(function () { Object.defineProperty(window, 'fetch', { configurable: false, get: function () { return undefined; }, set: function () {} }); });
  var o = await oc.newPage();
  o.on('pageerror', function (e) { errs.push('오래된 브라우저: ' + String(e)); });
  await o.goto(url);
  var oldMsg = await o.waitForFunction(function () { var t = document.querySelector('.center p'); return t && /너무 오래되어/.test(t.textContent) && t.textContent; }, null, { timeout: 10000 })
    .then(function (h) { return h.jsonValue(); }).catch(function () { return ''; });
  check('7. 아주 오래된 브라우저에서는 Chrome을 설치하라고 알려 준다', /Chrome/.test(oldMsg), oldMsg.slice(0, 30) || (await o.textContent('#app')).slice(0, 30));

  check('오류 없음', errs.length === 0, errs.join(' | '));
  console.log(results.join('\n'));
  await b.close();
  process.exit(results.some(function (r) { return r.indexOf('실패') === 0; }) ? 1 : 0);
})().catch(function (e) { console.log(results.join('\n')); console.error(String(e).split('\n')[0]); process.exit(2); });
