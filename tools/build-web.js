// 웹 버전(구글 로그인 방식)을 만든다: node tools/build-web.js
//   결과: docs/index.html, docs/config.js  (GitHub Pages 가 docs 폴더를 그대로 보여 준다)
//   검사용: node tools/build-web.js --mock <출력 파일>   (가짜 구글 서버를 끼워 넣는다)
var fs = require('fs'), path = require('path');
var root = path.join(__dirname, '..');
var read = function (f) { return fs.readFileSync(path.join(root, f), 'utf8'); };
var mi = process.argv.indexOf('--mock'), mock = mi > 0;

var html = read('apps-script/Index.html');
var boot = '<script>var BOOT = <?!= boot ?>;</script>';
if (html.indexOf(boot) < 0) throw new Error('Index.html 에서 BOOT 줄을 찾지 못했습니다.');
var code = read('apps-script/Code.gs');
if (/<\/script/i.test(code)) throw new Error('Code.gs 안에 </script 가 있으면 안 됩니다.');

var parts = [
  mock ? '<script>window.ONE_ROLE_CONFIG = { clientId: "mock" };</script>\n<script>' + read('test/mock-google.js') + '</script>'
       : '<script src="config.js"></script>\n<script src="https://accounts.google.com/gsi/client" async defer></script>',
  '<script>\n' + code + '\n</script>',
  '<script>\n' + read('web/adapter.js') + '\n</script>',
  '<script>var BOOT = { c: (location.search.match(/[?&]c=([a-z0-9]+)/) || [])[1] || "", url: location.origin + location.pathname, web: true };</script>'
];
html = html.replace(boot, function () { return parts.join('\n'); });
html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>우리 반 1인 1역</title>');

if (mock) {
  fs.writeFileSync(process.argv[mi + 1], html);
} else {
  fs.writeFileSync(path.join(root, 'docs/index.html'), html);
  if (!fs.existsSync(path.join(root, 'docs/config.js'))) fs.copyFileSync(path.join(root, 'web/config.js'), path.join(root, 'docs/config.js'));
  console.log('만들었습니다: docs/index.html');
}
