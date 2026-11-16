// 설치 꾸러미(압축파일)를 만든다: node tools/make-package.js
// 결과: dist/1인1역_설치꾸러미.zip
var fs = require('fs'), path = require('path'), cp = require('child_process');
var { chromium } = require('playwright');
var root = path.join(__dirname, '..');
var name = '1인1역_설치꾸러미';
var out = path.join(root, 'dist', name);

(async function () {
  fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
  fs.mkdirSync(path.join(out, '2_붙여넣을 코드'), { recursive: true });
  var BOM = '﻿', crlf = function (s) { return s.replace(/\r?\n/g, '\r\n'); };

  // 메모장에서 바로 열어 복사할 수 있게 .txt 로 넣는다.
  fs.writeFileSync(path.join(out, '2_붙여넣을 코드', 'Code.txt'), BOM + fs.readFileSync(path.join(root, 'apps-script/Code.gs'), 'utf8'));
  fs.writeFileSync(path.join(out, '2_붙여넣을 코드', 'Index.txt'), BOM + fs.readFileSync(path.join(root, 'apps-script/Index.html'), 'utf8'));
  fs.writeFileSync(path.join(out, '읽어 주세요.txt'), BOM + crlf(fs.readFileSync(path.join(root, 'package-src/읽어 주세요.txt'), 'utf8')));
  fs.writeFileSync(path.join(out, '4_소개글 예시.txt'), BOM + crlf(fs.readFileSync(path.join(root, 'package-src/소개글.txt'), 'utf8')));

  // 체험판: 꾸러미에 들어간 코드 그대로 만든다.
  cp.execFileSync('node', [path.join(root, 'test/build-preview.js'), path.join(out, '3_체험판.html'), '--demo', '--src', path.join(out, '2_붙여넣을 코드')]);

  // 안내서 PDF
  var b = await chromium.launch(), pg = await b.newPage();
  await pg.goto('file://' + path.join(root, 'package-src/guide.html'));
  await pg.evaluate(function () { return document.fonts.ready; });
  await pg.waitForTimeout(800);
  await pg.pdf({ path: path.join(out, '1_설치 안내서.pdf'), format: 'A4', printBackground: true });
  await b.close();

  cp.execFileSync('python3', ['-c', [
    'import zipfile, os, sys',
    'root, name = sys.argv[1], sys.argv[2]',
    'z = zipfile.ZipFile(os.path.join(root, name + ".zip"), "w", zipfile.ZIP_DEFLATED)',
    'base = os.path.join(root, name)',
    'for d, _, fs in sorted(os.walk(base)):',
    '    for f in sorted(fs):',
    '        p = os.path.join(d, f); z.write(p, os.path.join(name, os.path.relpath(p, base)))',
    'z.close()'
  ].join('\n'), path.join(root, 'dist'), name]);
  fs.rmSync(out, { recursive: true, force: true });
  console.log('만들었습니다: dist/' + name + '.zip');
})().catch(function (e) { console.error(e); process.exit(1); });
