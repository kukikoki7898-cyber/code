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
  '<script>window.ONE_ROLE_BUILD = "' + new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ') + '";</script>',
  '<script>\n' + code + '\n</script>',
  '<script>\n' + read('web/adapter.js') + '\n</script>',
  '<script>var BOOT = { c: (location.search.match(/[?&]c=([a-z0-9]+)/) || [])[1] || "", url: location.origin + location.pathname, web: true };</script>'
].concat(mock ? [] : [
  // 인터넷이 끊겨도 앱이 열리도록 서비스 워커를 등록한다. 저장소 맨 위(…/code/)를 함께 맡도록 위 폴더 것을 먼저 쓰고, 없으면 이 폴더 것을 쓴다.
  '<script>if (window.navigator && navigator.serviceWorker && (location.protocol === "https:" || /^(localhost|127\\.0\\.0\\.1)$/.test(location.hostname))) {' +
  ' navigator.serviceWorker.register("../sw.js", { scope: "../" }).catch(function () { return navigator.serviceWorker.register("sw.js"); }).catch(function () {}); }</script>'
]);
html = html.replace(boot, function () { return parts.join('\n'); });

// 브라우저 보안 규칙: 이 페이지가 정보를 보낼 수 있는 곳을 구글 주소로만 제한한다.
// (개인정보 안내 페이지에서 선생님들께 "직접 확인하는 방법"으로 안내하는 내용이다)
var CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src https://www.googleapis.com https://sheets.googleapis.com https://oauth2.googleapis.com https://accounts.google.com",
  "frame-src https://accounts.google.com",
  "object-src 'none'", "base-uri 'none'", "form-action 'none'"
].join('; ');
html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n' + (mock ? '' : '<meta http-equiv="Content-Security-Policy" content="' + CSP + '">\n') +
  '<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>우리 반 1인 1역</title>' +
  (mock ? '' : '\n<link rel="manifest" href="manifest.json">\n<link rel="icon" href="icon.svg">\n<meta name="theme-color" content="#f6ecd2">'));

if (mock) {
  fs.writeFileSync(process.argv[mi + 1], html);
} else {
  fs.writeFileSync(path.join(root, 'docs/index.html'), html);
  if (!fs.existsSync(path.join(root, 'docs/config.js'))) fs.copyFileSync(path.join(root, 'web/config.js'), path.join(root, 'docs/config.js'));
  console.log('만들었습니다: docs/index.html');
}
