// 실행: node test/build-preview.js <out.html> && node test/run.js <out.html> <스크린샷 폴더>
var { chromium } = require('playwright');
var assert = require('assert');
(async function () {
  var file = 'file://' + process.argv[2], shots = process.argv[3];
  var b = await chromium.launch();
  var pg = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  var errs = [];
  pg.on('pageerror', function (e) { errs.push(String(e)); });
  pg.on('console', function (m) { if (m.type() === 'error' && !/fonts|ERR_/.test(m.text())) errs.push(m.text()); });
  await pg.goto(file);
  await pg.waitForSelector('.card');
  var cell = function (no) { return pg.evaluate(function (no) {
    var bk = window.__books[Object.keys(window.__books)[0]].sheets['기록'].d;
    var c = bk[0].indexOf('2026-11-12');
    for (var r = 1; r < bk.length; r++) if (bk[r][0] === no) return bk[r][c] || '';
    return null;
  }, no); };

  assert.equal(await pg.locator('.card').count(), 24);
  assert.equal(await pg.textContent('#num'), '6 / 23');
  await pg.screenshot({ path: shots + '/board.png' });

  // 한 번짜리 역할: 터치 -> ○ 저장, 지우기 -> 빈칸
  await pg.click('#card-2');
  await pg.waitForTimeout(400);
  assert.equal(await cell('3'), '○');
  assert.equal(await pg.textContent('#num'), '7 / 23');
  await pg.click('#card-2 .undo');
  await pg.waitForTimeout(400);
  assert.equal(await cell('3'), '');

  // 세 번짜리 역할: 세 번 눌러야 완료, 네 번째는 무시
  for (var i = 0; i < 4; i++) await pg.click('#card-1');
  await pg.waitForTimeout(900);
  assert.equal(await cell('2'), '○○○');
  assert.equal(await pg.locator('#card-1 .slot.on').count(), 3);

  // 인터넷이 끊겨도 나중에 저장
  await pg.evaluate(function () { window.__OFFLINE = true; });
  await pg.click('#card-4');
  await pg.waitForTimeout(400);
  assert.ok(/인터넷/.test(await pg.textContent('#net')));
  assert.equal(await cell('5'), '');
  await pg.evaluate(function () { window.__OFFLINE = false; });
  await pg.waitForTimeout(4500);
  assert.equal(await cell('5'), '○');

  // 결석한 친구는 눌러도 그대로
  await pg.click('#card-8');
  assert.equal(await cell('9'), '결석');
  await pg.waitForTimeout(600);
  await pg.screenshot({ path: shots + '/board2.png' });

  // 스티커판
  await pg.click('[data-act=stickers]');
  await pg.waitForSelector('table.st');
  await pg.screenshot({ path: shots + '/stickers.png' });
  await pg.click('[data-act=board]');

  // 설정: 틀린 비밀번호, 맞는 비밀번호
  await pg.click('[data-act=settings]');
  await pg.fill('#pw', '0000'); await pg.click('[data-act=login]');
  await pg.waitForFunction(function () { var t = document.querySelector('.toast'); return t && /비밀번호/.test(t.textContent); });
  await pg.fill('#pw', '1234'); await pg.click('[data-act=login]');
  await pg.waitForSelector('.tabs');
  await pg.screenshot({ path: shots + '/settings.png' });

  // 역할 바꾸기 + 친구 추가 + 삭제
  await pg.fill('input[data-f=role][data-i="0"]', '급식 도우미');
  await pg.click('[data-act=addrow]');
  await pg.fill('input[data-f=name][data-i="24"]', '홍새봄');
  await pg.fill('input[data-f=role][data-i="24"]', '급식 도우미');
  await pg.click('[data-act=delrow][data-i="23"]');
  await pg.click('[data-act=saveroster]');
  await pg.waitForTimeout(500);
  var roster = await pg.evaluate(function () { return window.__books[Object.keys(window.__books)[0]].sheets['명단'].d; });
  assert.equal(roster[1][2], '급식 도우미');
  assert.equal(roster[24][1], '홍새봄');
  assert.equal(roster.filter(function (r) { return r[1] === '한지유'; }).length, 0);
  var log = await pg.evaluate(function () { return window.__books[Object.keys(window.__books)[0]].sheets['기록'].d; });
  assert.equal(log[1][2], '급식 도우미');

  // 결석 풀기
  await pg.click('[data-act=tab][data-tab=absent]');
  await pg.click('[data-act=absent][data-i="8"]');
  await pg.waitForTimeout(400);
  assert.equal(await cell('9'), '');

  // 쉬는 날 넣기 -> 칠판이 쉬는 날 화면
  await pg.click('[data-act=tab][data-tab=rest]');
  await pg.click('[data-act=addrest]');
  await pg.fill('input[data-g=name]', '개교기념일');
  await pg.click('[data-act=saverest]');
  await pg.waitForTimeout(400);
  await pg.click('[data-act=board]');
  assert.ok(/쉬는 날/.test(await pg.textContent('.center h2')));
  await pg.screenshot({ path: shots + '/rest.png' });

  // 쉬는 날 지우고 시트 주소 바꾸기 -> 명단이 새 시트로 따라감, 새 기록은 새 시트에
  await pg.click('[data-act=settings]'); await pg.fill('#pw', '1234'); await pg.click('[data-act=login]');
  await pg.waitForSelector('.tabs');
  await pg.click('[data-act=tab][data-tab=rest]'); await pg.click('[data-act=delrest]'); await pg.click('[data-act=saverest]');
  await pg.waitForTimeout(400);
  await pg.click('[data-act=tab][data-tab=class]');
  await pg.screenshot({ path: shots + '/settings-class.png' });
  var id2 = await pg.evaluate(function () { return window.__newBook(); });
  await pg.fill('#s-url', 'https://docs.google.com/spreadsheets/d/' + id2 + '/edit#gid=0');
  await pg.click('[data-act=savesheet]');
  await pg.waitForTimeout(700);
  await pg.click('[data-act=board]');
  await pg.waitForSelector('.card');
  assert.equal(await pg.locator('.card').count(), 24);
  await pg.click('#card-0');
  await pg.waitForTimeout(400);
  var nb = await pg.evaluate(function (id) { return window.__books[id].sheets['기록'].d; }, id2);
  assert.equal(nb[0][3], '2026-11-12'); assert.equal(nb[1][1], '강다은'); assert.equal(nb[1][3], '○');
  // 잘못된 주소는 거절
  var bad = await pg.evaluate(function () { try { updateClass(window.__SEED_CODE, '1234', { sheetUrl: 'https://docs.google.com/spreadsheets/d/XXXXXXXXXXXXXXXXXXXXXXXXXXXX/edit' }); return 'ok'; } catch (e) { return e.message; } });
  assert.ok(/열 수 없어요/.test(bad));

  // 요약 시트: 맨 앞에 있고, 도장을 찍으면 값이 바뀐다
  var sum = await pg.evaluate(function (id) { var b = window.__books[id]; return { order: b.order, d: b.sheets['요약'].d }; }, id2);
  assert.deepEqual(sum.order, ['요약', '시트1', '명단', '기록', '쉬는날']);
  assert.ok(/2학년 3반 1인 1역 요약/.test(sum.d[0][0]));
  assert.equal(sum.d[4][0], '24명');
  assert.equal(sum.d[4][2], '0 / 24명');
  assert.equal(sum.d[6][1], '이름');
  assert.equal(sum.d[7][1], '강다은'); assert.equal(sum.d[7][4], '1 / 3'); assert.equal(sum.d[7][8], '△');
  var first = await pg.evaluate(function () {
    var b = window.__books[Object.keys(window.__books)[0]];
    return { order: b.order, d: b.sheets['요약'].d, log: b.sheets['기록'].d.slice(1, 4).map(function (r) { return r[1]; }) };
  });
  assert.deepEqual(first.order, ['요약', '기록', '명단', '쉬는날']);
  assert.deepEqual(first.log, ['강다은', '김도윤', '김서아']);
  assert.equal(first.d[4][12], '9일');
  var kim = first.d.filter(function (r) { return r[1] === '김도윤'; })[0];
  assert.equal(kim[4], '완료'); assert.equal(kim[8], '★'); assert.equal(kim[10], '3일'); assert.equal(kim[11], '8 / 9일'); assert.equal(kim[14], 8);
  // 날짜 열이 26칸을 넘어가도 계속 기록된다
  var many = await pg.evaluate(function () {
    var code = createClass('열 늘리기', '', '1234').code;
    saveRoster(code, '1234', [{ no: '1', name: '가', role: '나', target: 1 }]);
    for (var i = 0; i < 40; i++) { window.__TODAY = '2027-03-' + (i < 9 ? '0' : '') + (i + 1); if (i < 31) record(code, '1', 1, window.__TODAY); }
    window.__TODAY = '2026-11-12';
    var ids = Object.keys(window.__books), b = window.__books[ids[ids.length - 1]];
    return { cols: b.sheets['기록'].d[0].length, max: b.sheets['기록'].maxC };
  });
  assert.equal(many.cols, 34); assert.ok(many.max >= 34);

  // 설정에서 새 스프레드시트 만들기: 명단이 따라가고 예전 시트는 그대로
  var before = await pg.evaluate(function (id) { return JSON.stringify(window.__books[id].sheets['기록'].d); }, id2);
  await pg.click('[data-act=settings]'); await pg.fill('#pw', '1234'); await pg.click('[data-act=login]');
  await pg.waitForSelector('.tabs');
  await pg.click('[data-act=tab][data-tab=class]');
  await pg.click('[data-act=newsheet]'); await pg.click('[data-act=newsheet2]');
  await pg.waitForTimeout(700);
  var made = await pg.evaluate(function (id) {
    var ids = Object.keys(window.__books), b = window.__books[ids[ids.length - 1]];
    return { order: b.order, roster: b.sheets['명단'].d.length, sum: b.sheets['요약'].d[4][0], old: JSON.stringify(window.__books[id].sheets['기록'].d) };
  }, id2);
  assert.deepEqual(made.order, ['요약', '명단', '기록', '쉬는날']);
  assert.equal(made.roster, 25); assert.equal(made.sum, '24명'); assert.equal(made.old, before);
  await pg.click('[data-act=board]');

  // 학급 고르기 화면 + 새 학급
  await pg.goto(file + '?pick');
  await pg.waitForSelector('.tags .btn');
  await pg.click('[data-act=newclass]');
  await pg.fill('#nc-name', '1학년 1반'); await pg.fill('#nc-pw', '9999');
  await pg.screenshot({ path: shots + '/pick.png' });
  await pg.click('[data-act=createclass]');
  await pg.waitForFunction(function () { var t = document.querySelector('.center h2'); return t && /이름표가 없어요/.test(t.textContent); });

  // 작은 화면
  var ph = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await ph.goto(file); await ph.waitForSelector('.card');
  await ph.screenshot({ path: shots + '/board-720.png' });

  assert.deepEqual(errs, []);
  console.log('모든 검사 통과');
  await b.close();
})().catch(function (e) { console.error(e); process.exit(1); });
