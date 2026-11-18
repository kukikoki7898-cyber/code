// 외부 검토에서 나온 문제 3가지를 재현하는 검사
//   node tools/build-web.js --mock <web.html> && node test/build-preview.js <gas.html>
//   node test/run-review.js <web.html> <gas.html>
var { chromium } = require('playwright');
var results = [];
function check(name, ok, detail) { results.push((ok ? '통과 ' : '실패 ') + name + (detail ? '  (' + detail + ')' : '')); }

(async function () {
  var web = 'file://' + process.argv[2], gas = 'file://' + process.argv[3];
  var b = await chromium.launch();

  // ---- 1. 이 기기에 저장: 두 탭에서 각각 도장 ----
  var c1 = await b.newContext({ viewport: { width: 1400, height: 900 } });
  var t1 = await c1.newPage();
  await t1.goto(web); await t1.waitForSelector('#nc-name');
  await t1.fill('#nc-name', '두탭반'); await t1.fill('#nc-pw', '1234'); await t1.click('[data-act=createclass]');
  await t1.waitForSelector('#bulk'); await t1.fill('#bulk', '가람 칠판\n나래 우유\n다온 화분');
  await t1.click('[data-act=bulkset]'); await t1.click('[data-act=saveroster]');
  await t1.waitForFunction(function () { var t = document.querySelector('.toast'); return t && /저장했어요/.test(t.textContent); });
  await t1.click('[data-act=board]'); await t1.waitForSelector('.card');
  var t2 = await c1.newPage();
  await t2.goto(web); await t2.waitForSelector('.card');
  await t1.click('#card-0'); await t1.waitForTimeout(600);
  await t2.click('#card-1'); await t2.waitForTimeout(600);
  await t1.reload(); await t1.waitForSelector('.card');
  var on = await t1.evaluate(function () { return [0, 1].map(function (i) { return document.querySelectorAll('#card-' + i + ' .slot.on').length; }); });
  check('1. 두 탭에서 찍은 도장이 모두 남는다', on[0] === 1 && on[1] === 1, '가람 ' + on[0] + ', 나래 ' + on[1]);
  // 다른 탭에서 찍으면 이쪽 화면도 곧 바뀐다
  await t2.click('#card-2'); await t2.waitForTimeout(1200);
  var seen = await t1.evaluate(function () { return document.querySelectorAll('#card-2 .slot.on').length; });
  check('1-2. 다른 탭의 도장이 새로 고침 없이 보인다', seen === 1, '다온 ' + seen);

  // ---- 2. 결석했다가 해제 ----
  await t1.click('#card-0'); // 가람은 이미 1개(목표 1) → 흔들림만
  await t1.click('[data-act=settings]'); await t1.fill('#pw', '1234'); await t1.click('[data-act=login]');
  await t1.waitForSelector('.tabs'); await t1.click('[data-act=tab][data-tab=absent]');
  await t1.click('[data-act=absent][data-i="0"]'); await t1.waitForTimeout(500);
  await t1.click('[data-act=board]'); await t1.click('[data-act=stickers]'); await t1.waitForSelector('table.st');
  var monthAbsent = await t1.evaluate(function () { return document.querySelectorAll('table.st tr')[1].children[7].textContent; });
  await t1.click('[data-act=board]');
  await t1.click('[data-act=settings]'); await t1.fill('#pw', '1234'); await t1.click('[data-act=login]');
  await t1.waitForSelector('.tabs'); await t1.click('[data-act=tab][data-tab=absent]');
  await t1.click('[data-act=absent][data-i="0"]'); await t1.waitForTimeout(500);
  await t1.click('[data-act=board]'); await t1.waitForSelector('.card');
  var back = await t1.evaluate(function () { return document.querySelectorAll('#card-0 .slot.on').length; });
  check('2. 결석을 해제하면 원래 도장이 돌아온다', back === 1, '가람 ' + back);
  check('2-2. 결석 직후 스티커판 이번 달 일수가 바로 맞다', /^0\s*\/\s*0일/.test(monthAbsent.trim()), JSON.stringify(monthAbsent.trim()));
  await t1.reload(); await t1.waitForSelector('.card');
  var back2 = await t1.evaluate(function () { return document.querySelectorAll('#card-0 .slot.on').length; });
  check('2-3. 새로 고친 뒤에도 도장이 남아 있다', back2 === 1, '가람 ' + back2);

  // ---- 3. 저장 재시도 중 다른 학급으로 이동 ----
  var c3 = await b.newContext({ viewport: { width: 1400, height: 900 } });
  var g = await c3.newPage();
  await g.goto(gas); await g.waitForSelector('.card');
  var other = await g.evaluate(function () {
    var code = createClass('옆반', '', '1234').code;
    saveRoster(code, '1234', [{ no: '3', name: '옆반셋', role: '청소', target: 1 }]);
    return code;
  });
  // 도장 저장만 실패하게 한다 (설정 화면 등 다른 요청은 된다)
  await g.evaluate(function () { window.__realRecord = window.record; window.record = function () { throw new Error('일부러 실패'); }; });
  await g.click('#card-2'); await g.waitForTimeout(400);          // 원래 학급 3번(김서아) 도장, 저장 실패
  await g.click('[data-act=settings]'); await g.fill('#pw', '1234'); await g.click('[data-act=login]');
  await g.waitForSelector('.tabs'); await g.click('[data-act=tab][data-tab=class]'); await g.click('[data-act=pick]');
  await g.evaluate(function () { window.record = window.__realRecord; });
  await g.waitForSelector('.tags .btn');
  await g.click('.tags .btn:has-text("옆반")'); await g.waitForSelector('.card');
  await g.waitForTimeout(5000);
  var where = await g.evaluate(function (other) {
    var today = '2026-11-12', out = {};
    Object.keys(window.__books).forEach(function (id) {
      var d = window.__books[id].sheets['기록'].d, c = d[0] ? d[0].indexOf(today) : -1;
      for (var r = 1; r < d.length; r++) if (String(d[r][0]) === '3' && c >= 0) out[d[r][1]] = d[r][c] || '';
    });
    return out;
  }, other);
  check('3. 실패한 도장이 원래 학급에 저장된다', where['김서아'] === '○', '김서아 ' + JSON.stringify(where['김서아']));
  check('3-2. 다른 학급에는 잘못 들어가지 않는다', !where['옆반셋'], '옆반셋 ' + JSON.stringify(where['옆반셋'] || ''));

  // ---- 4. 전체화면 버튼 ----
  var f = await c1.newPage();
  await f.goto(web); await f.waitForSelector('.card');
  var has = await f.locator('.fsbtn').count();
  check('4. 전체화면 버튼이 보인다', has === 1);
  if (has) {
    await f.click('.fsbtn'); await f.waitForTimeout(500);
    var st1 = await f.evaluate(function () { return [!!document.fullscreenElement, document.querySelector('.fsbtn').textContent]; });
    check('4-2. 누르면 전체화면이 된다', st1[0] && /작게/.test(st1[1]) && /⤡/.test(st1[1]), JSON.stringify(st1));
    await f.click('.fsbtn'); await f.waitForTimeout(500);
    var st2 = await f.evaluate(function () { return [!!document.fullscreenElement, document.querySelector('.fsbtn').textContent]; });
    check('4-3. 다시 누르면 돌아온다', !st2[0] && /전체화면/.test(st2[1]), JSON.stringify(st2));
    await f.click('[data-act=stickers]'); await f.waitForSelector('table.st');
    check('4-4. 스티커판에도 버튼이 있다', await f.locator('.fsbtn').count() === 1);
  }

  console.log(results.join('\n'));
  await b.close();
  process.exit(results.some(function (r) { return r.indexOf('실패') === 0; }) ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
