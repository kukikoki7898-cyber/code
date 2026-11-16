// 웹 버전 검사: node tools/build-web.js --mock <out.html> && node test/run-web.js <out.html> <스크린샷 폴더>
var { chromium } = require('playwright');
var assert = require('assert');
(async function () {
  var file = 'file://' + process.argv[2], shots = process.argv[3];
  var b = await chromium.launch();
  var ctx = await b.newContext({ viewport: { width: 1600, height: 900 } });
  var pg = await ctx.newPage();
  var errs = [];
  pg.on('pageerror', function (e) { errs.push(String(e)); });
  var sheet = function (name) { return pg.evaluate(function (name) {
    var files = window.__mock.store.files, out = null;
    for (var id in files) if ((files[id].appProperties || {}).oneRole === '1') files[id].sheets.forEach(function (s) { if (s.properties.title === name) out = s.values; });
    return out;
  }, name); };
  var tagged = function () { return pg.evaluate(function () {
    var files = window.__mock.store.files, out = [];
    for (var id in files) if ((files[id].appProperties || {}).oneRole === '1') out.push({ id: id, p: files[id].appProperties, sheets: files[id].sheets.map(function (s) { return s.properties.title; }) });
    return out;
  }); };
  var today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  var todayCell = async function (no) { var d = await sheet('기록'), c = d[0].indexOf(today); for (var r = 1; r < d.length; r++) if (String(d[r][0]) === no) return d[r][c] || ''; return null; };

  // SHA-256 이 표준 값과 같은지
  await pg.goto(file);
  var hex = await pg.evaluate(function () { return window.__sha256([97, 98, 99]).map(function (v) { return ('0' + ((v + 256) % 256).toString(16)).slice(-2); }).join(''); });
  assert.equal(hex, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

  // 1. 처음 열면 묻지 않고 바로 시작한다. [저장 방식 바꾸기]를 눌러야 고르는 창이 나온다.
  await pg.waitForSelector('#nc-name');
  assert.equal(await pg.locator('#or-login').count(), 0);
  await pg.click('[data-act=close]');
  await pg.click('[data-act=mode]'); await pg.click('[data-act=mode2]');
  await pg.waitForSelector('#or-login');
  assert.ok(/기록을 어디에 저장할까요/.test(await pg.textContent('#or-login')));
  await pg.screenshot({ path: shots + '/web-login.png' });
  // 권한 화면에서 드라이브 칸을 체크하지 않고 허용한 경우: 안내를 보여 주고, 다시 로그인할 때 권한 화면을 다시 띄운다
  await pg.evaluate(function () { window.__mock.skipDrive = true; });
  await pg.click('#or-google');
  await pg.waitForFunction(function () { var t = document.querySelector('#or-login'); return t && /드라이브 권한이 빠져/.test(t.textContent); });
  await pg.click('#or-go');
  await pg.waitForFunction(function () { var t = document.querySelector('.center p'); return t && /아직 만든 학급이 없어요/.test(t.textContent); });
  assert.equal((await pg.evaluate(function () { return window.__mock.lastOpt; })).prompt, 'consent');
  assert.equal(await pg.evaluate(function () { return window.__mock.askedScope; }), 'https://www.googleapis.com/auth/drive.file');
  assert.equal(await pg.locator('#or-login').count(), 0);

  // 2. 학급 만들기: 드라이브에 파일이 생기고 꼬리표가 붙는다. 주소 입력칸은 없다.
  await pg.waitForSelector('#nc-name');
  assert.equal(await pg.locator('#nc-url').count(), 0);
  await pg.fill('#nc-name', '3학년 5반'); await pg.fill('#nc-pw', '1234');
  await pg.click('[data-act=createclass]');
  await pg.waitForSelector('#bulk');
  var t1 = await tagged();
  assert.equal(t1.length, 1); assert.equal(t1[0].p.name, '3학년 5반'); assert.equal(t1[0].p.pw.length, 64);
  assert.deepEqual(t1[0].sheets, ['요약', '기록', '명단', '쉬는날']);

  // 3. 만들자마자 뜨는 창에 명단 붙여 넣기
  await pg.fill('#bulk', '가람 칠판 지우기\n나래 우유 나르기\n다온 화분 물 주기');
  await pg.click('[data-act=bulkset]');
  await pg.click('[data-act=cnt][data-i="0"]'); await pg.click('[data-act=cnt][data-i="0"]');
  await pg.click('[data-act=saveroster]');
  await pg.waitForFunction(function () { var t = document.querySelector('.toast'); return t && /저장했어요/.test(t.textContent); });
  var roster = await sheet('명단');
  assert.deepEqual(roster[1], ['1', '가람', '칠판 지우기', '', 3]);
  assert.equal(await pg.evaluate(function () { return window.__fmtError || window.__mock.batchError || ''; }), '');
  await pg.click('[data-act=tab][data-tab=class]');
  assert.ok(/teacher@example\.com/.test(await pg.textContent('.sheet')));
  assert.equal(await pg.locator('#s-url').count(), 0);
  await pg.screenshot({ path: shots + '/web-settings.png' });
  await pg.click('[data-act=board]');
  await pg.waitForSelector('.card');

  // 4. 도장: 시트에 ○, 요약 갱신. 이어서 누를 때는 쓰기 요청 한 번뿐
  await pg.click('#card-1'); await pg.waitForTimeout(700);
  assert.equal(await todayCell('2'), '○');
  await pg.evaluate(function () { window.__mock.log = []; });
  await pg.click('#card-0'); await pg.waitForTimeout(700);
  assert.equal(await todayCell('1'), '○');
  var log = await pg.evaluate(function () { return window.__mock.log; });
  assert.deepEqual(log, ['POST /v4/spreadsheets/ID/values:batchUpdate']);
  var sum = await sheet('요약');
  assert.ok(/3학년 5반 1인 1역 요약/.test(sum[0][0])); assert.equal(sum[4][2], '1 / 3명'); assert.equal(sum[7][4], '1 / 3'); assert.equal(sum[8][4], '완료');
  await pg.click('#card-0 .undo'); await pg.waitForTimeout(700);
  assert.equal(await todayCell('1'), '');
  await pg.click('#card-0'); await pg.waitForTimeout(700);

  // 5. 새로 고침: 다시 로그인하면 시트에서 읽어 와 도장이 그대로
  await pg.reload();
  await pg.waitForSelector('#or-login');
  assert.ok(/다시 로그인/.test(await pg.textContent('#or-login')));
  await pg.click('#or-go');
  await pg.waitForSelector('.card');
  assert.equal(await pg.locator('#card-0 .slot.on').count(), 1);
  assert.equal(await pg.locator('#card-1 .slot.on').count(), 1);
  assert.equal((await pg.evaluate(function () { return window.__mock.lastOpt; })).login_hint, 'teacher@example.com');
  await pg.screenshot({ path: shots + '/web-board.png' });

  // 6. 로그인 시간이 끝나도, 다음에 누를 때 조용히 갱신되고 저장된다
  var before = await pg.evaluate(function () { window.ONE_ROLE._test.expire(); window.__mock.valid = null; return window.__mock.tokenReqs; });
  await pg.click('#card-0'); await pg.waitForTimeout(900);
  assert.equal(await todayCell('1'), '○○');
  assert.equal(await pg.evaluate(function () { return window.__mock.tokenReqs; }), before + 1);
  assert.equal(await pg.locator('#or-login').count(), 0);

  // 7. 저장이 실패하면 다시 시도하고, 도장이 두 번 들어가지 않는다
  await pg.evaluate(function () { window.__mock.failNext = 1; });
  await pg.click('#card-0'); await pg.waitForTimeout(500);
  assert.ok(/인터넷/.test(await pg.textContent('#net')));
  assert.equal(await todayCell('1'), '○○');
  await pg.waitForTimeout(4600);
  assert.equal(await todayCell('1'), '○○○');
  assert.equal(await pg.textContent('#num'), '2 / 3');

  // 오류 문구에 어느 단계였는지 나온다
  await pg.evaluate(function () { window.__mock.failNext = 1; window.ONE_ROLE._test.stale(); });
  var msg = await pg.evaluate(function () { return new Promise(function (r) { window.__RUN().withSuccessHandler(function () { r('ok'); }).withFailureHandler(function (e) { r(e.message); }).getState(Object.keys(JSON.parse(listClassesRaw()))[0]); }); function listClassesRaw() { var o = {}; listClasses().forEach(function (c) { o[c.code] = 1; }); return JSON.stringify(o); } });
  assert.ok(/단계: 시트 구성 읽기/.test(msg), msg);

  // 8. 다른 기기에서 시트가 바뀌면 다시 읽어서 덮어쓰지 않는다
  await pg.evaluate(function (today) {
    var f = window.__mock.store.files; for (var id in f) f[id].sheets.forEach(function (s) {
      if (s.properties.title !== '기록') return; var c = s.values[0].indexOf(today);
      for (var r = 1; r < s.values.length; r++) if (String(s.values[r][0]) === '3') { while (s.values[r].length <= c) s.values[r].push(''); s.values[r][c] = '○'; }
    });
    window.ONE_ROLE._test.stale();
  }, today);
  await pg.click('#card-1 .undo'); await pg.waitForTimeout(800);
  assert.equal(await todayCell('2'), ''); assert.equal(await todayCell('3'), '○');

  // 9. 새 스프레드시트로 바꾸기: 새 파일에 꼬리표가 옮겨 가고 명단이 따라간다
  var oldId = (await tagged())[0].id;
  await pg.click('[data-act=settings]'); await pg.fill('#pw', '0000'); await pg.click('[data-act=login]');
  await pg.waitForFunction(function () { var t = document.querySelector('.toast'); return t && /비밀번호/.test(t.textContent); });
  await pg.fill('#pw', '1234'); await pg.click('[data-act=login]');
  await pg.waitForSelector('.tabs');
  await pg.click('[data-act=tab][data-tab=class]');
  await pg.click('[data-act=newsheet]'); await pg.click('[data-act=newsheet2]');
  await pg.waitForFunction(function () { var t = document.querySelector('.toast'); return t && /새 스프레드시트를 만들었어요/.test(t.textContent); });
  await pg.waitForTimeout(500);
  var t2 = await tagged();
  assert.equal(t2.length, 1); assert.notEqual(t2[0].id, oldId); assert.equal(t2[0].p.name, '3학년 5반');
  assert.deepEqual(t2[0].sheets, ['요약', '명단', '기록', '쉬는날']);
  assert.equal((await sheet('명단')).length, 4);
  assert.equal(await pg.evaluate(function () { return Object.keys(window.__mock.store.files).length; }), 2);

  // 10. 쉬는 날, 결석
  await pg.click('[data-act=tab][data-tab=absent]'); await pg.click('[data-act=absent][data-i="2"]'); await pg.waitForTimeout(600);
  assert.equal(await todayCell('3'), '결석');
  await pg.click('[data-act=tab][data-tab=rest]'); await pg.click('[data-act=addrest]'); await pg.fill('input[data-g=name]', '개교기념일'); await pg.click('[data-act=saverest]');
  await pg.waitForTimeout(600);
  assert.equal((await sheet('쉬는날'))[1][2], '개교기념일');

  // 11. 로그아웃하면 로그인 창으로
  await pg.click('[data-act=tab][data-tab=class]'); await pg.click('[data-act=logout]');
  await pg.waitForSelector('#or-login');
  assert.ok(/구글 로그인이 필요해요/.test(await pg.textContent('#or-login')));

  assert.equal(await pg.evaluate(function () { return window.__fmtError || window.__mock.batchError || ''; }), '');
  assert.deepEqual(errs, []);

  // ===== 로그인 없이 이 기기에만 저장하는 방식 =====
  var c2 = await b.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
  var lp = await c2.newPage(), errs2 = [];
  lp.on('pageerror', function (e) { errs2.push(String(e)); });
  await lp.goto(file);
  await lp.waitForSelector('#nc-name');
  assert.equal(await lp.locator('#or-login').count(), 0);
  assert.ok(/이 기기의 브라우저에 저장/.test(await lp.textContent('.modal')));
  await lp.fill('#nc-name', '1학년 2반'); await lp.fill('#nc-pw', '1234'); await lp.click('[data-act=createclass]');
  await lp.waitForSelector('#bulk');
  await lp.fill('#bulk', '가람 칠판 지우기 2\n나래 우유 나르기');
  await lp.click('[data-act=bulkset]'); await lp.click('[data-act=saveroster]');
  await lp.waitForFunction(function () { var t = document.querySelector('.toast'); return t && /저장했어요/.test(t.textContent); });
  await lp.click('[data-act=board]'); await lp.waitForSelector('.card');
  await lp.click('#card-0'); await lp.click('#card-1'); await lp.waitForTimeout(500);
  assert.equal(await lp.textContent('#num'), '1 / 2');

  // 새로 고쳐도 로그인 없이 그대로, 구글에는 아무 요청도 가지 않는다
  await lp.reload();
  await lp.waitForSelector('.card');
  assert.equal(await lp.locator('#or-login').count(), 0);
  assert.equal(await lp.locator('#card-0 .slot.on').count(), 1);
  assert.equal(await lp.locator('#card-1 .slot.on').count(), 1);
  assert.deepEqual(await lp.evaluate(function () { return [window.__mock.log.length, window.__mock.tokenReqs]; }), [0, 0]);
  await lp.screenshot({ path: shots + '/local-board.png' });

  // 설정: 내려받기와 백업, 저장 방식 표시
  await lp.click('[data-act=settings]'); await lp.fill('#pw', '1234'); await lp.click('[data-act=login]');
  await lp.waitForSelector('.tabs'); await lp.click('[data-act=tab][data-tab=class]');
  assert.ok(/이 기기의 브라우저에만/.test(await lp.textContent('.sheet')));
  await lp.screenshot({ path: shots + '/local-settings.png' });
  var fs = require('fs');
  var dl = await Promise.all([lp.waitForEvent('download'), lp.click('[data-act=dl][data-sheet="기록"]')]);
  var csv = fs.readFileSync(await dl[0].path(), 'utf8');
  assert.ok(csv.indexOf('번호,이름,역할,' + today) >= 0, csv);
  assert.ok(csv.indexOf('1,가람,칠판 지우기,○') >= 0 && csv.indexOf('2,나래,우유 나르기,○') >= 0, csv);
  var dl2 = await Promise.all([lp.waitForEvent('download'), lp.click('[data-act=dl][data-sheet="요약"]')]);
  assert.ok(/1학년 2반 1인 1역 요약/.test(fs.readFileSync(await dl2[0].path(), 'utf8')));

  // 백업 → 브라우저 저장 내용 삭제 → 불러오기
  var bk = await Promise.all([lp.waitForEvent('download'), lp.click('[data-act=backup]')]);
  var bkPath = await bk[0].path();
  await lp.evaluate(function () { Object.keys(localStorage).forEach(function (k) { if (/^or_(book|classes)/.test(k)) localStorage.removeItem(k); }); localStorage.removeItem('c'); });
  await lp.reload();
  await lp.waitForSelector('#nc-name');             // 학급이 사라져서 만들기 창이 뜬다
  await lp.click('[data-act=close]');
  var n = await lp.evaluate(function (t) { return window.ONE_ROLE.restore(t); }, fs.readFileSync(bkPath, 'utf8'));
  assert.equal(n, 1);
  await lp.reload();
  await lp.waitForSelector('.tags .btn');
  await lp.click('.tags .btn'); await lp.waitForSelector('.card');
  assert.equal(await lp.locator('#card-0 .slot.on').count(), 1);
  assert.deepEqual(errs2, []);

  console.log('웹 버전 검사 통과');
  await b.close();
})().catch(function (e) { console.error(e); process.exit(1); });
