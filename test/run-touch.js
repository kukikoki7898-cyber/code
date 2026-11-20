// 터치 전자칠판 흉내(안드로이드, 1920x1080, 터치 화면)에서 손가락 동작 검사
//   node tools/build-web.js --mock <web.html> && node test/run-touch.js <web.html 또는 주소> <스크린샷 폴더>
var { chromium } = require('playwright');
var results = [];
function check(name, ok, detail) { results.push((ok ? '통과 ' : '실패 ') + name + (detail !== undefined && detail !== '' ? '  (' + detail + ')' : '')); }
async function toast(p, re) { await p.waitForFunction(function (s) { var t = document.querySelector('.toast'); return t && new RegExp(s).test(t.textContent); }, re.source, { timeout: 15000 }); }
function on(p, i) { return p.evaluate(function (i) { return document.querySelectorAll('#card-' + i + ' .slot.on').length; }, i); }

(async function () {
  var url = /^https?:/.test(process.argv[2]) ? process.argv[2] : 'file://' + process.argv[2], shots = process.argv[3];
  var b = await chromium.launch();
  var ctx = await b.newContext({
    viewport: { width: 1920, height: 1080 }, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 11; IFP Board) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.104 Safari/537.36'
  });
  var p = await ctx.newPage(), errs = [];
  p.on('pageerror', function (e) { errs.push(String(e)); });
  var cdp = await ctx.newCDPSession(p);
  var center = async function (sel) { var r = await p.locator(sel).boundingBox(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 3) }; };
  var tap = async function (sel) { var c = await center(sel); await p.touchscreen.tap(c.x, c.y); };
  var hold = async function (sel, ms, moveBy) {
    var c = await center(sel);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] });
    if (moveBy) { await p.waitForTimeout(80); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x + moveBy, y: c.y }] }); }
    await p.waitForTimeout(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(250);
  };

  // 학급 만들기도 손가락과 화면 키보드로 한다
  await p.goto(url); await p.waitForSelector('#nc-name');
  await tap('#nc-name'); await p.keyboard.type('터치반');
  await tap('#nc-pw'); await p.keyboard.type('1234');
  await tap('[data-act=createclass]');
  await p.waitForSelector('#bulk'); await tap('#bulk');
  await p.keyboard.type('김하늘 칠판 지우기 3\n이바다 우유 나르기\n박구름 화분 물 주기');
  await tap('[data-act=bulkset]'); await tap('[data-act=saveroster]'); await toast(p, /저장했어요/);
  await tap('[data-act=board]'); await p.waitForSelector('.card');
  check('0. 손가락으로 학급을 만들고 칠판까지 온다', await p.locator('.card').count() === 3);

  // 1. 짧게 누르면 도장
  await tap('#card-1'); await p.waitForTimeout(400);
  check('1. 손가락으로 누르면 도장이 찍힌다', await on(p, 1) === 1);
  // 2. 하루 3번 역할을 빠르게 세 번
  for (var k = 0; k < 3; k++) { await tap('#card-0'); await p.waitForTimeout(120); }
  await p.waitForTimeout(400);
  check('2. 빠르게 세 번 누르면 도장 세 개 (두 번 눌러 확대 등에 막히지 않음)', await on(p, 0) === 3, await on(p, 0));
  var scale = await p.evaluate(function () { return window.visualViewport ? window.visualViewport.scale : 1; });
  check('2-1. 빠르게 눌러도 화면이 확대되지 않는다', scale === 1, scale);

  // 3. 길게 누르기 (손가락)
  await hold('#card-1', 1000);
  check('3. 손가락으로 길게 누르면 선생님 비밀번호를 묻는다', await p.locator('#tpw').count() === 1);
  check('3-1. 길게 누르는 동안 도장이 더 찍히지 않는다', await on(p, 1) === 1, await on(p, 1));
  await p.screenshot({ path: shots + '/touch-hold.png' });
  await tap('#tpw'); await p.keyboard.type('1234'); await tap('[data-act=tpwok]');
  await p.waitForSelector('[data-act=tundo]');
  await tap('[data-act=tundo]'); await p.waitForTimeout(400);
  check('3-2. 메뉴에서 손가락으로 도장을 지운다', await on(p, 1) === 0, await on(p, 1));
  await tap('#card-2'); await p.waitForTimeout(400);
  check('3-3. 메뉴를 닫은 직후 다른 친구가 누른 것도 찍힌다', await on(p, 2) === 1, await on(p, 2));

  // 4. 누른 채 손가락이 미끄러지면 길게 누르기가 아니다
  await hold('#card-1', 1000, 60);
  check('4. 누른 채 손가락이 미끄러지면 선생님 메뉴가 뜨지 않는다', await p.locator('#tpw').count() === 0 && await p.locator('[data-act=tundo]').count() === 0);
  await p.evaluate(function () { var s = document.getElementById('shade'); if (s) s.parentNode.removeChild(s); });

  // 5. 짧은 꾹(0.3초)은 그냥 도장
  await hold('#card-1', 300);
  check('5. 0.3초 정도 누르면 메뉴 없이 도장이 찍힌다', await on(p, 1) === 1 && await p.locator('#shade').count() === 0, await on(p, 1));

  // 6. 전체화면, 스티커판, 설정을 손가락으로
  await tap('.fsbtn'); await p.waitForTimeout(400);
  check('6. 손가락으로 전체화면이 된다', await p.evaluate(function () { return !!document.fullscreenElement; }));
  await tap('.fsbtn'); await p.waitForTimeout(400);
  await tap('[data-act=stickers]'); await p.waitForSelector('table.st');
  await tap('[data-act=board]'); await p.waitForSelector('.card');
  await tap('[data-act=settings]'); await tap('#pw'); await p.keyboard.type('1234'); await tap('[data-act=login]');
  await p.waitForSelector('.tabs'); await tap('[data-act=tab][data-tab=rule]');
  await tap('[data-act=ue][data-v="1"]'); await toast(p, /학생도/);
  await tap('[data-act=board]'); await p.waitForSelector('.card');
  await tap('#card-2 .undo'); await p.waitForTimeout(400);
  check('6-1. 학생 [지우기] 버튼도 손가락으로 눌린다', await on(p, 2) === 0, await on(p, 2));
  await p.screenshot({ path: shots + '/touch-board.png' });

  check('오류 없음', errs.length === 0, errs.join(' | '));
  console.log(results.join('\n'));
  await b.close();
  process.exit(results.some(function (r) { return r.indexOf('실패') === 0; }) ? 1 : 0);
})().catch(function (e) { console.log(results.join('\n')); console.error(String(e).split('\n')[0]); process.exit(2); });
