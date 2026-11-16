/* 검사 전용: 구글 로그인(GIS)과 Sheets/Drive API 를 흉내 낸다. 상태는 sessionStorage 에 둬서 새로 고침에도 남는다. */
(function (g) {
  var M = g.__mock = { tokenReqs: 0, log: [], failNext: 0, expires: 3600, valid: null };
  var store = JSON.parse(sessionStorage.getItem('mockDrive') || '{"files":{},"seq":0}');
  M.store = store;
  function save() { sessionStorage.setItem('mockDrive', JSON.stringify(store)); }

  g.google = g.google || {};
  g.google.accounts = { oauth2: {
    initTokenClient: function (cfg) {
      return { requestAccessToken: function (opt) {
        M.tokenReqs++; M.lastOpt = opt;
        setTimeout(function () {
          M.valid = 'tok' + M.tokenReqs;
          var scope = M.skipDrive ? 'openid' : cfg.scope;
          M.askedScope = cfg.scope;
          M.skipDrive = false;
          cfg.callback({ access_token: M.valid, expires_in: M.expires, scope: scope });
        }, 40);
      } };
    },
    revoke: function (t, cb) { M.valid = null; if (cb) cb(); }
  } };

  function resp(status, body) {
    return Promise.resolve({ ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(body); } });
  }
  function err(status, msg) { return resp(status, { error: { code: status, message: msg } }); }
  function colNum(s) { var n = 0; for (var i = 0; i < s.length; i++) n = n * 26 + s.charCodeAt(i) - 64; return n; }
  function findSheet(f, title) { for (var i = 0; i < f.sheets.length; i++) if (f.sheets[i].properties.title === title) return f.sheets[i]; return null; }
  function byId(f, id) { for (var i = 0; i < f.sheets.length; i++) if (f.sheets[i].properties.sheetId === id) return f.sheets[i]; return null; }
  function inGrid(sh, r) {
    var gp = sh.properties.gridProperties;
    return r.startRowIndex >= 0 && r.startColumnIndex >= 0 && r.endRowIndex > r.startRowIndex && r.endColumnIndex > r.startColumnIndex &&
      r.endRowIndex <= gp.rowCount && r.endColumnIndex <= gp.columnCount;
  }
  var KNOWN = ['addSheet', 'deleteSheet', 'appendDimension', 'repeatCell', 'updateCells', 'updateBorders', 'mergeCells', 'unmergeCells',
    'updateSheetProperties', 'updateDimensionProperties', 'addConditionalFormatRule', 'deleteConditionalFormatRule'];

  function batch(f, reqs) {
    for (var i = 0; i < reqs.length; i++) {
      var keys = Object.keys(reqs[i]);
      if (keys.length !== 1 || KNOWN.indexOf(keys[0]) < 0) return '모르는 요청: ' + keys.join(',');
      var k = keys[0], q = reqs[i][k], sh;
      if (k === 'addSheet') {
        if (findSheet(f, q.properties.title)) return '같은 이름의 시트가 있음: ' + q.properties.title;
        f.sheets.splice(q.properties.index === undefined ? f.sheets.length : q.properties.index, 0, { properties: JSON.parse(JSON.stringify(q.properties)), values: [], cf: 0 });
      } else if (k === 'deleteSheet') {
        sh = byId(f, q.sheetId); if (!sh) return '없는 시트'; if (f.sheets.length === 1) return '마지막 시트는 지울 수 없음';
        f.sheets.splice(f.sheets.indexOf(sh), 1);
      } else if (k === 'appendDimension') {
        sh = byId(f, q.sheetId); if (!sh) return '없는 시트';
        sh.properties.gridProperties[q.dimension === 'ROWS' ? 'rowCount' : 'columnCount'] += q.length;
      } else if (k === 'addConditionalFormatRule') {
        var rs = q.rule.ranges; if (!rs.length) return '범위 없는 규칙';
        for (var j = 0; j < rs.length; j++) { sh = byId(f, rs[j].sheetId); if (!sh || !inGrid(sh, rs[j])) return '규칙 범위 오류'; }
        if (['TEXT_EQ', 'TEXT_CONTAINS'].indexOf(q.rule.booleanRule.condition.type) < 0) return '모르는 조건';
        sh.cf++;
      } else if (k === 'deleteConditionalFormatRule') {
        sh = byId(f, q.sheetId); if (!sh || q.index >= sh.cf) return '없는 규칙 번호'; sh.cf--;
      } else if (k === 'updateSheetProperties') {
        sh = byId(f, q.properties.sheetId); if (!sh || !q.fields) return '시트 속성 오류';
      } else if (k === 'updateDimensionProperties') {
        sh = byId(f, q.range.sheetId); if (!sh) return '없는 시트';
        var lim = sh.properties.gridProperties[q.range.dimension === 'ROWS' ? 'rowCount' : 'columnCount'];
        if (q.range.startIndex < 0 || q.range.endIndex > lim || q.range.endIndex <= q.range.startIndex) return '행/열 범위 오류';
      } else {
        sh = byId(f, q.range.sheetId); if (!sh) return '없는 시트 (' + k + ')';
        if (!inGrid(sh, q.range)) return k + ' 범위가 시트 크기를 벗어남';
        if (k === 'updateCells' && q.fields.indexOf('userEnteredValue') >= 0) {
          for (var r = q.range.startRowIndex; r < q.range.endRowIndex; r++) if (sh.values[r]) for (var c = q.range.startColumnIndex; c < q.range.endColumnIndex; c++) if (c < sh.values[r].length) sh.values[r][c] = '';
        }
      }
    }
    return '';
  }

  var realFetch = g.fetch;
  g.fetch = function (url, opt) {
    opt = opt || {};
    if (!/googleapis\.com/.test(url)) return realFetch.apply(g, arguments);
    var method = opt.method || 'GET', body = opt.body ? JSON.parse(opt.body) : null, u = new URL(url), p = u.pathname, m;
    M.log.push(method + ' ' + p.replace(/FAKE\w+/, 'ID'));
    return new Promise(function (resolve) { setTimeout(resolve, 15); }).then(function () {
      if ((opt.headers || {}).Authorization !== 'Bearer ' + M.valid) return err(401, 'Invalid Credentials');
      if (M.failNext > 0) { M.failNext--; return err(500, 'Internal error'); }
      if (p === '/drive/v3/about') return resp(200, { user: { emailAddress: 'teacher@example.com' } });
      if (p === '/drive/v3/files' && method === 'GET') {
        var out = [];
        for (var id in store.files) if ((store.files[id].appProperties || {}).oneRole === '1') out.push({ id: id, appProperties: store.files[id].appProperties });
        return resp(200, { files: out });
      }
      if ((m = p.match(/^\/drive\/v3\/files\/(\w+)$/)) && method === 'PATCH') {
        var f0 = store.files[m[1]]; if (!f0) return err(404, 'File not found');
        f0.appProperties = f0.appProperties || {};
        for (var k in body.appProperties) {
          if (body.appProperties[k] === null) delete f0.appProperties[k];
          else {
            if (unescape(encodeURIComponent(k + body.appProperties[k])).length > 124) return err(400, 'appProperties too long');
            f0.appProperties[k] = body.appProperties[k];
          }
        }
        save(); return resp(200, { id: m[1] });
      }
      if (p === '/drive/v3/files' && method === 'POST') {
        if (body.mimeType !== 'application/vnd.google-apps.spreadsheet') return err(400, 'bad mimeType');
        var did = 'FAKE' + (++store.seq) + 'abcdefghijklmnopqrstuvwx';
        store.files[did] = { title: body.name, appProperties: body.appProperties || {}, sheets: [{ properties: { sheetId: 0, title: '시트1', index: 0, gridProperties: { rowCount: 1000, columnCount: 26 } }, values: [], cf: 0 }] };
        save();
        return resp(200, { id: did });
      }
      if (p === '/v4/spreadsheets' && method === 'POST') {
        var nid = 'FAKE' + (++store.seq) + 'abcdefghijklmnopqrstuvwx';
        store.files[nid] = { title: body.properties.title, appProperties: {}, sheets: [{ properties: { sheetId: 0, title: '시트1', index: 0, gridProperties: { rowCount: 1000, columnCount: 26 } }, values: [], cf: 0 }] };
        save();
        return resp(200, { spreadsheetId: nid, sheets: store.files[nid].sheets.map(function (s) { return { properties: s.properties }; }) });
      }
      if (!(m = p.match(/^\/v4\/spreadsheets\/(\w+)(.*)$/))) return err(404, 'unknown ' + p);
      var f = store.files[m[1]], rest = m[2];
      if (!f) return err(404, 'Requested entity was not found.');
      if (rest === '' && method === 'GET') {
        return resp(200, { sheets: f.sheets.map(function (s) { var cf = []; for (var i = 0; i < s.cf; i++) cf.push({}); return { properties: s.properties, conditionalFormats: cf }; }) });
      }
      if (rest === '/values:batchGet') {
        var vr = u.searchParams.getAll('ranges').map(function (r) {
          var sh = findSheet(f, r.replace(/^'|'$/g, '')); if (!sh) return null;
          var rows = sh.values.map(function (row) { return (row || []).map(function (v) { return v === undefined || v === null ? '' : String(v); }); });
          return rows.length ? { range: r, values: rows } : { range: r };
        });
        if (vr.indexOf(null) >= 0) return err(400, 'Unable to parse range');
        return resp(200, { valueRanges: vr });
      }
      if (rest === '/values:batchUpdate') {
        if (body.valueInputOption !== 'RAW') return err(400, 'valueInputOption');
        for (var i = 0; i < body.data.length; i++) {
          var a = body.data[i].range.match(/^'(.+)'!([A-Z]+)(\d+):([A-Z]+)(\d+)$/); if (!a) return err(400, 'Unable to parse range: ' + body.data[i].range);
          var sh = findSheet(f, a[1]); if (!sh) return err(400, 'Unable to parse range: ' + body.data[i].range);
          var r0 = +a[3], c0 = colNum(a[2]), r1 = +a[5], c1 = colNum(a[4]), gp = sh.properties.gridProperties, vals = body.data[i].values;
          if (r1 > gp.rowCount || c1 > gp.columnCount) return err(400, 'Range exceeds grid limits');
          if (vals.length > r1 - r0 + 1) return err(400, 'too many rows');
          for (var y = 0; y < vals.length; y++) {
            while (sh.values.length < r0 + y) sh.values.push([]);
            for (var x = 0; x < vals[y].length; x++) { var row = sh.values[r0 - 1 + y]; while (row.length < c0 - 1 + x) row.push(''); row[c0 - 1 + x] = vals[y][x]; }
          }
        }
        save(); return resp(200, {});
      }
      if (rest === ':batchUpdate') {
        var copy = JSON.parse(JSON.stringify(f)), bad = batch(copy, body.requests);
        if (bad) { M.batchError = bad; return err(400, bad); }
        store.files[m[1]] = copy; save(); return resp(200, {});
      }
      return err(404, 'unknown ' + p);
    });
  };
})(window);
