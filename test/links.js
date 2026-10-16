/**
 * 链接与资源一致性检查：确保文档里写的路径都存在，没有指错。
 * 运行：node test/links.js
 */
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..');
const ROOT = path.join(WEB, '..');

let pass = 0;
let fail = 0;
function ok(n) { pass++; console.log(`  PASS  ${n}`); }
function bad(n, m) { fail++; console.log(`  FAIL  ${n} -> ${m}`); }
function check(n, fn) {
  try { fn(); ok(n); } catch (e) { bad(n, e.message); }
}
function assert(c, m) { if (!c) throw new Error(m || '断言失败'); }

function mdLinks(file, baseDir) {
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  const re = /\[([^\]]*)\]\(<?([^)>\s]+)>?\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const target = m[2];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    out.push({ label: m[1], target: target.split('#')[0] });
  }
  return out.map((x) => Object.assign(x, { resolved: path.resolve(baseDir, x.target) }));
}

console.log('\n[1] web/README.md 里的路径引用');
check('文档里用反引号写的文件路径都真实存在', () => {
  const src = fs.readFileSync(path.join(WEB, 'README.md'), 'utf8');
  /* 只校验看起来像「本项目内的文件路径」的片段 */
  const cand = [...new Set(
    (src.match(/`([\w./-]+\.(?:js|json|html|webmanifest|py|md))`/g) || [])
      .map((s) => s.replace(/`/g, ''))
      .filter((s) => s.indexOf('http') < 0)
  )];
  assert(cand.length > 0, '没解析到任何路径');
  const missing = cand.filter((rel) => {
    /* 允许 test/xxx.js 这种相对 web/ 的写法，也允许只给文件名 */
    const tries = [
      path.join(WEB, rel),
      path.join(WEB, 'test', path.basename(rel)),
      path.join(ROOT, rel)
    ];
    return !tries.some((p) => fs.existsSync(p));
  });
  assert(missing.length === 0, '文档提到的文件不存在：' + missing.join(', '));
  console.log(`        校验了 ${cand.length} 个路径`);
});
check('文档里的相对 markdown 链接都有效', () => {
  const links = mdLinks(path.join(WEB, 'README.md'), WEB);
  const broken = links.filter((l) => !fs.existsSync(l.resolved));
  assert(broken.length === 0, '失效链接：' + broken.map((b) => b.target).join(', '));
  console.log(`        检查了 ${links.length} 个相对链接`);
});

console.log('\n[2] 根 README.md 里的相对链接');
check('所有相对链接都指向存在的文件', () => {
  const links = mdLinks(path.join(ROOT, 'README.md'), ROOT);
  const broken = links.filter((l) => !fs.existsSync(l.resolved));
  assert(broken.length === 0, '失效链接：' + broken.map((b) => b.target).join(', '));
  console.log(`        检查了 ${links.length} 个相对链接`);
});

console.log('\n[3] 文档里承诺的文件都在');
check('web README 提到的目录结构真实存在', () => {
  ['index.html', 'manifest.webmanifest', 'sw.js', 'news.json', 'music.json',
    'icons', 'js/time.js', 'js/app.js', 'scripts/make-icons.py', 'test']
    .forEach((p) => assert(fs.existsSync(path.join(WEB, p)), '缺少 ' + p));
});
check('根 README 提到的两个版本目录都在', () => {
  ['web', 'miniprogram'].forEach((p) => assert(fs.existsSync(path.join(ROOT, p)), '缺少 ' + p));
});
check('package.json 里的脚本指向存在的文件', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  Object.keys(pkg.scripts).forEach((k) => {
    const cmd = pkg.scripts[k];
    (cmd.match(/node\s+([\w./-]+\.js)/g) || []).forEach((s) => {
      const rel = s.replace(/^node\s+/, '');
      assert(fs.existsSync(path.join(ROOT, rel)), `脚本 ${k} 指向不存在的文件 ${rel}`);
    });
  });
});

console.log('\n[4] 图标与 PWA 一致性');
check('manifest 声明的图标都存在且尺寸合理', () => {
  const m = JSON.parse(fs.readFileSync(path.join(WEB, 'manifest.webmanifest'), 'utf8'));
  m.icons.forEach((i) => {
    const p = path.join(WEB, i.src);
    assert(fs.existsSync(p), '缺图标 ' + i.src);
    const size = fs.statSync(p).size;
    assert(size > 2000, `${i.src} 只有 ${size} 字节，可能不是有效 PNG`);
  });
});
check('每个图标都有 any 或 maskable 用途声明', () => {
  const m = JSON.parse(fs.readFileSync(path.join(WEB, 'manifest.webmanifest'), 'utf8'));
  m.icons.forEach((i) => assert(i.purpose, `${i.src} 缺少 purpose`));
  assert(m.icons.some((i) => i.purpose.indexOf('maskable') >= 0), '缺少 maskable 图标（安卓会显示白边）');
});
check('sw.js 预缓存清单里的文件都存在', () => {
  const sw = fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8');
  const block = sw.match(/const SHELL = \[([\s\S]*?)\];/);
  assert(block, '没找到 SHELL');
  (block[1].match(/'([^']+)'/g) || []).forEach((s) => {
    const rel = s.replace(/'/g, '');
    if (rel === './') return;
    assert(fs.existsSync(path.join(WEB, rel)), 'sw.js 预缓存缺失：' + rel);
  });
});

console.log('\n[5] 测试文件自洽');
check('每个 test/*.js 都能被 node 直接运行（语法正确）', () => {
  const vm = require('vm');
  fs.readdirSync(path.join(WEB, 'test')).filter((f) => f.endsWith('.js')).forEach((f) => {
    const code = fs.readFileSync(path.join(WEB, 'test', f), 'utf8');
    try {
      vm.compileFunction(code, ['require', 'module', 'exports', '__filename', '__dirname', 'process', 'console'],
        { filename: f });
    } catch (e) {
      throw new Error(`${f} 语法错误：${e.message}`);
    }
  });
});

console.log(`\n===== 链接与资源一致性：通过 ${pass} 项，失败 ${fail} 项 =====`);
process.exit(fail === 0 ? 0 : 1);
