// 외부 검토에서 나온 문제 3가지를 재현하는 검사
//   node tools/build-web.js --mock <web.html> && node test/build-preview.js <gas.html>
//   node test/run-review.js <web.html> <gas.html> <스크린샷 폴더>
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

  // ---- 5. 이름표 위치: 아래쪽(저학년) ----
  var lc = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  var L = await lc.newPage();
  await L.goto(web); await L.waitForSelector('#nc-name');
  await L.fill('#nc-name', '1학년 1반'); await L.fill('#nc-pw', '1234'); await L.check('#nc-low'); await L.click('[data-act=createclass]');
  await L.waitForSelector('#bulk');
  var names = []; for (var k = 1; k <= 24; k++) names.push('학생' + k + ' 역할' + k);
  await L.fill('#bulk', names.join('\n')); await L.click('[data-act=bulkset]'); await L.click('[data-act=saveroster]');
  await L.waitForFunction(function () { var t = document.querySelector('.toast'); return t && /저장했어요/.test(t.textContent); });
  await L.click('[data-act=tab][data-tab=class]');
  check('5. 새 학급 만들 때 고른 "아래쪽"이 설정에 반영된다', /green/.test(await L.getAttribute('[data-act=align][data-v=low]', 'class')));
  await L.click('[data-act=board]'); await L.waitForSelector('.card');
  var geo = await L.evaluate(function () {
    var r = [].map.call(document.querySelectorAll('.card'), function (c) { return c.getBoundingClientRect(); });
    return { top: Math.min.apply(null, r.map(function (x) { return x.top; })), bottom: Math.max.apply(null, r.map(function (x) { return x.bottom; })),
      h: innerHeight, scroll: document.documentElement.scrollHeight, hero: (document.getElementById('heronum') || {}).textContent };
  });
  check('5-2. 이름표가 모두 화면 아래쪽 40% 아래에 있다', geo.top >= geo.h * 0.37, '맨 위 ' + Math.round(geo.top) + 'px / ' + geo.h);
  check('5-3. 이름표가 화면 안에 다 들어간다 (스크롤 없음)', geo.bottom <= geo.h && geo.scroll <= geo.h + 1, '맨 아래 ' + Math.round(geo.bottom));
  check('5-4. 위쪽 빈 곳에 진행 상황이 크게 보인다', geo.hero === '0 / 24', JSON.stringify(geo.hero));
  await L.screenshot({ path: process.argv[4] + '/low-1920.png' });
  await L.click('#card-23'); await L.waitForTimeout(800);
  check('5-5. 아래쪽 배치에서도 도장이 찍힌다', (await L.evaluate(function () { return document.getElementById('heronum').textContent; })) === '1 / 24');
  // 다시 화면 전체로
  await L.click('[data-act=settings]'); await L.fill('#pw', '1234'); await L.click('[data-act=login]');
  await L.waitForSelector('.tabs'); await L.click('[data-act=tab][data-tab=class]'); await L.click('[data-act=align][data-v=""]');
  await L.waitForTimeout(400); await L.click('[data-act=board]'); await L.waitForSelector('.card');
  var top2 = await L.evaluate(function () { return document.querySelector('#card-0').getBoundingClientRect().top; });
  check('5-6. "화면 전체"로 돌리면 위에서부터 채운다', top2 < 200 && !(await L.locator('#hero').count()), '첫 이름표 ' + Math.round(top2) + 'px');
  // 새로 고쳐도 설정이 남는다 (아래쪽으로 다시 바꾼 뒤)
  await L.click('[data-act=settings]'); await L.fill('#pw', '1234'); await L.click('[data-act=login]');
  await L.waitForSelector('.tabs'); await L.click('[data-act=tab][data-tab=class]'); await L.click('[data-act=align][data-v=low]');
  await L.waitForTimeout(400); await L.reload(); await L.waitForSelector('.card');
  check('5-7. 새로 고쳐도 아래쪽 배치가 남는다', await L.locator('.board.low').count() === 1);
  for (var vp of [[1280, 720], [820, 1180], [390, 844]]) {
    await L.setViewportSize({ width: vp[0], height: vp[1] }); await L.waitForTimeout(300);
    var g2 = await L.evaluate(function () {
      var last = document.querySelector('#card-23').getBoundingClientRect(), hero = document.getElementById('hero'), top = document.querySelector('.top').getBoundingClientRect();
      var hb = hero && hero.style.display !== 'none' && hero.style.visibility !== 'hidden' ? hero.querySelector('.big').getBoundingClientRect() : null;
      return { sw: document.documentElement.scrollWidth, w: innerWidth, lastBottom: last.bottom + scrollY, docH: document.documentElement.scrollHeight,
        heroOk: !hb || hb.top >= top.bottom - 1, low: !!document.querySelector('.board.low') };
    });
    check('5-8. ' + vp.join('x') + ' 가로 넘침 없음', g2.sw <= g2.w, g2.sw + ' / ' + g2.w);
    check('5-9. ' + vp.join('x') + ' 마지막 이름표까지 닿을 수 있다', g2.lastBottom <= g2.docH + 1, Math.round(g2.lastBottom) + ' / ' + g2.docH);
    check('5-10. ' + vp.join('x') + ' 큰 글씨가 머리 부분과 겹치지 않는다', g2.heroOk, g2.low ? '아래쪽 배치' : '스크롤 배치');
    await L.screenshot({ path: process.argv[4] + '/low-' + vp[0] + '.png' });
  }

  console.log(results.join('\n'));
  await b.close();
  process.exit(results.some(function (r) { return r.indexOf('실패') === 0; }) ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(2); });
