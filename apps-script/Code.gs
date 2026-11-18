/**
 * 우리 반 1인 1역 — Google Apps Script 서버 코드
 *
 * 시트 구성 (학급마다 스프레드시트 1개)
 *   요약   : 맨 앞 시트. 학급 전체 현황과 학생별 통계 (자동으로 다시 쓰임)
 *   명단   : 번호 | 이름 | 역할 | 그림 | 하루 횟수
 *   기록   : 번호 | 이름 | 역할 | 2026-03-02 | 2026-03-03 | ...   (칸 값: ○, ○○, 결석)
 *   쉬는날 : 시작 | 끝 | 이름
 *
 * 학급 목록(이름, 시트 ID, 비밀번호 해시)은 스크립트 속성에 저장한다.
 */

var TZ = 'Asia/Seoul';
var SH_ROSTER = '명단';
var SH_LOG = '기록';
var SH_REST = '쉬는날';
var SH_SUM = '요약';
var SUM_HEAD = ['번호', '이름', '역할', '하루 횟수', '오늘', '월', '화', '수', '목', '금', '이번 주', '이번 달', '전체 달성률', '연속', '모은 스티커'];
var SUM_COLS = 15;
var SUM_TOP = 7;
var WEEK_KO = ['일', '월', '화', '수', '목', '금', '토'];
var C_HEAD = '#3d6fa5';
var C_SOFT = '#eaf2fb';
var C_LINE = '#c9d3de';
var ROSTER_HEAD = ['번호', '이름', '역할', '그림', '하루 횟수'];
var LOG_HEAD = ['번호', '이름', '역할'];
var REST_HEAD = ['시작', '끝', '이름'];
var MARK = '○';
var ABSENT = '결석';
var MAX_TARGET = 5;
// 참이면 꾸미기 오류도 숨기지 않고 알려 준다. (설치 점검과 자동 검사에서만 켠다)
var STRICT_ = typeof __STRICT_STYLE !== 'undefined';

function doGet(e) {
  var c = String((e && e.parameter && e.parameter.c) || '').replace(/[^a-z0-9]/g, '');
  // HTML 파일 이름을 조금 다르게 만들었어도 찾아 준다.
  var names = ['Index', 'index', 'Index.html', 'index.html', 'INDEX'], t = null;
  for (var i = 0; i < names.length && !t; i++) {
    try { t = HtmlService.createTemplateFromFile(names[i]); } catch (err) { t = null; }
  }
  if (!t) {
    return HtmlService.createHtmlOutput('<p style="font:20px sans-serif;padding:30px">HTML 파일을 찾을 수 없어요.<br>' +
      'Apps Script 편집기 왼쪽 파일 목록에 <b>Index.html</b> 파일이 있는지 확인하고, 저장한 뒤 새 버전으로 다시 배포해 주세요.</p>');
  }
  t.boot = JSON.stringify({ c: c, url: ScriptApp.getService().getUrl() || '' });
  return t.evaluate()
    .setTitle('우리 반 1인 1역')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ---------- 작은 도우미 ---------- */

function str_(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/^\s+|\s+$/g, '');
}

function clamp_(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function today_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function ms_(d) {
  var p = d.split('-');
  return Date.UTC(+p[0], +p[1] - 1, +p[2]);
}

function dow_(d) {
  return new Date(ms_(d)).getUTCDay();
}

function addDays_(d, n) {
  return new Date(ms_(d) + n * 86400000).toISOString().slice(0, 10);
}

/** 시트 칸 값을 yyyy-MM-dd 문자열로. 날짜가 아니면 ''. */
function normDate_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz || TZ, 'yyyy-MM-dd');
  var s = str_(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function marks_(n) {
  var s = '';
  for (var i = 0; i < n; i++) s += MARK;
  return s;
}

/** 칸 값: '○○' (도장 2개), '결석' 또는 '결석 ○○' (결석 처리 전에 찍은 도장 2개를 기억해 둔다) */
function parseCell_(v) {
  var s = str_(v), absent = s.indexOf(ABSENT) === 0;
  if (absent) s = s.slice(ABSENT.length);
  var n = 0;
  for (var i = 0; i < s.length; i++) if (s.charAt(i) === MARK) n++;
  if (!n && /^\d+$/.test(s)) n = parseInt(s, 10);
  return { count: n, absent: absent };
}

function cellText_(n, absent) {
  return absent ? ABSENT + (n > 0 ? ' ' + marks_(n) : '') : marks_(n);
}

/* ---------- 학급 목록 (스크립트 속성) ---------- */

function props_() {
  return PropertiesService.getScriptProperties();
}

function getClass_(code) {
  code = String(code || '').replace(/[^a-z0-9]/g, '');
  var raw = code ? props_().getProperty('class_' + code) : null;
  if (!raw) throw new Error('학급을 찾을 수 없어요.');
  var c = JSON.parse(raw);
  c.code = code;
  return c;
}

function putClass_(c) {
  var i = classInfo_(c);
  props_().setProperty('class_' + c.code, JSON.stringify({
    name: c.name, sheetId: c.sheetId, pw: c.pw, sound: i.sound, align: i.align, lock: i.lock, ue: i.ue, goal: i.goal, voice: i.voice
  }));
}

/**
 * 학급 설정 (화면에 보내는 것)
 *   lock  : 수업 시간 잠금. '1|0900-0940,0950-1030' (앞 숫자 1 = 켬, 0 = 끔), '' = 설정 안 함
 *   ue    : 참이면 학생도 [지우기] 버튼을 쓸 수 있다. 거짓이면 선생님만 (이름표 길게 누르기)
 *   goal  : 학급 목표. '10|20261118|피자 파티' (모두 다 한 날 10일, 시작 날짜, 보상), '' = 없음
 *   voice : 칭찬 음성
 */
function classInfo_(c) {
  return {
    name: c.name, sound: c.sound !== false, align: c.align === 'low' ? 'low' : '',
    lock: LOCK_RE_.test(c.lock || '') ? c.lock : '', ue: !!c.ue, goal: GOAL_RE_.test(c.goal || '') ? c.goal : '', voice: !!c.voice
  };
}
var LOCK_RE_ = /^[01]\|(\d{4}-\d{4}(,\d{4}-\d{4}){0,11})?$/;
var GOAL_RE_ = /^\d{1,3}\|\d{8}\|[^|]{0,30}$/;

function hash_(salt, pw) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + pw, Utilities.Charset.UTF_8);
  var s = '';
  for (var i = 0; i < b.length; i++) {
    var v = (b[i] + 256) % 256;
    s += (v < 16 ? '0' : '') + v.toString(16);
  }
  return s;
}

function checkPw_(cls, pw) {
  if (hash_(cls.code, String(pw || '')) !== cls.pw) {
    Utilities.sleep(500);
    throw new Error('비밀번호가 맞지 않아요.');
  }
}

function parseSheetId_(url) {
  var s = str_(url);
  var m = s.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
  throw new Error('스프레드시트 주소가 올바르지 않아요. 주소창의 주소를 그대로 붙여 넣어 주세요.');
}

function sheetUrl_(id) {
  return 'https://docs.google.com/spreadsheets/d/' + id + '/edit';
}

function openBook_(cls) {
  try {
    return SpreadsheetApp.openById(cls.sheetId);
  } catch (err) {
    if (err && err.need) throw err;   // 웹 버전: 시트를 먼저 읽어 와야 한다는 신호
    throw new Error('스프레드시트를 열 수 없어요. 이 앱을 설치한 구글 계정으로 만든 시트인지 확인해 주세요. 다른 계정의 시트라면 설치한 계정을 편집자로 공유해야 해요.');
  }
}

/* ---------- 시트 읽기 ---------- */

function sheet_(ss, name, head) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name, ss.getSheets().length);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, head.length).setValues([head]);
    tidySheet_(sh, name);
  }
  return sh;
}

/** 시트 크기가 모자라면 늘린다. (범위를 벗어나 쓰면 오류가 나므로) */
function grow_(sh, rows, cols) {
  var mc = sh.getMaxColumns(), mr = sh.getMaxRows();
  if (mc < cols) sh.insertColumnsAfter(mc, cols - mc + 10);
  if (mr < rows) sh.insertRowsAfter(mr, rows - mr + 20);
}

/** 꾸미기는 실패해도 기록에는 지장이 없도록 감싼다. */
function safe_(fn) {
  try { fn(); } catch (err) { if (STRICT_ || (err && err.need)) throw err; }
}

function headStyle_(rng) {
  rng.setBackground(C_HEAD).setFontColor('#ffffff').setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
}

/** 명단 · 기록 · 쉬는날 시트를 보기 좋게 정리한다. 여러 번 불러도 결과가 같다. */
function tidySheet_(sh, name) {
  safe_(function () {
    var rows = Math.max(sh.getLastRow(), 2), cols = Math.max(sh.getLastColumn(), 3);
    var maxR = sh.getMaxRows(), maxC = sh.getMaxColumns();
    sh.setFrozenRows(1);
    sh.setRowHeight(1, 32);
    if (name === SH_ROSTER) {
      sh.setTabColor('#4a90c9');
      var w = [60, 110, 230, 60, 90];
      for (var i = 0; i < w.length; i++) sh.setColumnWidth(i + 1, w[i]);
      headStyle_(sh.getRange(1, 1, 1, 5));
      sh.getRange(2, 1, maxR - 1, 5).setVerticalAlignment('middle').setHorizontalAlignment('center');
      sh.getRange(2, 2, maxR - 1, 2).setHorizontalAlignment('left');
      sh.getRange(1, 1, rows, 5).setBorder(true, true, true, true, true, true, C_LINE, SpreadsheetApp.BorderStyle.SOLID);
    } else if (name === SH_LOG) {
      sh.setTabColor('#5fae57');
      sh.setColumnWidth(1, 60); sh.setColumnWidth(2, 110); sh.setColumnWidth(3, 210);
      if (maxC > 3) {
        sh.setFrozenColumns(3);
        sh.setColumnWidths(4, maxC - 3, 96);
        sh.getRange(1, 4, maxR, maxC - 3).setHorizontalAlignment('center');
      }
      headStyle_(sh.getRange(1, 1, 1, cols));
      sh.getRange(2, 1, maxR - 1, 1).setHorizontalAlignment('center');
      sh.getRange(1, 1, maxR, maxC).setVerticalAlignment('middle');
      sh.getRange(1, 1, rows, cols).setBorder(true, true, true, true, true, true, C_LINE, SpreadsheetApp.BorderStyle.SOLID);
      var body = sh.getRange(2, 4, maxR - 1, Math.max(maxC - 3, 1));
      sh.setConditionalFormatRules([
        SpreadsheetApp.newConditionalFormatRule().whenTextContains(ABSENT).setBackground('#e8e8e8').setFontColor('#888888').setRanges([body]).build(),
        SpreadsheetApp.newConditionalFormatRule().whenTextContains(MARK).setBackground('#fff4c7').setFontColor('#c0392b').setRanges([body]).build()
      ]);
    } else if (name === SH_REST) {
      sh.setTabColor('#f39a2b');
      sh.setColumnWidth(1, 120); sh.setColumnWidth(2, 120); sh.setColumnWidth(3, 240);
      headStyle_(sh.getRange(1, 1, 1, 3));
      sh.getRange(2, 1, maxR - 1, 2).setHorizontalAlignment('center');
      sh.getRange(1, 1, rows, 3).setBorder(true, true, true, true, true, true, C_LINE, SpreadsheetApp.BorderStyle.SOLID);
    }
  });
}

function tidy_(ss) {
  tidySheet_(sheet_(ss, SH_LOG, LOG_HEAD), SH_LOG);
  tidySheet_(sheet_(ss, SH_ROSTER, ROSTER_HEAD), SH_ROSTER);
  tidySheet_(sheet_(ss, SH_REST, REST_HEAD), SH_REST);
}

function pct_(a, b) {
  return b ? Math.round(a / b * 100) + '%' : '-';
}

/**
 * 맨 앞 [요약] 시트를 다시 쓴다. st 는 buildState_ 결과.
 * full 이 참이면 칸 합치기, 색, 너비 같은 꾸밈도 다시 한다.
 */
function writeSummary_(cls, ss, st, full) {
  var sh = ss.getSheetByName(SH_SUM);
  if (!sh) { sh = ss.insertSheet(SH_SUM, 0); full = true; }
  var a = st.students, n = a.length;
  grow_(sh, SUM_TOP + n + 1, SUM_COLS);

  var present = 0, done = 0, absent = 0, wkFull = 0, wkDays = 0, moFull = 0, moDays = 0, rows = [];
  for (var i = 0; i < n; i++) {
    var s = a[i], ok = !s.absent && s.done >= s.target, wk = [], wkCount = 0;
    if (s.absent) absent++; else { present++; if (ok) done++; }
    for (var j = 0; j < st.week.length; j++) {
      var w = s.week[j];
      wk.push(w === 'full' ? '★' : w === 'part' ? '△' : w === 'absent' ? '결' : '');
      if (w === 'full') wkCount++;
      if (st.week[j].has && w !== 'absent') { wkDays++; if (w === 'full') wkFull++; }
    }
    moFull += s.monthFull; moDays += s.monthDays;
    rows.push([s.no, s.name, s.role, s.target,
      s.absent ? ABSENT : ok ? '완료' : s.done > 0 ? (s.done + ' / ' + s.target) : '-']
      .concat(wk, [wkCount + '일', s.monthFull + ' / ' + s.monthDays + '일', s.days ? s.total / s.days : '',
        (s.streak + (ok ? 1 : 0)) + '일', s.total]));
  }

  var blank = function () { var r = []; for (var k = 0; k < SUM_COLS; k++) r.push(''); return r; };
  var top = [blank(), blank(), blank(), blank(), blank()];
  top[0][0] = cls.name + ' 1인 1역 요약';
  top[1][0] = '기준: ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm') + ' (' + WEEK_KO[st.dow] + '요일)' +
    (st.rest ? ' · 오늘은 쉬는 날(' + st.rest + ')' : '') + '   ※ 도장을 찍을 때마다 자동으로 다시 쓰이는 시트입니다. 직접 고치지 마세요.';
  var lab = [[0, '학생 수', n + '명'], [2, '오늘 다 한 친구', done + ' / ' + present + '명'], [3, '오늘 결석', absent + '명'],
    [5, '이번 주 달성률', pct_(wkFull, wkDays)], [10, '이번 달 달성률', pct_(moFull, moDays)], [12, '기록한 날', st.days + '일']];
  for (var q = 0; q < lab.length; q++) { top[3][lab[q][0]] = lab[q][1]; top[4][lab[q][0]] = lab[q][2]; }

  sh.getRange(1, 1, 5, SUM_COLS).setValues(top);
  sh.getRange(SUM_TOP, 1, 1, SUM_COLS).setValues([SUM_HEAD]);
  if (n) sh.getRange(SUM_TOP + 1, 1, n, SUM_COLS).setValues(rows);
  var last = sh.getLastRow();
  if (last > SUM_TOP + n) { sh.getRange(SUM_TOP + n + 1, 1, last - SUM_TOP - n, SUM_COLS).clear(); full = true; }

  if (full) safe_(function () {
    sh.setTabColor('#d8362b');
    sh.setHiddenGridlines(true);
    sh.setFrozenRows(SUM_TOP);
    var w = [56, 100, 200, 80, 90, 44, 44, 44, 44, 44, 76, 100, 96, 70, 96];
    for (var c = 0; c < w.length; c++) sh.setColumnWidth(c + 1, w[c]);
    sh.setRowHeight(1, 46); sh.setRowHeight(4, 26); sh.setRowHeight(5, 42); sh.setRowHeight(SUM_TOP, 32);

    sh.getRange(1, 1, 1, SUM_COLS).merge().setBackground(C_HEAD).setFontColor('#ffffff').setFontSize(18).setFontWeight('bold')
      .setHorizontalAlignment('left').setVerticalAlignment('middle');
    sh.getRange(2, 1, 1, SUM_COLS).merge().setFontColor('#777777').setFontSize(9).setHorizontalAlignment('left');

    var box = [[1, 2], [3, 1], [4, 2], [6, 5], [11, 2], [13, 3]];
    for (var b = 0; b < box.length; b++) {
      var l = sh.getRange(4, box[b][0], 1, box[b][1]), v = sh.getRange(5, box[b][0], 1, box[b][1]);
      if (box[b][1] > 1) { l.merge(); v.merge(); }
      l.setBackground(C_SOFT).setFontSize(10).setFontWeight('bold').setFontColor('#44546a').setHorizontalAlignment('center').setVerticalAlignment('middle');
      v.setFontSize(16).setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle');
      sh.getRange(4, box[b][0], 2, box[b][1]).setBorder(true, true, true, true, null, null, C_LINE, SpreadsheetApp.BorderStyle.SOLID);
    }

    headStyle_(sh.getRange(SUM_TOP, 1, 1, SUM_COLS));
    if (n) {
      var body = sh.getRange(SUM_TOP + 1, 1, n, SUM_COLS);
      body.setHorizontalAlignment('center').setVerticalAlignment('middle').setFontSize(11).setFontWeight('normal').setFontColor('#222222')
        .setBorder(true, true, true, true, true, true, C_LINE, SpreadsheetApp.BorderStyle.SOLID);
      sh.getRange(SUM_TOP + 1, 2, n, 2).setHorizontalAlignment('left');
      sh.getRange(SUM_TOP + 1, 2, n, 1).setFontWeight('bold');
      sh.getRange(SUM_TOP + 1, 13, n, 1).setNumberFormat('0%');
      var bg = [];
      for (var r = 0; r < n; r++) { var line = []; for (var k = 0; k < SUM_COLS; k++) line.push(r % 2 ? '#f7f9fb' : '#ffffff'); bg.push(line); }
      body.setBackgrounds(bg);
      var marks = sh.getRange(SUM_TOP + 1, 5, n, 6);
      sh.setConditionalFormatRules([
        SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('완료').setBackground('#d9f2d0').setFontColor('#2e7d32').setBold(true).setRanges([marks]).build(),
        SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(ABSENT).setBackground('#e8e8e8').setFontColor('#888888').setRanges([marks]).build(),
        SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('결').setBackground('#e8e8e8').setFontColor('#888888').setRanges([marks]).build(),
        SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('★').setFontColor('#e09a00').setRanges([marks]).build(),
        SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('△').setFontColor('#999999').setRanges([marks]).build()
      ]);
    }
  });
}

function readRoster_(ss) {
  var v = sheet_(ss, SH_ROSTER, ROSTER_HEAD).getDataRange().getValues();
  var out = [], seen = {};
  for (var i = 1; i < v.length; i++) {
    var name = str_(v[i][1]);
    if (!name) continue;
    var no = str_(v[i][0]) || name;
    if (seen['k' + no]) continue;
    seen['k' + no] = true;
    out.push({
      no: no, name: name, role: str_(v[i][2]), icon: str_(v[i][3]),
      target: clamp_(parseInt(v[i][4], 10) || 1, 1, MAX_TARGET)
    });
  }
  return out;
}

function readLog_(ss) {
  var sh = sheet_(ss, SH_LOG, LOG_HEAD);
  var v = sh.getDataRange().getValues();
  var tz = ss.getSpreadsheetTimeZone();
  var dateCol = {}, rowOf = {};
  for (var c = 3; c < v[0].length; c++) {
    var d = normDate_(v[0][c], tz);
    if (d && dateCol[d] === undefined) dateCol[d] = c;
  }
  for (var r = 1; r < v.length; r++) {
    var k = 'k' + str_(v[r][0]);
    if (k !== 'k' && rowOf[k] === undefined) rowOf[k] = r;
  }
  return { sh: sh, v: v, dateCol: dateCol, rowOf: rowOf };
}

function readRest_(ss) {
  var v = sheet_(ss, SH_REST, REST_HEAD).getDataRange().getValues();
  var tz = ss.getSpreadsheetTimeZone();
  var out = [];
  for (var i = 1; i < v.length; i++) {
    var a = normDate_(v[i][0], tz);
    if (!a) continue;
    var b = normDate_(v[i][1], tz) || a;
    if (b < a) b = a;
    out.push({ start: a, end: b, name: str_(v[i][2]) });
  }
  return out;
}

function restReason_(d, rest) {
  for (var i = 0; i < rest.length; i++) {
    if (d >= rest[i].start && d <= rest[i].end) return rest[i].name || '쉬는 날';
  }
  var w = dow_(d);
  return (w === 0 || w === 6) ? '주말' : '';
}

/* ---------- 화면에 필요한 상태 만들기 ---------- */

function buildState_(cls, ss) {
  var roster = readRoster_(ss), log = readLog_(ss), rest = readRest_(ss);
  var today = today_();
  var dates = [];
  for (var d in log.dateCol) dates.push(d);
  dates.sort();

  var monday = addDays_(today, -((dow_(today) + 6) % 7));
  var week = [];
  for (var i = 0; i < 5; i++) {
    var wd = addDays_(monday, i);
    week.push({ date: wd, rest: !!restReason_(wd, rest), has: log.dateCol[wd] !== undefined });
  }
  var month = today.slice(0, 7);

  var students = [];
  for (var s = 0; s < roster.length; s++) {
    var st = roster[s];
    var row = log.rowOf['k' + st.no];
    var cellAt = function (date) {
      var c = log.dateCol[date];
      if (row === undefined || c === undefined || c >= log.v[row].length) return null;
      return parseCell_(log.v[row][c]);
    };
    var total = 0, days = 0, monthFull = 0, monthDays = 0, streak = 0, streakOpen = true;
    for (var k = dates.length - 1; k >= 0; k--) {
      var cell = cellAt(dates[k]) || { count: 0, absent: false };
      var full = !cell.absent && cell.count >= st.target;
      if (full) total++;
      if (!cell.absent) days++;
      if (dates[k].slice(0, 7) === month && !cell.absent) {
        monthDays++;
        if (full) monthFull++;
      }
      if (dates[k] < today && streakOpen && !cell.absent) {
        if (full) streak++; else streakOpen = false;
      }
    }
    var wk = [];
    for (var j = 0; j < week.length; j++) {
      var wc = cellAt(week[j].date);
      if (wc && wc.absent) wk.push('absent');
      else if (wc && wc.count >= st.target) wk.push('full');
      else if (wc && wc.count > 0) wk.push('part');
      else if (week[j].date > today) wk.push('future');
      else if (week[j].rest) wk.push('rest');
      else wk.push('none');
    }
    var now = cellAt(today) || { count: 0, absent: false };
    students.push({
      no: st.no, name: st.name, role: st.role, icon: st.icon, target: st.target,
      done: Math.min(now.count, st.target), absent: now.absent,
      streak: streak, week: wk, monthFull: monthFull, monthDays: monthDays, total: total, days: days
    });
  }

  // 학급 목표: 시작한 날부터 어제까지, 출석한 친구가 모두 다 한 날 수 (오늘은 화면에서 실시간으로 더한다)
  var info = classInfo_(cls), goalPast = 0;
  if (info.goal) {
    var gs = info.goal.split('|')[1], gStart = gs.slice(0, 4) + '-' + gs.slice(4, 6) + '-' + gs.slice(6, 8);
    for (var g = 0; g < dates.length; g++) {
      if (dates[g] < gStart || dates[g] >= today) continue;
      var gc = log.dateCol[dates[g]], present = 0, full = 0;
      for (var q = 0; q < roster.length; q++) {
        var rr = log.rowOf['k' + roster[q].no];
        var cell = rr === undefined || gc >= log.v[rr].length ? { count: 0, absent: false } : parseCell_(log.v[rr][gc]);
        if (cell.absent) continue;
        present++;
        if (cell.count >= roster[q].target) full++;
      }
      if (present && full === present) goalPast++;
    }
  }

  return {
    code: cls.code, name: info.name, sound: info.sound, align: info.align, lock: info.lock, ue: info.ue, goal: info.goal, voice: info.voice,
    goalPast: goalPast, today: today, dow: dow_(today), rest: restReason_(today, rest),
    week: week, students: students, days: dates.length
  };
}

/* ---------- 누구나 부를 수 있는 함수 ---------- */

function listClasses() {
  var all = props_().getProperties(), out = [];
  for (var k in all) {
    if (k.indexOf('class_') !== 0) continue;
    try { out.push({ code: k.slice(6), name: JSON.parse(all[k]).name }); } catch (err) { /* 건너뜀 */ }
  }
  out.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
  return out;
}

function createClass(name, sheetUrl, pw) {
  name = str_(name).slice(0, 20);
  pw = String(pw || '');
  if (!name) throw new Error('학급 이름을 적어 주세요.');
  if (pw.length < 4) throw new Error('비밀번호는 4자 이상으로 정해 주세요.');
  var made = !str_(sheetUrl);
  var id = made ? SpreadsheetApp.create('1인 1역 기록 - ' + name).getId() : parseSheetId_(sheetUrl);
  var code = '';
  do {
    code = '';
    for (var i = 0; i < 6; i++) code += 'abcdefghjkmnpqrstuvwxyz23456789'.charAt(Math.floor(Math.random() * 31));
  } while (props_().getProperty('class_' + code));
  var cls = { code: code, name: name, sheetId: id, sound: true };
  cls.pw = hash_(code, pw);
  var ss = openBook_(cls);
  tidy_(ss);
  writeSummary_(cls, ss, buildState_(cls, ss), true);
  // 새로 만든 파일이면 처음부터 있던 빈 시트는 지운다.
  if (made) safe_(function () {
    var all = ss.getSheets(), keep = [SH_SUM, SH_LOG, SH_ROSTER, SH_REST];
    for (var k = 0; k < all.length; k++) if (keep.indexOf(all[k].getName()) < 0) ss.deleteSheet(all[k]);
  });
  putClass_(cls);
  return { code: code };
}

function getState(code) {
  var cls = getClass_(code);
  return buildState_(cls, openBook_(cls));
}

/** 오늘 칸을 고친다. fn(현재 칸, 학생) -> { text: 새 값, out: 돌려줄 값 } */
function mutate_(cls, no, date, fn) {
  if (date !== today_()) return { stale: true };
  // 스크립트 잠금은 모든 학급이 함께 쓰므로, 도장 칸을 읽고 쓰는 동안만 잡는다.
  // 요약 시트 다시 쓰기는 잠금을 푼 뒤에 한다. (여러 반이 쉬는 시간에 몰려도 덜 기다리게)
  var lock = LockService.getScriptLock(), ss, sh, fresh = false, out;
  lock.waitLock(20000);
  try {
    ss = openBook_(cls);
    var roster = readRoster_(ss), st = null;
    for (var i = 0; i < roster.length; i++) if (roster[i].no === String(no)) st = roster[i];
    if (!st) return { stale: true };
    var log = readLog_(ss);
    sh = log.sh;
    var c = log.dateCol[date];
    var r = log.rowOf['k' + st.no];
    var cur = '';
    if (r !== undefined && c !== undefined && c < log.v[r].length) cur = log.v[r][c];
    if (c === undefined) {
      c = Math.max(sh.getLastColumn(), 3);
      grow_(sh, 1, c + 1);
      sh.getRange(1, c + 1).setNumberFormat('@').setValue(date);
      fresh = true;
    }
    if (r === undefined) {
      r = Math.max(sh.getLastRow(), 1);
      grow_(sh, r + 1, 3);
      sh.getRange(r + 1, 1, 1, 3).setNumberFormat('@').setValues([[st.no, st.name, st.role]]);
      fresh = true;
    }
    var next = fn(parseCell_(cur), st);
    sh.getRange(r + 1, c + 1).setValue(next.text);
    SpreadsheetApp.flush();   // 잠금을 풀기 전에 시트에 확실히 쓴다
    out = next.out;
  } finally {
    lock.releaseLock();
  }
  if (fresh) tidySheet_(sh, SH_LOG);
  safe_(function () { writeSummary_(cls, ss, buildState_(cls, ss), false); });
  return out;
}

/** 학생이 터치했을 때. delta 는 +1(도장) 또는 -1(지우기). */
function record(code, no, delta, date) {
  var cls = getClass_(code);
  delta = delta > 0 ? 1 : -1;
  return mutate_(cls, no, date, function (cell, st) {
    // 결석인 날은 도장을 바꾸지 않는다. (결석을 풀면 원래 도장이 돌아온다)
    if (cell.absent) return { text: cellText_(cell.count, true), out: { no: st.no, done: 0, absent: true } };
    var n = clamp_(cell.count + delta, 0, st.target);
    return { text: marks_(n), out: { no: st.no, done: n } };
  });
}

/* ---------- 비밀번호가 필요한 함수 (설정) ---------- */

function auth(code, pw) {
  var cls = getClass_(code);
  checkPw_(cls, pw);
  var ss = openBook_(cls);
  return {
    name: cls.name, sound: cls.sound !== false, align: cls.align === 'low' ? 'low' : '', sheetUrl: sheetUrl_(cls.sheetId),
    lock: classInfo_(cls).lock, ue: !!cls.ue, goal: classInfo_(cls).goal, voice: !!cls.voice,
    roster: readRoster_(ss), rest: readRest_(ss), state: buildState_(cls, ss)
  };
}

function saveRoster(code, pw, list) {
  var cls = getClass_(code);
  checkPw_(cls, pw);
  var rows = [], seen = {};
  for (var i = 0; i < (list || []).length; i++) {
    var it = list[i] || {};
    var name = str_(it.name).slice(0, 12);
    if (!name) continue;
    var no = str_(it.no).slice(0, 6) || String(rows.length + 1);
    if (seen['k' + no]) throw new Error('번호가 겹쳐요: ' + no + '번');
    seen['k' + no] = true;
    rows.push([no, name, str_(it.role).slice(0, 20), str_(it.icon).slice(0, 8),
      clamp_(parseInt(it.target, 10) || 1, 1, MAX_TARGET)]);
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = openBook_(cls);
    var sh = sheet_(ss, SH_ROSTER, ROSTER_HEAD);
    var last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, ROSTER_HEAD.length).clearContent();
    if (rows.length) {
      grow_(sh, rows.length + 1, ROSTER_HEAD.length);
      sh.getRange(2, 1, rows.length, 1).setNumberFormat('@');
      sh.getRange(2, 1, rows.length, ROSTER_HEAD.length).setValues(rows);
    }
    // 기록 시트의 이름·역할을 맞추고, 아직 줄이 없는 친구는 명단 순서대로 줄을 만들어 둔다.
    var log = readLog_(ss), add = [];
    for (var j = 0; j < rows.length; j++) {
      var r = log.rowOf['k' + rows[j][0]];
      if (r === undefined) add.push([rows[j][0], rows[j][1], rows[j][2]]);
      else if (str_(log.v[r][1]) !== rows[j][1] || str_(log.v[r][2]) !== rows[j][2]) {
        log.sh.getRange(r + 1, 2, 1, 2).setValues([[rows[j][1], rows[j][2]]]);
      }
    }
    if (add.length) {
      var at = Math.max(log.sh.getLastRow(), 1);
      grow_(log.sh, at + add.length, 3);
      log.sh.getRange(at + 1, 1, add.length, 3).setNumberFormat('@').setValues(add);
    }
    tidy_(ss);
    var state = buildState_(cls, ss);
    writeSummary_(cls, ss, state, true);
    return state;
  } finally {
    lock.releaseLock();
  }
}

function setAbsent(code, pw, no, absent, date) {
  var cls = getClass_(code);
  checkPw_(cls, pw);
  var out = mutate_(cls, no, date, function (cell, st) {
    var n = Math.min(cell.count, st.target);
    return { text: cellText_(n, !!absent), out: { no: st.no, absent: !!absent, done: absent ? 0 : n } };
  });
  // 스티커판 통계(이번 달 일수 등)가 바로 맞도록 학급 전체 상태도 함께 돌려준다.
  if (out && !out.stale) out.state = buildState_(cls, openBook_(cls));
  return out;
}

function saveRest(code, pw, list) {
  var cls = getClass_(code);
  checkPw_(cls, pw);
  var rows = [];
  for (var i = 0; i < (list || []).length; i++) {
    var a = normDate_(list[i].start), b = normDate_(list[i].end) || a;
    if (!a) continue;
    if (b < a) b = a;
    rows.push([a, b, str_(list[i].name).slice(0, 20)]);
  }
  rows.sort(function (x, y) { return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0; });
  var ss = openBook_(cls);
  var sh = sheet_(ss, SH_REST, REST_HEAD);
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 3).clearContent();
  if (rows.length) {
    grow_(sh, rows.length + 1, 3);
    sh.getRange(2, 1, rows.length, 3).setNumberFormat('@').setValues(rows);
  }
  tidySheet_(sh, SH_REST);
  var state = buildState_(cls, ss);
  safe_(function () { writeSummary_(cls, ss, state, false); });
  return state;
}

/** 학급 이름, 효과음, 비밀번호, 스프레드시트 주소 변경. 바꿀 것만 넣는다. */
function updateClass(code, pw, change) {
  var cls = getClass_(code);
  checkPw_(cls, pw);
  change = change || {};
  if (change.name !== undefined) {
    var name = str_(change.name).slice(0, 20);
    if (!name) throw new Error('학급 이름을 적어 주세요.');
    cls.name = name;
  }
  if (change.sound !== undefined) cls.sound = !!change.sound;
  if (change.align !== undefined) cls.align = change.align === 'low' ? 'low' : '';
  if (change.ue !== undefined) cls.ue = !!change.ue;
  if (change.voice !== undefined) cls.voice = !!change.voice;
  if (change.lock !== undefined) {
    var lk = str_(change.lock);
    if (lk && !LOCK_RE_.test(lk)) throw new Error('수업 시간 형식이 올바르지 않아요.');
    cls.lock = lk;
  }
  if (change.goal !== undefined) {
    var gl = str_(change.goal);
    if (gl && !GOAL_RE_.test(gl)) throw new Error('목표는 1~999일, 보상은 30자까지 적어 주세요.');
    if (gl && +gl.split('|')[0] < 1) throw new Error('목표 일수는 1일 이상이어야 해요.');
    cls.goal = gl;
  }
  if (change.newPw !== undefined) {
    if (String(change.newPw).length < 4) throw new Error('비밀번호는 4자 이상으로 정해 주세요.');
    cls.pw = hash_(cls.code, String(change.newPw));
  }
  var copied = false;
  var made = !!change.newSheet;
  if (made || change.sheetUrl !== undefined) {
    // newSheet 이면 배포한 선생님의 드라이브에 새 파일을 만들어 그쪽으로 옮긴다.
    var id = made
      ? SpreadsheetApp.create('1인 1역 기록 - ' + cls.name + ' (' + today_() + ')').getId()
      : parseSheetId_(change.sheetUrl);
    if (id !== cls.sheetId) {
      var oldBook = openBook_(cls);
      var next = { sheetId: id };
      var ss = openBook_(next);
      var rs = sheet_(ss, SH_ROSTER, ROSTER_HEAD);
      sheet_(ss, SH_LOG, LOG_HEAD);
      var hs = sheet_(ss, SH_REST, REST_HEAD);
      // 새 시트에 명단이 없으면 지금 명단과 쉬는 날을 옮겨 준다.
      if (rs.getLastRow() <= 1) {
        var roster = readRoster_(oldBook), rest = readRest_(oldBook), a = [], b = [];
        for (var i = 0; i < roster.length; i++) a.push([roster[i].no, roster[i].name, roster[i].role, roster[i].icon, roster[i].target]);
        for (var j = 0; j < rest.length; j++) b.push([rest[j].start, rest[j].end, rest[j].name]);
        if (a.length) {
          rs.getRange(2, 1, a.length, 1).setNumberFormat('@');
          rs.getRange(2, 1, a.length, 5).setValues(a);
          copied = true;
        }
        if (b.length && hs.getLastRow() <= 1) hs.getRange(2, 1, b.length, 3).setNumberFormat('@').setValues(b);
      }
      cls.sheetId = id;
    }
  }
  putClass_(cls);
  if (change.name !== undefined || change.sheetUrl !== undefined || made) {
    safe_(function () {
      var book = openBook_(cls);
      tidy_(book);
      writeSummary_(cls, book, buildState_(cls, book), true);
      if (made) {
        var all = book.getSheets(), keep = [SH_SUM, SH_LOG, SH_ROSTER, SH_REST];
        for (var k = 0; k < all.length; k++) if (keep.indexOf(all[k].getName()) < 0) book.deleteSheet(all[k]);
      }
    });
  }
  var ci = classInfo_(cls);
  return { name: cls.name, sound: ci.sound, align: ci.align, lock: ci.lock, ue: ci.ue, goal: ci.goal, voice: ci.voice,
    sheetUrl: sheetUrl_(cls.sheetId), copied: copied };
}

/** 학급을 목록에서 지운다. 스프레드시트는 그대로 남는다. */
function deleteClass(code, pw) {
  var cls = getClass_(code);
  checkPw_(cls, pw);
  props_().deleteProperty('class_' + cls.code);
  return true;
}

/* ---------- 설치 점검 ---------- */

/**
 * 설치가 잘 되었는지 실제 구글 시트로 확인한다.
 * 편집기 위쪽 함수 목록에서 [설치점검]을 고르고 [실행]을 누른 뒤, 아래 실행 로그를 본다.
 * 점검용 스프레드시트 하나를 드라이브에 만들어 쓰며, 끝난 뒤 지워도 된다.
 */
function 설치점검() {
  var out = [], bad = 0;
  var check = function (name, ok, detail) {
    if (!ok) bad++;
    out.push((ok ? '✅ ' : '❌ ') + name + (ok || !detail ? '' : '  →  ' + detail));
  };
  var CODE = 'selftest', PW = 'selftest-pw';
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // 1. 점검용 스프레드시트 준비 (있으면 다시 쓴다)
    var id = props_().getProperty('selftest_id'), ss = null;
    if (id) { try { ss = SpreadsheetApp.openById(id); } catch (err) { ss = null; } }
    if (!ss) {
      ss = SpreadsheetApp.create('1인 1역 설치 점검용 (지워도 됩니다)');
      props_().setProperty('selftest_id', ss.getId());
    }
    var tmp = ss.getSheetByName('임시') || ss.insertSheet('임시', 0);
    var old = ss.getSheets();
    for (var i = 0; i < old.length; i++) if (old[i].getName() !== '임시') ss.deleteSheet(old[i]);
    check('스프레드시트 만들기', true);

    var cls = { code: CODE, name: '설치 점검반', sheetId: ss.getId(), sound: true };
    cls.pw = hash_(CODE, PW);
    putClass_(cls);
    var today = today_();

    // 2. 명단 저장
    var st = saveRoster(CODE, PW, [
      { no: '1', name: '가람', role: '칠판 지우기', icon: '', target: 3 },
      { no: '2', name: '나래', role: '칠판 지우기', icon: '', target: 3 },
      { no: '3', name: '다온', role: '우유 나르기', icon: '', target: 1 }
    ]);
    check('명단 저장', st.students.length === 3, '학생 수 ' + st.students.length);
    ss.deleteSheet(tmp);
    var names = [], all = ss.getSheets();
    for (var k = 0; k < all.length; k++) names.push(all[k].getName());
    check('시트 구성 (요약이 맨 앞)', names[0] === SH_SUM && names.length === 4, names.join(', '));

    // 3. 도장 찍기와 지우기
    var r1 = record(CODE, '3', 1, today);
    check('도장 찍기', r1.done === 1, JSON.stringify(r1));
    record(CODE, '1', 1, today);
    var r2 = record(CODE, '1', 1, today);
    check('하루 여러 번 하는 역할', r2.done === 2, JSON.stringify(r2));
    var r3 = record(CODE, '1', -1, today);
    check('도장 지우기', r3.done === 1, JSON.stringify(r3));
    for (var n = 0; n < 5; n++) record(CODE, '2', 1, today);
    var log = readLog_(ss), col = log.dateCol[today];
    var cellOf = function (no) { var row = log.rowOf['k' + no]; return row === undefined || col === undefined ? '(없음)' : String(log.v[row][col]); };
    check('기록 시트에 ○ 저장', cellOf('3') === MARK && cellOf('1') === MARK && cellOf('2') === MARK + MARK + MARK,
      [cellOf('1'), cellOf('2'), cellOf('3')].join(' | '));
    check('어제 날짜로는 저장 안 됨', record(CODE, '3', 1, addDays_(today, -1)).stale === true);

    // 4. 결석
    var ab = setAbsent(CODE, PW, '3', true, today);
    check('결석 표시', ab.absent === true && getState(CODE).students[2].absent === true);
    var un = setAbsent(CODE, PW, '3', false, today);
    check('결석 해제 뒤 도장 복원', un.done === 1 && getState(CODE).students[2].done === 1, JSON.stringify({ done: un.done }));

    // 5. 쉬는 날
    var far = addDays_(today, 400);
    saveRest(CODE, PW, [{ start: far, end: addDays_(far, 2), name: '점검용 방학' }]);
    var rest = readRest_(ss);
    check('쉬는 날 저장', rest.length === 1 && rest[0].start === far && rest[0].name === '점검용 방학', JSON.stringify(rest));

    // 6. 화면에 보낼 상태와 요약 시트
    var now = getState(CODE), a = now.students;
    check('화면 상태', a[0].done === 1 && a[1].done === 3 && a[2].done === 1 && !a[2].absent,
      a[0].done + ', ' + a[1].done + ', ' + a[2].done);
    var sum = ss.getSheetByName(SH_SUM).getDataRange().getValues();
    check('요약 시트 제목', String(sum[0][0]).indexOf('설치 점검반') === 0, String(sum[0][0]));
    check('요약 시트 현황', String(sum[4][0]) === '3명' && String(sum[4][2]) === '2 / 3명', sum[4][0] + ' | ' + sum[4][2]);
    check('요약 시트 학생 표', String(sum[SUM_TOP][1]) === '가람' && String(sum[SUM_TOP][4]) === '1 / 3' && String(sum[SUM_TOP + 1][4]) === '완료',
      sum[SUM_TOP][1] + ' | ' + sum[SUM_TOP][4] + ' | ' + sum[SUM_TOP + 1][4]);

    // 7. 날짜 열이 시트 너비(26칸)를 넘어가도 저장되는지
    var sh = log.sh, past = [];
    for (var d = 40; d >= 1; d--) past.push(addDays_(today, -d - 400));
    grow_(sh, 1, 4 + past.length);
    var lastCol = sh.getLastColumn();
    sh.getRange(1, lastCol + 1, 1, past.length).setNumberFormat('@').setValues([past]);
    sh.getRange(1, col + 1).setValue('');   // 오늘 열의 머리글을 지워 새 열이 맨 끝에 생기게 한다
    var wide = record(CODE, '1', 1, today), end = sh.getLastColumn();
    check('날짜가 많아져도 저장', wide.done === 1 && end === lastCol + past.length + 1, '마지막 열 ' + end);

    // 8. 비밀번호
    var denied = false;
    try { auth(CODE, 'wrong'); } catch (err2) { denied = true; }
    check('틀린 비밀번호 거절', denied);
    check('맞는 비밀번호 통과', auth(CODE, PW).roster.length === 3);

    // 9. 운영 설정 (수업 시간 잠금, 지우기 권한, 학급 목표, 칭찬 음성)
    updateClass(CODE, PW, { lock: '1|0000-0001,2358-2359', ue: true, voice: true, goal: '3|' + addDays_(today, -1).replace(/-/g, '') + '|점검 보상' });
    var os = getState(CODE);
    check('운영 설정 저장', os.lock === '1|0000-0001,2358-2359' && os.ue === true && os.voice === true && os.goal.indexOf('3|') === 0 && os.goalPast === 0,
      JSON.stringify({ lock: os.lock, ue: os.ue, voice: os.voice, goal: os.goal, goalPast: os.goalPast }));
    var badLock = false;
    try { updateClass(CODE, PW, { lock: '1|9시-10시' }); } catch (e4) { badLock = true; }
    check('잘못된 시간표 거절', badLock);

    // 10. 시트 꾸미기 (실패해도 기록에는 지장 없음)
    STRICT_ = true;
    try {
      tidy_(ss);
      writeSummary_(cls, ss, buildState_(cls, ss), true);
      check('시트 꾸미기', true);
    } catch (err3) {
      out.push('⚠️ 시트 꾸미기 일부 실패 (기록에는 지장 없음)  →  ' + err3.message);
    }
    STRICT_ = false;
  } catch (err) {
    check('점검 도중 오류', false, err.message);
  } finally {
    STRICT_ = false;
    props_().deleteProperty('class_' + CODE);
    lock.releaseLock();
  }
  out.push('');
  out.push(bad ? '❌ ' + bad + '개 항목에 문제가 있어요. 위 내용을 그대로 복사해 문의해 주세요.'
    : '🎉 모든 점검을 통과했어요. 이제 [배포]를 하시면 됩니다.');
  out.push('(드라이브에 생긴 "1인 1역 설치 점검용" 파일은 지워도 됩니다.)');
  var text = out.join('\n');
  Logger.log('\n' + text);
  return text;
}
