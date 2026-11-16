// 테스트용 미리보기 파일을 만든다: node test/build-preview.js <출력 경로>
var fs = require('fs'), path = require('path');
var root = path.join(__dirname, '..');
// 코드 폴더와 체험판 여부를 바꿀 수 있다: node build-preview.js <출력> [--demo] [--src <폴더>]
var demo = process.argv.indexOf('--demo') > 0;
var si = process.argv.indexOf('--src');
var src = si > 0 ? process.argv[si + 1] : path.join(root, 'apps-script');
var read = function (names) {
  for (var i = 0; i < names.length; i++) { var f = path.join(src, names[i]); if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''); }
  throw new Error('파일 없음: ' + names.join(', '));
};
var html = read(['Index.html', 'Index.txt']);
var inject = '<script>' + fs.readFileSync(path.join(__dirname, 'fake-gas.js'), 'utf8') + '</script>\n' +
  '<script>' + read(['Code.gs', 'Code.txt']) + '</script>\n' +
  (demo ? '<script>window.__DEMO = true;</script>\n' : '') +
  '<script>' + fs.readFileSync(path.join(__dirname, 'seed.js'), 'utf8') + '</script>\n';
html = html.replace('<script>var BOOT = <?!= boot ?>;</script>', inject + '<script>var BOOT = {c: window.__SEED_CODE || "", url: "https://script.google.com/macros/s/EXAMPLE/exec"};</script>');
if (demo) html = html.replace('<div id="app"></div>', '<div style="background:#2b2a28;color:#fff;font-size:15px;padding:6px 12px;text-align:center">체험판입니다. 눌러 보는 내용은 저장되지 않아요. 설정 비밀번호는 1234 · 새로 고침하면 처음으로 돌아갑니다.</div><div id="app"></div>');
fs.writeFileSync(process.argv[2], html);
