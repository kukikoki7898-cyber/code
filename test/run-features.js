// 운영 기능 검사: 수업 시간 잠금, 선생님만 지우기(길게 누르기), 학급 목표, 칭찬 음성, 백업 알림
//   node tools/build-web.js --mock <web.html> && node test/build-preview.js <gas.html>
//   node test/run-features.js <web.html> <gas.html> <스크린샷 폴더>
var { chromium } = require('playwright');
var results = [];
function check(name, ok, detail) { results.push((ok ? '통과 ' : '실패 ') + name + (detail !== undefined && detail !== '' ? '  (' + detail + ')' : '')); }

function kst(offsetDays) { return new Date(Date.now() + 9 * 3600000 + (offsetDays || 0) * 86400000).toISOString().slice(0, 10); }
function hm(min) { min = Math.max(0, Math.min(23 * 60 + 59, min)); return ('0' + Math.floor(min / 60)).slice(-2) + ':' + ('0' + (min % 60)).slice(-2); }

async function toast(p, re) {
  await p.waitForFunction(function (src) { var t = document.querySelector('.toast'); return t && new RegExp(src).test(t.textContent); }, re.source, { timeout: 15000 });
}
async function login(p, pw) {
  await p.click('[data-act=settings]'); await p.fill('#pw', pw || '1234'); await p.click('[data-act=login]'); await p.waitForSelector('.tabs');
}
async function toBoard(p) { await p.click('[data-act=board]'); await p.waitForSelector('.card'); }
async function longPress(p, sel) {
  var b = await p.locator(sel).boundingBox();
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 3);
  await p.mouse.down(); await p.waitForTimeout(950); await p.mouse.up();
  await p.waitForTimeout(150);
}
function on(p, i) { return p.evaluate(function (i) { return document.querySelectorAll('#card-' + i + ' .slot.on').length; }, i); }

(async function () {
  var u = function (x) { return /^https?:/.test(x) ? x : 'file://' + x; };
  var web = u(process.argv[2]), gas = u(process.argv[3]), shots = process.argv[4];
  var b = await chromium.launch();
  var ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
  // 음성은 기기마다 달라서, 무엇을 말하려 했는지만 받아 적는다.
  await ctx.addInitScript(function () {
    window.__spoken = [];
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      cancel: function () {}, speak: function (u) { window.__spoken.push(u.text); },
      getVoices: function () { return [{ lang: 'ko-KR', name: '한국어' }]; } } });
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  });
  var p = await ctx.newPage(), errs = [];
  p.on('pageerror', function (e) { errs.push(String(e)); });
  await p.goto(web); await p.waitForSelector('#nc-name');
  await p.fill('#nc-name', '운영반'); await p.fill('#nc-pw', '1234'); await p.click('[data-act=createclass]');
  await p.waitForSelector('#bulk');
  await p.fill('#bulk', '김하늘 칠판 지우기\n이바다 우유 나르기\n박구름 화분 물 주기 2');
  await p.click('[data-act=bulkset]'); await p.click('[data-act=saveroster]'); await toast(p, /저장했어요/);
  await toBoard(p);

  // ===== 2. 지우기는 선생님만 (기본) =====
  await p.click('#card-0'); await p.waitForTimeout(500);
  check('2. 기본값: 도장을 찍어도 학생용 [지우기] 버튼이 없다', await p.locator('.undo').count() === 0);
  await p.reload(); await p.waitForSelector('.card');      // 선생님 비밀번호 기억을 지운다
  await longPress(p, '#card-0');
  check('2-1. 이름표를 길게 누르면 비밀번호를 묻는다', await p.locator('#tpw').count() === 1);
  check('2-2. 길게 누르는 동안 도장이 더 찍히지 않는다', await on(p, 0) === 1, await on(p, 0));
  await p.fill('#tpw', '0000'); await p.click('[data-act=tpwok]'); await toast(p, /비밀번호가 맞지 않아요/);
  check('2-3. 틀린 비밀번호는 거절', await p.locator('[data-act=tundo]').count() === 0);
  await p.fill('#tpw', '1234'); await p.click('[data-act=tpwok]'); await p.waitForSelector('[data-act=tundo]');
  await p.screenshot({ path: shots + '/feat-teacher-menu.png' });
  await p.click('[data-act=tundo]'); await p.waitForTimeout(500);
  check('2-4. 선생님 메뉴에서 도장을 지운다', await on(p, 0) === 0, await on(p, 0));
  await longPress(p, '#card-1');
  check('2-5. 연달아 고칠 때(1분 안)는 비밀번호를 다시 묻지 않는다', await p.locator('#tpw').count() === 0 && await p.locator('[data-act=tabsent]').count() === 1);
  await p.click('[data-act=tabsent]'); await toast(p, /결석으로 표시/);
  check('2-6. 선생님 메뉴에서 결석 표시', await p.locator('#card-1.absent').count() === 1);
  await longPress(p, '#card-1'); await p.click('[data-act=tabsent]'); await toast(p, /결석을 풀었어요/);
  check('2-7. 선생님 메뉴에서 결석 해제', await p.locator('#card-1.absent').count() === 0);
  await p.click('#card-0'); await p.waitForTimeout(400);
  check('2-8. 길게 누른 뒤에도 짧게 누르면 도장이 찍힌다', await on(p, 0) === 1);
  await login(p); await p.click('[data-act=tab][data-tab=rule]');
  await p.click('[data-act=ue][data-v="1"]'); await toast(p, /학생도/);
  await toBoard(p);
  check('2-9. "학생도 지울 수 있게"로 바꾸면 [지우기] 버튼이 생긴다', await p.locator('#card-0 .undo').count() === 1);
  await p.click('#card-0 .undo'); await p.waitForTimeout(400);
  check('2-10. 학생이 [지우기]로 지울 수 있다', await on(p, 0) === 0);

  // ===== 4. 칭찬 음성 =====
  await p.evaluate(function () { window.__spoken = []; });
  await p.click('#card-0'); await p.waitForTimeout(300);
  check('4. 기본값: 음성이 꺼져 있다', (await p.evaluate(function () { return window.__spoken.length; })) === 0);
  await p.click('#card-0 .undo'); await p.waitForTimeout(300);
  await login(p); await p.click('[data-act=tab][data-tab=look]');
  await p.click('[data-act=voice][data-v="1"]'); await p.waitForTimeout(500);
  await p.click('[data-act=voicetest]'); await p.waitForTimeout(200);
  var sp = await p.evaluate(function () { return window.__spoken.slice(); });
  check('4-1. 켜면 바로 안내하고 [들어 보기]도 말한다', sp[0] === '칭찬 음성을 켰어요!' && sp[1] === '하늘아, 고마워! 칠판 지우기 완료!', JSON.stringify(sp));
  await toBoard(p); await p.evaluate(function () { window.__spoken = []; });
  await p.click('#card-0'); await p.waitForTimeout(300);
  await p.click('#card-1'); await p.waitForTimeout(300);
  await p.click('#card-2'); await p.waitForTimeout(300);
  sp = await p.evaluate(function () { return window.__spoken.slice(); });
  check('4-2. 받침 있는 이름: 김하늘 → 하늘아', sp[0] === '하늘아, 고마워! 칠판 지우기 완료!', sp[0]);
  check('4-3. 받침 없는 이름: 이바다 → 바다야', sp[1] === '바다야, 고마워! 우유 나르기 완료!', sp[1]);
  check('4-4. 하루 여러 번 역할은 남은 횟수를 말한다', sp[2] === '구름아, 좋아! 한 번 남았어.', sp[2]);
  await p.click('#card-2'); await p.waitForTimeout(1200);
  sp = await p.evaluate(function () { return window.__spoken.slice(); });
  check('4-5. 반 모두 다 하면 함께 축하한다', sp.indexOf('우리 반 모두 해냈어요! 최고!') >= 0, JSON.stringify(sp.slice(3)));

  // ===== 3. 학급 목표 =====
  // 오늘 도장은 지워 두고 목표를 만든다
  await p.reload(); await p.waitForSelector('.card');
  await login(p); await p.click('[data-act=tab][data-tab=rule]');
  await p.fill('#g-n', '2'); await p.fill('#g-t', '피자 파티'); await p.click('[data-act=goalsave]'); await toast(p, /목표를 저장/);
  await toBoard(p);
  var chip = await p.textContent('#goal');
  check('3. 머리 부분에 목표가 보인다 (오늘 모두 다 함 = 1일)', /🎯\s*1\s*\/\s*2일/.test(chip) && /피자 파티/.test(chip), chip);
  // 어제도 모두 다 한 날로 기록을 넣고, 목표 시작일을 어제로 옮긴다
  var yesterday = kst(-1), today = kst(0);
  await p.evaluate(function (a) {
    var cls = JSON.parse(localStorage.getItem('or_classes')), code = Object.keys(cls)[0], c = cls[code];
    c.goal = '2|' + a.y.replace(/-/g, '') + '|피자 파티'; localStorage.setItem('or_classes', JSON.stringify(cls));
    var key = 'or_book_' + c.sheetId, book = JSON.parse(localStorage.getItem(key));
    book.sheets.forEach(function (s) {
      if (s.p.title !== '기록') return;
      var d = s.d, col = d[0].length;
      d[0].push(a.y);
      for (var r = 1; r < d.length; r++) { while (d[r].length < col) d[r].push(''); d[r][col] = d[r][1] === '박구름' ? '○○' : '○'; }
      // 오늘 열은 비워 둔다
      var tc = d[0].indexOf(a.t); if (tc >= 0) for (var r2 = 1; r2 < d.length; r2++) d[r2][tc] = '';
    });
    localStorage.setItem(key, JSON.stringify(book));
  }, { y: yesterday, t: today });
  await p.reload(); await p.waitForSelector('.card');
  chip = await p.textContent('#goal');
  check('3-1. 어제 모두 다 한 날이 목표에 들어간다', /1\s*\/\s*2일/.test(chip), chip);
  await p.click('#card-0'); await p.click('#card-1'); await p.click('#card-2'); await p.waitForTimeout(250);
  chip = await p.textContent('#goal');
  check('3-2. 아직 한 명 남았으면 오늘은 안 센다', /1\s*\/\s*2일/.test(chip), chip);
  await p.evaluate(function () { window.__banners = []; new MutationObserver(function (m) { m.forEach(function (x) { [].forEach.call(x.addedNodes, function (n) { if (n.className === 'banner') window.__banners.push(n.textContent); }); }); }).observe(document.body, { childList: true }); });
  await p.click('#card-2'); await p.waitForTimeout(5600);
  chip = await p.textContent('#goal');
  var bn = await p.evaluate(function () { return window.__banners; });
  check('3-3. 오늘 모두 다 하면 목표 달성', /목표 달성/.test(chip), chip);
  check('3-4. 축하 화면이 뜬다', bn.some(function (t) { return /목표 달성! 피자 파티/.test(t); }), JSON.stringify(bn));
  await p.screenshot({ path: shots + '/feat-goal.png' });
  await longPress(p, '#card-0'); await p.fill('#tpw', '1234'); await p.click('[data-act=tpwok]');
  await p.waitForSelector('[data-act=tundo]'); await p.click('[data-act=tundo]'); await p.waitForTimeout(400);
  chip = await p.textContent('#goal');
  check('3-5. 도장을 지우면 다시 1일로', /1\s*\/\s*2일/.test(chip), chip);
  await login(p); await p.click('[data-act=tab][data-tab=rule]'); await p.click('[data-act=goaloff]'); await toast(p, /목표를 껐어요/);
  await toBoard(p);
  check('3-6. 목표를 끄면 머리 부분에서 사라진다', await p.locator('#goal').count() === 0);

  // ===== 1. 수업 시간 잠금 =====
  var nowMin = await p.evaluate(function () { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); });
  await login(p); await p.click('[data-act=tab][data-tab=rule]');
  check('1. 기본 시간표 6교시가 채워져 있다', await p.locator('input[data-l="0"]').count() === 6);
  while (await p.locator('[data-act=lockdel]').count()) await p.click('[data-act=lockdel] >> nth=0');
  await p.click('[data-act=lockadd]');
  await p.fill('input[data-l="0"][data-i="0"]', hm(nowMin - 5)); await p.fill('input[data-l="1"][data-i="0"]', hm(nowMin + 30));
  await p.click('[data-act=lockon][data-v="1"]'); await toast(p, /잠금을 켰어요/);
  await p.reload(); await p.waitForSelector('.card');
  check('1-1. 수업 시간에는 잠금 화면이 뜬다', await p.locator('#lockov').count() === 1);
  await p.screenshot({ path: shots + '/feat-lock.png' });
  var before = await on(p, 0);
  await p.click('#card-0', { force: true }); await p.waitForTimeout(300);
  check('1-2. 잠긴 동안 이름표를 눌러도 도장이 안 찍힌다', await on(p, 0) === before, before + ' → ' + await on(p, 0));
  await p.click('[data-act=tunlock]');
  check('1-3. [선생님: 잠깐 풀기]는 비밀번호를 묻는다', await p.locator('#tpw').count() === 1);
  await p.fill('#tpw', '1234'); await p.click('[data-act=tpwok]'); await toast(p, /풀었어요/);
  check('1-4. 풀면 잠금 화면이 사라진다', await p.locator('#lockov').count() === 0);
  await p.click('#card-0'); await p.waitForTimeout(400);
  check('1-5. 풀린 동안은 도장이 찍힌다', await on(p, 0) === before + 1);
  // 지금이 아닌 시간대만 잠그면 잠금 화면이 없다
  await login(p); await p.click('[data-act=tab][data-tab=rule]');
  var other = nowMin >= 60 ? ['00:00', '00:30'] : ['23:00', '23:30'];
  await p.fill('input[data-l="0"][data-i="0"]', other[0]); await p.fill('input[data-l="1"][data-i="0"]', other[1]);
  await p.click('[data-act=locksave]'); await toast(p, /잠금을 켰어요/);
  await p.reload(); await p.waitForSelector('.card');
  check('1-6. 쉬는 시간에는 잠금 화면이 없다', await p.locator('#lockov').count() === 0);
  // 잘못된 시간
  await login(p); await p.click('[data-act=tab][data-tab=rule]');
  await p.fill('input[data-l="0"][data-i="0"]', '10:00'); await p.fill('input[data-l="1"][data-i="0"]', '09:00');
  await p.click('[data-act=locksave]'); await toast(p, /끝나는 시각이 시작보다 늦어야/);
  check('1-7. 끝이 시작보다 빠른 시간표는 거절', true);
  await p.click('[data-act=lockon][data-v="0"]').catch(function () {});
  await p.fill('input[data-l="0"][data-i="0"]', hm(nowMin - 5)); await p.fill('input[data-l="1"][data-i="0"]', hm(nowMin + 30));
  await p.click('[data-act=lockon][data-v="0"]'); await toast(p, /잠금을 껐어요/);
  await p.reload(); await p.waitForSelector('.card');
  check('1-8. 잠금을 끄면 수업 시간이어도 잠금 화면이 없다', await p.locator('#lockov').count() === 0);

  // ===== 5. 백업 알림 =====
  check('5. 처음 쓰는 기기는 알림이 없다', !/due/.test(await p.getAttribute('#setbtn', 'class')));
  await p.evaluate(function () { localStorage.setItem('or_since', String(Date.now() - 8 * 86400000)); localStorage.removeItem('or_lastbackup'); });
  await p.reload(); await p.waitForSelector('.card');
  check('5-1. 일주일 넘게 백업하지 않으면 [설정]에 빨간 점', /due/.test(await p.getAttribute('#setbtn', 'class')));
  await login(p);
  var wb = await p.locator('.warnbox').count() ? await p.textContent('.warnbox') : '';
  check('5-2. 설정을 열면 기록 보관 탭에서 바로 알려 준다', /아직 백업 파일을 저장한 적이 없어요/.test(wb), wb.slice(0, 30));
  await p.screenshot({ path: shots + '/feat-backup.png' });
  var dl = await Promise.all([p.waitForEvent('download'), p.click('.warnbox [data-act=backup]')]);
  await p.waitForTimeout(200);
  var json = JSON.parse(require('fs').readFileSync(await dl[0].path(), 'utf8'));
  check('5-3. 알림의 버튼으로 백업 파일이 저장된다', json.app === 'oneRole' && Object.keys(json.classes).length === 1);
  check('5-4. 저장하면 알림이 사라진다', await p.locator('.warnbox').count() === 0);
  await toBoard(p);
  check('5-5. [설정]의 빨간 점도 사라진다', !/due/.test(await p.getAttribute('#setbtn', 'class')));
  await p.evaluate(function () { localStorage.setItem('or_lastbackup', String(Date.now() - 10 * 86400000)); });
  await p.reload(); await p.waitForSelector('.card'); await login(p);
  wb = await p.textContent('.warnbox');
  check('5-6. 마지막 백업 뒤 10일이면 날짜를 알려 준다', /10일 전/.test(wb), wb.slice(0, 30));
  check('5-7. 오류 없음', errs.length === 0, errs.join(' | '));

  // 구글 설치(Apps Script) 방식에서는 백업 알림이 나오지 않는다 (기록이 구글 시트에 있으므로)
  var g = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await g.goto(gas); await g.waitForSelector('.card');
  await g.evaluate(function () { localStorage.setItem('or_since', String(Date.now() - 30 * 86400000)); });
  await g.reload(); await g.waitForSelector('.card');
  check('5-8. 구글 시트 방식에는 백업 알림이 없다', !/due/.test(await g.getAttribute('#setbtn', 'class')));

  console.log(results.join('\n'));
  await b.close();
  process.exit(results.some(function (r) { return r.indexOf('실패') === 0; }) ? 1 : 0);
})().catch(function (e) { console.log(results.join('\n')); console.error(String(e).split('\n')[0]); process.exit(2); });
