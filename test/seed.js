/* 미리보기용 예시 학급 */
(function () {
  if (/noseed/.test(location.search)) return;
  var names = ['강다은','김도윤','김서아','나하준','노은우','문지호','박서연','박시우','배하린','서준우','손예린','신유찬',
    '안소율','오지안','유태윤','윤아린','이도현','이수아','장하율','전민서','정이든','조채원','최로운','한지유'];
  var roles = [['칠판 지우기',3],['칠판 지우기',3],['우유 나르기',1],['우유 나르기',1],['화분 물 주기',1],['창문 열고 닫기',2],['전등 끄기',2],['신발장 정리',1],
    ['학급 문고 정리',1],['분리수거',1],['분리수거',1],['급식 줄 세우기',1],['수저 나눠 주기',1],['알림장 검사',1],['우산꽂이 정리',1],['책상 줄 맞추기',2],
    ['손 소독제 챙기기',1],['체육 준비',1],['시간 알리미',4],['안내장 나눠 주기',1],['쓰레기통 비우기',1],['미술 준비',1],['물고기 밥 주기',1],['칭찬 우체부',1]];
  window.__TODAY = '2026-11-02';
  var code = createClass('2학년 3반', '', '1234').code;
  var list = [];
  for (var i = 0; i < names.length; i++) list.push({ no: String(i + 1), name: names[i], role: roles[i][0], icon: '', target: roles[i][1] });
  saveRoster(code, '1234', list);
  var days = ['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-09','2026-11-10','2026-11-11','2026-11-12'];
  for (var d = 0; d < days.length; d++) {
    window.__TODAY = days[d];
    for (var s = 0; s < list.length; s++) {
      var skip = (s * 7 + d * 3) % 11 === 0, last = d === days.length - 1;
      if (last && s % 3 !== 0) continue;
      var n = skip ? list[s].target - 1 : list[s].target;
      if (last && s === 18) n = 2;
      for (var k = 0; k < n; k++) record(code, list[s].no, 1, days[d]);
    }
  }
  setAbsent(code, '1234', '9', true, '2026-11-12');
  window.__SEED_CODE = /pick/.test(location.search) ? '' : code;
})();
