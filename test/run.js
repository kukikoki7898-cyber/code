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
