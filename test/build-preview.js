// 테스트용 미리보기 파일을 만든다: node test/build-preview.js <출력 경로>
var fs = require('fs'), path = require('path');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'apps-script/Index.html'), 'utf8');
var inject = '<script>' + fs.readFileSync(path.join(__dirname, 'fake-gas.js'), 'utf8') + '</script>\n' +
  '<script>' + fs.readFileSync(path.join(root, 'apps-script/Code.gs'), 'utf8') + '</script>\n' +
  '<script>' + fs.readFileSync(path.join(__dirname, 'seed.js'), 'utf8') + '</script>\n';
html = html.replace('<script>var BOOT = <?!= boot ?>;</script>', inject + '<script>var BOOT = {c: window.__SEED_CODE || "", url: "https://script.google.com/macros/s/EXAMPLE/exec"};</script>');
fs.writeFileSync(process.argv[2], html);
