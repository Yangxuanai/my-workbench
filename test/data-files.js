/**
 * 数据文件校验：确保 news.json / music.json 结构正确、能被应用正常读取。
 * 这两个文件是要天天替换的，所以单独校验，避免手滑改坏格式导致页面空白。
 * 运行：node test/data-files.js
 */
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..');
let pass = 0;
let fail = 0;

function ok(n) { pass++; console.log(`  PASS  ${n}`); }
function bad(n, m) { fail++; console.log(`  FAIL  ${n} -> ${m}`); }
function check(n, fn) {
  try { fn(); ok(n); } catch (e) { bad(n, e.message); }
}
function assert(c, m) { if (!c) throw new Error(m || '断言失败'); }

function readJson(file) {
  const p = path.join(WEB, file);
  assert(fs.existsSync(p), `${file} 不存在`);
  const raw = fs.readFileSync(p, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`${file} 不是合法 JSON：${e.message}`);
  }
}

console.log('\n[1] news.json');
let news = null;
check('可解析为合法 JSON', () => { news = readJson('news.json'); });
check('含 updatedAt', () => assert(typeof news.updatedAt === 'string' && news.updatedAt.length > 0, 'updatedAt 缺失'));
check('含 groups 数组', () => assert(Array.isArray(news.groups) && news.groups.length >= 1, 'groups 缺失或为空'));
check('包含「美股财经」分组', () => {
  const us = news.groups.filter((g) => g.key === 'us')[0];
  assert(us, '缺少 key=us 的分组');
  assert(us.name, '分组缺少 name');
});
check('包含「国内」分组（单独一栏）', () => {
  const cn = news.groups.filter((g) => g.key === 'cn')[0];
  assert(cn, '缺少 key=cn 的分组');
});
check('每个分组结构正确', () => {
  news.groups.forEach((g, i) => {
    assert(typeof g.key === 'string' && g.key, `第 ${i} 个分组缺少 key`);
    assert(typeof g.name === 'string' && g.name, `分组 ${g.key} 缺少 name`);
    assert(Array.isArray(g.items), `分组 ${g.key} 的 items 不是数组`);
    g.items.forEach((it, j) => {
      assert(typeof it.title === 'string' && it.title.trim(), `${g.key}[${j}] 缺少 title`);
      if (it.url) assert(/^https?:\/\//.test(it.url), `${g.key}[${j}] 的 url 不是 http(s) 链接`);
      if (it.body !== undefined) assert(typeof it.body === 'string', `${g.key}[${j}] 的 body 应为字符串`);
    });
  });
});
check('美股分组有内容', () => {
  const us = news.groups.filter((g) => g.key === 'us')[0];
  assert(us.items.length >= 1, '美股分组为空');
});
check('soxl 标记为可选布尔值', () => {
  news.groups.forEach((g) => {
    g.items.forEach((it, j) => {
      if (it.soxl !== undefined) {
        assert(typeof it.soxl === 'boolean', `${g.key}[${j}] 的 soxl 应为 true/false`);
      }
    });
  });
});
check('至少有一条 SOXL 相关（首页专区不会空）', () => {
  const n = news.groups.reduce((acc, g) =>
    acc + g.items.filter((it) => it.soxl === true || /SOXL/i.test(it.title + (it.body || ''))).length, 0);
  assert(n >= 1, '没有任何 SOXL 相关条目，首页会显示空态');
  console.log(`        提示：当前 SOXL 相关条目 ${n} 条`);
});
check('没有多余的空分组（避免点进去空白）', () => {
  const empty = news.groups.filter((g) => !g.items.length).map((g) => g.key);
  if (empty.length) console.log(`        提示：这些分组目前是空的 -> ${empty.join(', ')}`);
});

console.log('\n[2] music.json');
let music = null;
check('可解析为合法 JSON', () => { music = readJson('music.json'); });
check('含 playlists 数组', () => assert(Array.isArray(music.playlists) && music.playlists.length >= 1, 'playlists 缺失或为空'));
check('每张歌单结构正确', () => {
  music.playlists.forEach((m, i) => {
    assert(typeof m.name === 'string' && m.name, `第 ${i} 张歌单缺少 name`);
    assert(m.icon !== undefined, `歌单 ${m.name} 缺少 icon`);
    /* neteaseId 与 url 至少要有一个，否则点了没反应 */
    const hasId = m.neteaseId !== undefined && String(m.neteaseId).length > 0;
    const hasUrl = typeof m.url === 'string' && m.url.length > 0;
    assert(hasId || hasUrl, `歌单「${m.name}」既没有 neteaseId 也没有 url，点了会没反应`);
    if (hasId) assert(/^\d+$/.test(String(m.neteaseId)), `歌单「${m.name}」的 neteaseId 应为纯数字`);
    if (hasUrl) assert(/^https?:\/\//.test(m.url), `歌单「${m.name}」的 url 不是 http(s) 链接`);
  });
});
check('歌单 id 不重复', () => {
  const ids = music.playlists.map((m) => m.id);
  assert(new Set(ids).size === ids.length, '存在重复 id');
});

console.log('\n[3] 应用静态文件');
check('manifest 合法且图标齐全', () => {
  const m = readJson('manifest.webmanifest');
  assert(m.name && m.short_name, '缺少 name/short_name');
  assert(m.start_url, '缺少 start_url');
  assert(m.display === 'standalone', 'display 应为 standalone 才能像 App 一样打开');
  m.icons.forEach((i) => {
    assert(fs.existsSync(path.join(WEB, i.src)), `缺少图标文件 ${i.src}`);
  });
});
check('index.html 引用的资源都存在', () => {
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  (html.match(/(?:src|href)="([^"]+)"/g) || []).forEach((s) => {
    const rel = s.match(/"([^"]+)"/)[1];
    if (/^https?:|^\/\//.test(rel)) return;
    assert(fs.existsSync(path.join(WEB, rel)), `找不到资源 ${rel}`);
  });
});
check('sw.js 里预缓存列表的文件都存在', () => {
  const sw = fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8');
  const block = sw.match(/const SHELL = \[([\s\S]*?)\];/);
  assert(block, '没找到 SHELL 列表');
  (block[1].match(/'([^']+)'/g) || []).forEach((s) => {
    const rel = s.replace(/'/g, '');
    if (rel === './') return;
    assert(fs.existsSync(path.join(WEB, rel)), `sw.js 预缓存的文件不存在：${rel}`);
  });
});

console.log(`\n===== 数据文件校验：通过 ${pass} 项，失败 ${fail} 项 =====`);
process.exit(fail === 0 ? 0 : 1);
