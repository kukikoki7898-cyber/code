/* 브라우저에서 Code.gs 를 그대로 돌려 보기 위한 가짜 Apps Script 환경 (테스트 전용) */
(function (g) {
  var books = {}, props = {}, seq = 0;
  g.__TODAY = null; g.__OFFLINE = false; g.__books = books;

  function Range(sh, r, c, h, w) { this.sh = sh; this.r = r; this.c = c; this.h = h || 1; this.w = w || 1; }
  Range.prototype.getValues = function () {
    var out = [];
    for (var i = 0; i < this.h; i++) {
      var row = [];
      for (var j = 0; j < this.w; j++) { var v = (this.sh.d[this.r - 1 + i] || [])[this.c - 1 + j]; row.push(v === undefined ? '' : v); }
      out.push(row);
    }
    return out;
  };
  Range.prototype.setValues = function (v) {
    if (v.length !== this.h || v[0].length !== this.w) throw new Error('fake: setValues size mismatch');
    if (this.r + this.h - 1 > this.sh.maxR || this.c + this.w - 1 > this.sh.maxC) throw new Error('fake: 범위가 시트 크기를 벗어남');
    for (var i = 0; i < this.h; i++) {
      var y = this.r - 1 + i;
      while (this.sh.d.length <= y) this.sh.d.push([]);
      for (var j = 0; j < this.w; j++) this.sh.d[y][this.c - 1 + j] = v[i][j];
    }
    return this;
  };
  Range.prototype.setValue = function (v) { var a = []; for (var i = 0; i < this.h; i++) { var r = []; for (var j = 0; j < this.w; j++) r.push(v); a.push(r); } return this.setValues(a); };
  Range.prototype.getValue = function () { return this.getValues()[0][0]; };
  Range.prototype.clearContent = function () { return this.setValue(''); };
  Range.prototype.clear = Range.prototype.clearContent;
  ['setNumberFormat', 'setFontWeight', 'setBackground', 'setBackgrounds', 'setFontColor', 'setFontSize', 'setHorizontalAlignment',
    'setVerticalAlignment', 'setBorder', 'merge'].forEach(function (m) {
    Range.prototype[m] = function () {
      if (this.r < 1 || this.c < 1 || this.h < 1 || this.w < 1 || this.r + this.h - 1 > this.sh.maxR || this.c + this.w - 1 > this.sh.maxC) throw new Error('fake: 꾸밈 범위 오류 ' + m);
      return this;
    };
  });

  function Sheet(name) { this.name = name; this.d = []; this.maxR = 1000; this.maxC = 26; }
  Sheet.prototype.getLastRow = function () {
    for (var i = this.d.length - 1; i >= 0; i--) for (var j = 0; j < (this.d[i] || []).length; j++) if (this.d[i][j] !== '' && this.d[i][j] !== undefined) return i + 1;
    return 0;
  };
  Sheet.prototype.getLastColumn = function () {
    var m = 0;
    for (var i = 0; i < this.d.length; i++) for (var j = 0; j < (this.d[i] || []).length; j++) if (this.d[i][j] !== '' && this.d[i][j] !== undefined) m = Math.max(m, j + 1);
    return m;
  };
  Sheet.prototype.getRange = function (r, c, h, w) { return new Range(this, r, c, h, w); };
  Sheet.prototype.getDataRange = function () { return new Range(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); };
  ['setFrozenRows', 'setFrozenColumns', 'setRowHeight', 'setColumnWidth', 'setColumnWidths', 'setTabColor', 'setHiddenGridlines',
    'setConditionalFormatRules'].forEach(function (m) { Sheet.prototype[m] = function () {}; });
  Sheet.prototype.getName = function () { return this.name; };
  Sheet.prototype.getMaxRows = function () { return this.maxR; };
  Sheet.prototype.getMaxColumns = function () { return this.maxC; };
  Sheet.prototype.insertColumnsAfter = function (a, n) { this.maxC += n; };
  Sheet.prototype.insertRowsAfter = function (a, n) { this.maxR += n; };

  function Book(id) { this.id = id; this.sheets = { '시트1': new Sheet('시트1') }; this.order = ['시트1']; }
  Book.prototype.getSheetByName = function (n) { return this.sheets[n] || null; };
  Book.prototype.insertSheet = function (n, idx) { this.order.splice(idx === undefined ? this.order.length : idx, 0, n); return (this.sheets[n] = new Sheet(n)); };
  Book.prototype.getSheets = function () { var me = this; return this.order.map(function (n) { return me.sheets[n]; }); };
  Book.prototype.deleteSheet = function (sh) { delete this.sheets[sh.name]; this.order.splice(this.order.indexOf(sh.name), 1); };
  Book.prototype.getSpreadsheetTimeZone = function () { return 'Asia/Seoul'; };
  Book.prototype.getId = function () { return this.id; };

  function ruleB() { return new Proxy({}, { get: function (t, k) {
    if (['whenTextEqualTo', 'whenTextContains', 'setBackground', 'setFontColor', 'setBold', 'setRanges'].indexOf(k) >= 0) return function () { return ruleB(); };
    if (k === 'build') return function () { return {}; };
    throw new Error('fake: 없는 규칙 메서드 ' + String(k));
  } }); }
  g.__STRICT_STYLE = true;
  g.SpreadsheetApp = {
    BorderStyle: { SOLID: 'SOLID' },
    newConditionalFormatRule: ruleB,
    openById: function (id) { if (!books[id]) throw new Error('no access'); return books[id]; },
    create: function () { var id = 'FAKEBOOK' + (++seq) + '_abcdefghijklmnop'; return (books[id] = new Book(id)); }
  };
  g.__newBook = function () { return g.SpreadsheetApp.create().getId(); };
  g.PropertiesService = { getScriptProperties: function () { return {
    getProperty: function (k) { return k in props ? props[k] : null; },
    setProperty: function (k, v) { props[k] = String(v); },
    deleteProperty: function (k) { delete props[k]; },
    getProperties: function () { return JSON.parse(JSON.stringify(props)); }
  }; } };
  g.LockService = { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } };
  g.Utilities = {
    DigestAlgorithm: { SHA_256: 1 }, Charset: { UTF_8: 1 },
    sleep: function () {},
    computeDigest: function (a, s) { var out = [], h = 7; for (var i = 0; i < 32; i++) { for (var j = 0; j < s.length; j++) h = (h * 31 + s.charCodeAt(j) + i) | 0; out.push((h & 255) - 128); } return out; },
    formatDate: function (d) {
      if (g.__TODAY && Math.abs(d.getTime() - Date.now()) < 5000) return g.__TODAY;
      return new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10);
    }
  };
  g.ScriptApp = { getService: function () { return { getUrl: function () { return 'https://script.google.com/macros/s/EXAMPLE/exec'; } }; } };

  function runner(ok, fail) {
    return new Proxy({}, { get: function (_, name) {
      if (name === 'withSuccessHandler') return function (f) { return runner(f, fail); };
      if (name === 'withFailureHandler') return function (f) { return runner(ok, f); };
      return function () {
        var args = JSON.parse(JSON.stringify([].slice.call(arguments)));
        setTimeout(function () {
          if (g.__OFFLINE) { if (fail) fail(new Error('NetworkError')); return; }
          var res;
          try { res = g[name].apply(null, args); } catch (e) { if (fail) fail(e); return; }
          if (ok) ok(res === undefined ? undefined : JSON.parse(JSON.stringify(res)));
        }, 120);
      };
    } });
  }
  g.google = { script: { run: runner(null, null) } };
})(window);
