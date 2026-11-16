/*
 * 웹 버전 연결부.
 *
 * Code.gs 는 원래 구글 Apps Script 서버에서 돌지만, 웹 버전에서는 같은 코드를 브라우저에서 그대로 돌린다.
 * 이 파일이 Apps Script 가 주던 것(SpreadsheetApp, PropertiesService 등)을 흉내 내고,
 * 실제 읽기·쓰기는 로그인한 사용자의 권한으로 Google Sheets API / Drive API 에 보낸다.
 *
 *   읽기 : 스프레드시트 전체를 메모리로 가져온다 (요청 2번)
 *   실행 : Code.gs 함수가 메모리 위에서 한 번에 돈다
 *   쓰기 : 바뀐 칸과 꾸밈을 모아 API 로 보낸다
 *
 * 학급 목록은 서버가 없으므로 드라이브 파일의 appProperties 에 적어 둔다.
 * 권한은 drive.file (이 앱이 만든 파일만) 과 이메일 주소뿐이다.
 */
(function (g) {
  'use strict';

  var CFG = g.ONE_ROLE_CONFIG || {};
  var SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';
  var SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
  var DRIVE = 'https://www.googleapis.com/drive/v3/files';
  var FRESH_MS = 45 * 1000;        // 이 시간 안에는 시트를 다시 읽지 않는다
  var MAX_AGE_MS = 5 * 60 * 1000;  // 계속 쓰고 있어도 이 시간이 지나면 다시 읽는다
  var NAMES = ['listClasses', 'createClass', 'getState', 'record', 'auth', 'saveRoster', 'setAbsent', 'saveRest', 'updateClass', 'deleteClass'];

  function ls(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) { /* 저장소를 못 쓰는 브라우저 */ }
    return null;
  }

  /* ================= 로그인 ================= */

  var tok = null, tokExp = 0, client = null, requesting = false, reqTimer = 0, waiters = [];
  var email = ls('or_email') || '';

  function tokenOk(marginMs) { return !!tok && Date.now() < tokExp - (marginMs || 30000); }

  function gis() {
    if (client) return true;
    if (!(g.google && g.google.accounts && g.google.accounts.oauth2)) return false;
    client = g.google.accounts.oauth2.initTokenClient({
      client_id: CFG.clientId, scope: SCOPE,
      callback: function (r) {
        if (r && r.access_token) gotToken(r); else failToken((r && r.error) || 'denied');
      },
      error_callback: function (e) { failToken((e && e.type) || 'error'); }
    });
    return true;
  }

  var askConsent = false;   // 참이면 다음 로그인 때 권한 화면을 다시 보여 준다
  var NEED_BOX = '권한 화면에서 <b>"이 앱에서 사용하는 Google Drive 파일만 보기, 수정, 생성, 삭제"</b> 네모 칸에 체크해야 기록을 저장할 수 있어요. 다시 로그인해서 체크해 주세요.';

  function gotToken(r) {
    requesting = false; clearTimeout(reqTimer);
    // 구글 권한 화면은 항목마다 체크하는 방식이라, 드라이브 칸을 빼고 허용하면 저장할 수 없는 로그인이 된다.
    if (String(r.scope || '').indexOf('auth/drive.file') < 0) {
      tok = null; tokExp = 0; askConsent = true;
      showLogin(NEED_BOX);
      return;
    }
    askConsent = false;
    tok = r.access_token;
    tokExp = Date.now() + (parseInt(r.expires_in, 10) || 3600) * 1000;
    hideLogin();
    var w = waiters; waiters = [];
    for (var i = 0; i < w.length; i++) w[i](tok);
    if (!email) {
      fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + tok } })
        .then(function (res) { return res.ok ? res.json() : {}; })
        .then(function (j) { if (j && j.email) { email = j.email; ls('or_email', email); } })
        .catch(function () {});
    }
  }

  function failToken(why) {
    requesting = false; clearTimeout(reqTimer);
    showLogin(why === 'popup_failed_to_open' ? '로그인 창이 막혔어요. 아래 버튼을 눌러 주세요.' :
      why === 'access_denied' ? '권한을 허용해야 기록을 저장할 수 있어요.' : '');
  }

  /** 로그인 창을 연다. 브라우저가 창을 막지 않도록 반드시 누르는 동작 안에서 불러야 한다. */
  function requestToken(pick) {
    if (requesting) return;
    if (!gis()) { showLogin('구글 로그인 준비 중이에요. 잠시 후 다시 눌러 주세요.'); return; }
    requesting = true;
    clearTimeout(reqTimer);
    reqTimer = setTimeout(function () { if (requesting) failToken('timeout'); }, 90000);
    var opt = { prompt: pick ? 'select_account' : askConsent ? 'consent' : '' };
    if (email && !pick) opt.login_hint = email;
    try { client.requestAccessToken(opt); } catch (e) { failToken('error'); }
  }

  function getToken() {
    if (tokenOk()) return Promise.resolve(tok);
    return new Promise(function (resolve) {
      waiters.push(resolve);
      if (!requesting) showLogin('');
    });
  }

  // 화면을 누를 때마다 확인해서, 로그인이 곧 끝나거나 끝났으면 그 누름을 이용해 조용히 갱신한다.
  document.addEventListener('click', function (ev) {
    if (!CFG.clientId || !email || requesting) return;
    if (ev.target && ev.target.closest && ev.target.closest('#or-login')) return;
    if (!tokenOk(8 * 60 * 1000)) requestToken(false);
  }, true);

  function showLogin(msg) {
    var d = document.getElementById('or-login');
    if (!d) {
      d = document.createElement('div'); d.id = 'or-login';
      d.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:200;display:flex;align-items:center;justify-content:center;' +
        'background:rgba(43,42,40,.55);padding:16px;font-family:Jua,sans-serif';
      document.body.appendChild(d);
    }
    var box = 'background:#fffdf6;border:3px solid #2b2a28;border-radius:14px 22px 16px 24px / 22px 14px 24px 16px;padding:26px;max-width:460px;' +
      'text-align:center;box-shadow:6px 8px 0 rgba(43,42,40,.3)';
    if (!CFG.clientId) {
      d.innerHTML = '<div style="' + box + '"><div style="font-size:26px;margin-bottom:10px">아직 준비가 덜 됐어요</div>' +
        '<div style="font-size:17px;line-height:1.5">config.js 에 구글 로그인용 클라이언트 ID가 없습니다.<br>설정 안내서를 따라 넣어 주세요.</div></div>';
      return;
    }
    d.innerHTML = '<div style="' + box + '"><div style="font-size:28px;margin-bottom:8px">' + (email ? '다시 로그인해 주세요' : '구글 로그인이 필요해요') + '</div>' +
      '<div style="font-size:17px;line-height:1.5;margin-bottom:16px">' + (msg || (email ? esc(email) + ' 계정으로 이어서 씁니다.' : '기록은 로그인한 계정의 구글 드라이브에 저장돼요.')) + '</div>' +
      '<button id="or-go" style="font:inherit;font-size:22px;padding:12px 26px;background:#f7cf3d;border:2.5px solid #2b2a28;border-radius:14px;cursor:pointer;box-shadow:3px 4px 0 rgba(43,42,40,.22)">구글로 로그인</button>' +
      (email ? '<div style="margin-top:14px"><button id="or-other" style="font:inherit;font-size:16px;background:none;border:0;text-decoration:underline;cursor:pointer">다른 계정으로 로그인</button></div>' : '') +
      '</div>';
    document.getElementById('or-go').onclick = function () { requestToken(false); };
    var o = document.getElementById('or-other');
    if (o) o.onclick = function () { email = ''; ls('or_email', null); requestToken(true); };
  }
  function hideLogin() { var d = document.getElementById('or-login'); if (d) d.parentNode.removeChild(d); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  g.ONE_ROLE = {
    email: function () { return email; },
    logout: function () {
      try { if (tok && g.google && g.google.accounts) g.google.accounts.oauth2.revoke(tok, function () {}); } catch (e) { /* 무시 */ }
      tok = null; tokExp = 0; email = ''; ls('or_email', null);
      books = {}; classes = {}; listAt = 0;
    },
    // 자동 검사에서만 쓴다.
    _test: { expire: function () { tokExp = 0; }, stale: function () { stale(); } }
  };

  /* ================= 구글 API 호출 ================= */

  function http(method, url, body) {
    return getToken().then(function (t) {
      return fetch(url, {
        method: method,
        headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    }).then(function (res) {
      if (res.ok) return res.status === 204 ? {} : res.json();
      return res.json().catch(function () { return {}; }).then(function (j) {
        var raw = (j && j.error && j.error.message) || ('HTTP ' + res.status);
        if (res.status === 401) { tok = null; tokExp = 0; }
        if (res.status === 403 && /insufficient authentication scopes/i.test(raw)) {
          tok = null; tokExp = 0; askConsent = true;
          var e2 = new Error('구글 드라이브 권한이 빠져 있어요. 다시 로그인하면서 드라이브 칸에 체크해 주세요.'); e2.status = 403;
          setTimeout(function () { showLogin(NEED_BOX); }, 0);
          throw e2;
        }
        var msg = res.status === 401 ? '로그인이 끝났어요. 화면을 한 번 더 눌러 주세요.' :
          res.status === 429 ? '요청이 잠깐 몰렸어요. 곧 다시 저장합니다.' :
          res.status === 404 ? '스프레드시트를 찾을 수 없어요. 드라이브에서 지워졌을 수 있어요.' :
          res.status === 403 ? '구글이 요청을 거절했어요: ' + raw : '구글 오류: ' + raw;
        var e = new Error(msg); e.status = res.status; throw e;
      });
    });
  }

  /* ================= 메모리 위의 스프레드시트 ================= */

  var books = {};      // id -> Book
  var P = null;        // 지금 실행 중인 함수가 남긴 쓰기 목록
  var premade = {};    // 제목 -> 미리 만들어 둔 새 스프레드시트 (한 번의 실행이 끝날 때까지 유지)

  function color(hex) {
    var n = parseInt(String(hex).replace('#', ''), 16);
    return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
  }
  function colName(c) { var s = ''; while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; } return s; }
  function quote(name) { return "'" + String(name).replace(/'/g, "''") + "'"; }
  function ops(book) {
    if (!P) throw new Error('쓰기 준비가 안 됐어요.');
    if (!P[book.id]) { P[book.id] = { book: book, struct: [], values: [], fmt: [] }; P.order.push(book.id); }
    return P[book.id];
  }

  function Range(sh, r, c, h, w) { this.sh = sh; this.r = r; this.c = c; this.h = h || 1; this.w = w || 1; }
  Range.prototype.grid = function () {
    return { sheetId: this.sh.sheetId, startRowIndex: this.r - 1, endRowIndex: this.r - 1 + this.h, startColumnIndex: this.c - 1, endColumnIndex: this.c - 1 + this.w };
  };
  Range.prototype.a1 = function () {
    return quote(this.sh.name) + '!' + colName(this.c) + this.r + ':' + colName(this.c + this.w - 1) + (this.r + this.h - 1);
  };
  Range.prototype.getValues = function () {
    var out = [];
    for (var i = 0; i < this.h; i++) {
      var row = [], src = this.sh.d[this.r - 1 + i] || [];
      for (var j = 0; j < this.w; j++) { var v = src[this.c - 1 + j]; row.push(v === undefined || v === null ? '' : v); }
      out.push(row);
    }
    return out;
  };
  Range.prototype.getValue = function () { return this.getValues()[0][0]; };
  Range.prototype.setValues = function (v) {
    if (v.length !== this.h || v[0].length !== this.w) throw new Error('값의 크기가 범위와 달라요.');
    if (this.r + this.h - 1 > this.sh.maxR || this.c + this.w - 1 > this.sh.maxC) throw new Error('범위가 시트 크기를 벗어났어요.');
    var copy = [];
    for (var i = 0; i < this.h; i++) {
      var y = this.r - 1 + i, line = [];
      while (this.sh.d.length <= y) this.sh.d.push([]);
      for (var j = 0; j < this.w; j++) {
        var x = v[i][j]; if (x === undefined || x === null) x = '';
        this.sh.d[y][this.c - 1 + j] = x; line.push(x);
      }
      copy.push(line);
    }
    ops(this.sh.book).values.push({ range: this.a1(), values: copy });
    return this;
  };
  Range.prototype.setValue = function (v) {
    var a = [];
    for (var i = 0; i < this.h; i++) { var row = []; for (var j = 0; j < this.w; j++) row.push(v); a.push(row); }
    return this.setValues(a);
  };
  Range.prototype.clearContent = function () { return this.setValue(''); };
  Range.prototype.clear = function () {
    for (var i = 0; i < this.h; i++) {
      var row = this.sh.d[this.r - 1 + i]; if (!row) continue;
      for (var j = 0; j < this.w; j++) if (this.c - 1 + j < row.length) row[this.c - 1 + j] = '';
    }
    ops(this.sh.book).fmt.push({ updateCells: { range: this.grid(), fields: 'userEnteredValue,userEnteredFormat' } });
    return this;
  };
  Range.prototype.fmt = function (format, fields) {
    ops(this.sh.book).fmt.push({ repeatCell: { range: this.grid(), cell: { userEnteredFormat: format }, fields: fields } });
    return this;
  };
  Range.prototype.setBackground = function (c) { return this.fmt({ backgroundColor: color(c) }, 'userEnteredFormat.backgroundColor'); };
  Range.prototype.setFontColor = function (c) { return this.fmt({ textFormat: { foregroundColor: color(c) } }, 'userEnteredFormat.textFormat.foregroundColor'); };
  Range.prototype.setFontWeight = function (w) { return this.fmt({ textFormat: { bold: w === 'bold' } }, 'userEnteredFormat.textFormat.bold'); };
  Range.prototype.setFontSize = function (n) { return this.fmt({ textFormat: { fontSize: n } }, 'userEnteredFormat.textFormat.fontSize'); };
  Range.prototype.setHorizontalAlignment = function (a) { return this.fmt({ horizontalAlignment: String(a).toUpperCase() }, 'userEnteredFormat.horizontalAlignment'); };
  Range.prototype.setVerticalAlignment = function (a) { return this.fmt({ verticalAlignment: String(a).toUpperCase() }, 'userEnteredFormat.verticalAlignment'); };
  Range.prototype.setNumberFormat = function (f) {
    return this.fmt({ numberFormat: f === '@' ? { type: 'TEXT' } : { type: 'PERCENT', pattern: f } }, 'userEnteredFormat.numberFormat');
  };
  Range.prototype.setBackgrounds = function (rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var vals = [];
      for (var j = 0; j < rows[i].length; j++) vals.push({ userEnteredFormat: { backgroundColor: color(rows[i][j]) } });
      out.push({ values: vals });
    }
    ops(this.sh.book).fmt.push({ updateCells: { range: this.grid(), rows: out, fields: 'userEnteredFormat.backgroundColor' } });
    return this;
  };
  Range.prototype.setBorder = function (top, left, bottom, right, vertical, horizontal, col) {
    var b = { style: 'SOLID', color: color(col || '#000000') }, req = { range: this.grid() };
    if (top) req.top = b; if (left) req.left = b; if (bottom) req.bottom = b; if (right) req.right = b;
    if (vertical) req.innerVertical = b; if (horizontal) req.innerHorizontal = b;
    ops(this.sh.book).fmt.push({ updateBorders: req });
    return this;
  };
  Range.prototype.merge = function () {
    var o = ops(this.sh.book);
    o.fmt.push({ unmergeCells: { range: this.grid() } });
    o.fmt.push({ mergeCells: { range: this.grid(), mergeType: 'MERGE_ALL' } });
    return this;
  };

  function Sheet(book, p, cfCount) {
    this.book = book; this.name = p.title; this.sheetId = p.sheetId; this.d = [];
    this.maxR = (p.gridProperties && p.gridProperties.rowCount) || 1000;
    this.maxC = (p.gridProperties && p.gridProperties.columnCount) || 26;
    this.cf = cfCount || 0;
  }
  Sheet.prototype.getName = function () { return this.name; };
  Sheet.prototype.getMaxRows = function () { return this.maxR; };
  Sheet.prototype.getMaxColumns = function () { return this.maxC; };
  Sheet.prototype.getLastRow = function () {
    for (var i = this.d.length - 1; i >= 0; i--) { var row = this.d[i] || []; for (var j = 0; j < row.length; j++) if (row[j] !== '' && row[j] !== undefined && row[j] !== null) return i + 1; }
    return 0;
  };
  Sheet.prototype.getLastColumn = function () {
    var m = 0;
    for (var i = 0; i < this.d.length; i++) { var row = this.d[i] || []; for (var j = row.length - 1; j >= m; j--) if (row[j] !== '' && row[j] !== undefined && row[j] !== null) { m = j + 1; break; } }
    return m;
  };
  Sheet.prototype.getRange = function (r, c, h, w) { return new Range(this, r, c, h, w); };
  Sheet.prototype.getDataRange = function () { return new Range(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); };
  Sheet.prototype.insertColumnsAfter = function (after, n) {
    this.maxC += n; ops(this.book).struct.push({ appendDimension: { sheetId: this.sheetId, dimension: 'COLUMNS', length: n } });
  };
  Sheet.prototype.insertRowsAfter = function (after, n) {
    this.maxR += n; ops(this.book).struct.push({ appendDimension: { sheetId: this.sheetId, dimension: 'ROWS', length: n } });
  };
  Sheet.prototype.prop = function (props, fields) {
    props.sheetId = this.sheetId;
    ops(this.book).fmt.push({ updateSheetProperties: { properties: props, fields: fields } });
  };
  Sheet.prototype.setFrozenRows = function (n) { this.prop({ gridProperties: { frozenRowCount: n } }, 'gridProperties.frozenRowCount'); };
  Sheet.prototype.setFrozenColumns = function (n) { this.prop({ gridProperties: { frozenColumnCount: n } }, 'gridProperties.frozenColumnCount'); };
  Sheet.prototype.setHiddenGridlines = function (b) { this.prop({ gridProperties: { hideGridlines: !!b } }, 'gridProperties.hideGridlines'); };
  Sheet.prototype.setTabColor = function (c) { this.prop({ tabColor: color(c) }, 'tabColor'); };
  Sheet.prototype.dim = function (dimension, start, count, px) {
    ops(this.book).fmt.push({ updateDimensionProperties: {
      range: { sheetId: this.sheetId, dimension: dimension, startIndex: start - 1, endIndex: start - 1 + count },
      properties: { pixelSize: px }, fields: 'pixelSize' } });
  };
  Sheet.prototype.setRowHeight = function (r, px) { this.dim('ROWS', r, 1, px); };
  Sheet.prototype.setColumnWidth = function (c, px) { this.dim('COLUMNS', c, 1, px); };
  Sheet.prototype.setColumnWidths = function (c, n, px) { this.dim('COLUMNS', c, n, px); };
  Sheet.prototype.setConditionalFormatRules = function (rules) {
    var o = ops(this.book).fmt, i;
    for (i = 0; i < this.cf; i++) o.push({ deleteConditionalFormatRule: { sheetId: this.sheetId, index: 0 } });
    for (i = 0; i < rules.length; i++) o.push({ addConditionalFormatRule: { rule: rules[i], index: i } });
    this.cf = rules.length;
  };

  function Book(id) { this.id = id; this.sheets = []; this.readAt = 0; this.freshAt = 0; }
  Book.prototype.getId = function () { return this.id; };
  Book.prototype.getSpreadsheetTimeZone = function () { return 'Asia/Seoul'; };
  Book.prototype.getSheets = function () { return this.sheets.slice(); };
  Book.prototype.getSheetByName = function (n) {
    for (var i = 0; i < this.sheets.length; i++) if (this.sheets[i].name === n) return this.sheets[i];
    return null;
  };
  Book.prototype.insertSheet = function (name, index) {
    var id = Math.floor(Math.random() * 2000000000) + 1;
    if (index === undefined || index > this.sheets.length) index = this.sheets.length;
    var p = { sheetId: id, title: name, index: index, gridProperties: { rowCount: 1000, columnCount: 26 } };
    var sh = new Sheet(this, p, 0);
    this.sheets.splice(index, 0, sh);
    ops(this).struct.push({ addSheet: { properties: p } });
    return sh;
  };
  Book.prototype.deleteSheet = function (sh) {
    var i = this.sheets.indexOf(sh);
    if (i >= 0) this.sheets.splice(i, 1);
    ops(this).struct.push({ deleteSheet: { sheetId: sh.sheetId } });
  };

  function need(type, arg) { var e = new Error('need:' + type); e.need = type; e.arg = arg; return e; }

  function ruleBuilder() {
    var rule = { ranges: [], booleanRule: { condition: { type: 'TEXT_EQ', values: [] }, format: {} } }, f = rule.booleanRule.format;
    var b = {
      whenTextEqualTo: function (t) { rule.booleanRule.condition = { type: 'TEXT_EQ', values: [{ userEnteredValue: t }] }; return b; },
      whenTextContains: function (t) { rule.booleanRule.condition = { type: 'TEXT_CONTAINS', values: [{ userEnteredValue: t }] }; return b; },
      setBackground: function (c) { f.backgroundColor = color(c); return b; },
      setFontColor: function (c) { f.textFormat = f.textFormat || {}; f.textFormat.foregroundColor = color(c); return b; },
      setBold: function (v) { f.textFormat = f.textFormat || {}; f.textFormat.bold = !!v; return b; },
      setRanges: function (rs) { rule.ranges = []; for (var i = 0; i < rs.length; i++) rule.ranges.push(rs[i].grid()); return b; },
      build: function () { return rule; }
    };
    return b;
  }

  g.SpreadsheetApp = {
    BorderStyle: { SOLID: 'SOLID' },
    newConditionalFormatRule: ruleBuilder,
    openById: function (id) {
      var b = books[id], now = Date.now();
      if (!b || now - b.freshAt > FRESH_MS || now - b.readAt > MAX_AGE_MS) throw need('load', id);
      return b;
    },
    create: function (title) {
      if (premade[title]) return premade[title];
      throw need('create', title);
    }
  };

  function loadBook(id) {
    var meta;
    return http('GET', SHEETS + '/' + id + '?fields=' + encodeURIComponent('sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)),conditionalFormats)'))
      .then(function (m) {
        meta = m.sheets || [];
        var q = '';
        for (var i = 0; i < meta.length; i++) q += '&ranges=' + encodeURIComponent(quote(meta[i].properties.title));
        return http('GET', SHEETS + '/' + id + '/values:batchGet?valueRenderOption=FORMATTED_VALUE' + q);
      }).then(function (v) {
        var b = new Book(id), vr = v.valueRanges || [];
        for (var i = 0; i < meta.length; i++) {
          var sh = new Sheet(b, meta[i].properties, (meta[i].conditionalFormats || []).length);
          sh.d = (vr[i] && vr[i].values) || [];
          b.sheets.push(sh);
        }
        b.readAt = b.freshAt = Date.now();
        books[id] = b;
      });
  }

  function createBook(title) {
    return http('POST', SHEETS, { properties: { title: title, locale: 'ko_KR', timeZone: 'Asia/Seoul' } }).then(function (r) {
      var b = new Book(r.spreadsheetId), list = r.sheets || [];
      for (var i = 0; i < list.length; i++) b.sheets.push(new Sheet(b, list[i].properties, 0));
      b.readAt = b.freshAt = Date.now();
      books[b.id] = b;
      premade[title] = b;
    });
  }

  /* ================= 학급 목록 (드라이브 파일 속성) ================= */

  var classes = {}, listAt = 0, misc = {};

  function loadList() {
    var q = "appProperties has { key='oneRole' and value='1' } and trashed=false";
    return http('GET', DRIVE + '?pageSize=200&fields=' + encodeURIComponent('files(id,appProperties)') + '&q=' + encodeURIComponent(q)).then(function (r) {
      classes = {};
      var f = r.files || [];
      for (var i = 0; i < f.length; i++) {
        var a = f[i].appProperties || {};
        if (!a.code || classes[a.code]) continue;
        classes[a.code] = { name: a.name || '이름 없는 학급', sheetId: f[i].id, pw: a.pw || '', sound: a.sound !== '0' };
      }
      listAt = Date.now();
    });
  }

  g.PropertiesService = { getScriptProperties: function () {
    return {
      getProperty: function (k) {
        if (k.indexOf('class_') !== 0) return k in misc ? misc[k] : null;
        var c = classes[k.slice(6)];
        if (!c && Date.now() - listAt > 15000) throw need('list');
        return c ? JSON.stringify(c) : null;
      },
      getProperties: function () {
        var out = {};
        for (var code in classes) out['class_' + code] = JSON.stringify(classes[code]);
        return out;
      },
      setProperty: function (k, v) {
        if (k.indexOf('class_') !== 0) { misc[k] = String(v); return; }
        var code = k.slice(6), c = JSON.parse(v), prev = classes[code];
        classes[code] = c;
        P.drive.push({ id: c.sheetId, props: { oneRole: '1', code: code, name: c.name, pw: c.pw, sound: c.sound === false ? '0' : '1' } });
        if (prev && prev.sheetId !== c.sheetId) P.drive.push({ id: prev.sheetId, props: { oneRole: null, code: null } });
      },
      deleteProperty: function (k) {
        if (k.indexOf('class_') !== 0) { delete misc[k]; return; }
        var prev = classes[k.slice(6)];
        if (prev) P.drive.push({ id: prev.sheetId, props: { oneRole: null, code: null } });
        delete classes[k.slice(6)];
      }
    };
  } };

  /* ================= 그 밖에 Apps Script 가 주던 것 ================= */

  function sha256(bytes) {
    var K = [], H = [], i, j, n = 2, k = 0;
    function frac(x) { return ((x - Math.floor(x)) * 4294967296) | 0; }
    while (k < 64) {
      var prime = true;
      for (i = 2; i * i <= n; i++) if (n % i === 0) { prime = false; break; }
      if (prime) { if (k < 8) H[k] = frac(Math.pow(n, 1 / 2)); K[k++] = frac(Math.pow(n, 1 / 3)); }
      n++;
    }
    var len = bytes.length, msg = bytes.slice();
    msg.push(128);
    while (msg.length % 64 !== 56) msg.push(0);
    var bits = len * 8;
    msg.push(0, 0, 0, Math.floor(bits / 4294967296) & 255, (bits >>> 24) & 255, (bits >>> 16) & 255, (bits >>> 8) & 255, bits & 255);
    var w = [];
    function rr(x, s) { return (x >>> s) | (x << (32 - s)); }
    for (var off = 0; off < msg.length; off += 64) {
      for (i = 0; i < 16; i++) w[i] = (msg[off + i * 4] << 24) | (msg[off + i * 4 + 1] << 16) | (msg[off + i * 4 + 2] << 8) | msg[off + i * 4 + 3];
      for (i = 16; i < 64; i++) {
        var s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], gg = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var t1 = (h + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & gg)) + K[i] + w[i]) | 0;
        var t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = gg; gg = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + gg) | 0; H[7] = (H[7] + h) | 0;
    }
    var out = [];
    for (i = 0; i < 8; i++) for (j = 3; j >= 0; j--) { var v = (H[i] >>> (j * 8)) & 255; out.push(v > 127 ? v - 256 : v); }
    return out;
  }
  g.__sha256 = sha256;

  g.Utilities = {
    DigestAlgorithm: { SHA_256: 1 }, Charset: { UTF_8: 1 },
    sleep: function () {},
    computeDigest: function (alg, text) {
      var s = unescape(encodeURIComponent(String(text))), bytes = [];
      for (var i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i));
      return sha256(bytes);
    },
    // 한국 시간(UTC+9, 서머타임 없음) 기준
    formatDate: function (d, tz, fmt) {
      var iso = new Date((g.__NOW ? g.__NOW() : d.getTime()) + 9 * 3600000).toISOString();
      return /HH/.test(fmt) ? iso.slice(0, 10) + ' ' + iso.slice(11, 16) : iso.slice(0, 10);
    }
  };
  g.LockService = { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } };
  g.Logger = { log: function () {} };

  /* ================= 실행과 저장 ================= */

  function seq(list, fn) {
    var p = Promise.resolve();
    list.forEach(function (x) { p = p.then(function () { return fn(x); }); });
    return p;
  }

  function flush(ctx) {
    return seq(ctx.order, function (id) {
      var o = ctx[id], base = SHEETS + '/' + id, p = Promise.resolve();
      if (o.struct.length) p = p.then(function () { return http('POST', base + ':batchUpdate', { requests: o.struct }); });
      if (o.values.length) p = p.then(function () { return http('POST', base + '/values:batchUpdate', { valueInputOption: 'RAW', data: o.values }); });
      if (o.fmt.length) p = p.then(function () {
        // 꾸밈은 실패해도 기록에는 지장이 없다. 다음에 다시 읽도록만 해 둔다.
        return http('POST', base + ':batchUpdate', { requests: o.fmt }).catch(function (e) {
          if (g.console) console.warn('시트 꾸미기 실패:', e.message);
          g.__fmtError = e.message; o.book.freshAt = 0;
        });
      });
      return p.then(function () { if (o.book.freshAt) o.book.freshAt = Date.now(); });
    }).then(function () {
      return seq(ctx.drive, function (d) { return http('PATCH', DRIVE + '/' + d.id, { appProperties: d.props }); });
    });
  }

  function stale() { for (var id in books) books[id].freshAt = 0; }

  function exec(name, args, tries) {
    var pre = name === 'listClasses' ? loadList() : Promise.resolve();
    return pre.then(function () {
      var res;
      P = { order: [], drive: [] };
      try {
        res = g[name].apply(null, JSON.parse(JSON.stringify(args)));
      } catch (e) {
        P = null;
        if (e && e.need && tries < 8) {
          var fix = e.need === 'load' ? loadBook(e.arg) : e.need === 'create' ? createBook(e.arg) : loadList();
          return fix.then(function () { return exec(name, args, tries + 1); });
        }
        stale(); premade = {};
        throw e;
      }
      var ctx = P; P = null; premade = {};
      return flush(ctx).then(function () {
        return res === undefined ? undefined : JSON.parse(JSON.stringify(res));
      }, function (e) { stale(); throw e; });
    });
  }

  var chain = Promise.resolve();
  function run(name, args) {
    var p = chain.then(function () { return exec(name, args, 0); });
    chain = p.then(function () {}, function () {});
    return p;
  }

  function runner(ok, fail) {
    var o = {
      withSuccessHandler: function (f) { return runner(f, fail); },
      withFailureHandler: function (f) { return runner(ok, f); }
    };
    NAMES.forEach(function (n) {
      o[n] = function () {
        run(n, [].slice.call(arguments)).then(function (v) { if (ok) ok(v); }, function (e) { if (fail) fail(e); });
      };
    });
    return o;
  }
  g.__RUN = function () { return runner(null, null); };

  if (!CFG.clientId) g.addEventListener('load', function () { showLogin(''); });
})(window);
