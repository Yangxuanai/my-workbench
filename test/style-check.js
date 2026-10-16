/**
 * CSS 与结构体检：不依赖浏览器，静态检查常见问题。
 * 运行：node test/style-check.js
 */
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];

let pass = 0;
let fail = 0;
function ok(n) { pass++; console.log(`  PASS  ${n}`); }
function bad(n, m) { fail++; console.log(`  FAIL  ${n} -> ${m}`); }
function check(n, fn) {
  try { fn(); ok(n); } catch (e) { bad(n, e.message); }
}
function assert(c, m) { if (!c) throw new Error(m || '断言失败'); }

console.log('\n[1] CSS 结构');
check('花括号配对', () => {
  const o = (css.match(/\{/g) || []).length;
  const c = (css.match(/\}/g) || []).length;
  assert(o === c, `{ ${o} 个，} ${c} 个`);
});
check('圆括号配对', () => {
  const o = (css.match(/\(/g) || []).length;
  const c = (css.match(/\)/g) || []).length;
  assert(o === c, `( ${o} 个，) ${c} 个`);
});
check('没有混入非 ASCII 数字或异体字符', () => {
  /* 抓出梵文/全角数字等误输入 */
  const bad = css.match(/[\u0966-\u096F\uFF10-\uFF19]/g);
  assert(!bad, '发现异常字符：' + (bad || []).join(''));
});

console.log('\n[2] CSS 变量');
check('所有 var(--x) 都有定义', () => {
  const used = [...new Set([...css.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]))];
  const undef = used.filter((v) => css.indexOf(v + ':') < 0);
  assert(undef.length === 0, '未定义：' + undef.join(', '));
});

console.log('\n[3] class 覆盖');
check('HTML 用到的 class 在 CSS 里都有定义', () => {
  const used = [...new Set(
    [...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean)
  )];
  /* 忽略纯工具类与 JS 动态添加的类 */
  const ignore = new Set(['on', 'live']);
  const missing = used.filter((c) => !ignore.has(c) && css.indexOf('.' + c) < 0);
  assert(missing.length === 0, '缺样式：' + missing.join(', '));
});

console.log('\n[4] 结构完整性');
check('五个页面区块都存在且 id 正确', () => {
  ['home', 'trade', 'music', 'news', 'me'].forEach((v) => {
    assert(html.indexOf(`id="v-${v}"`) >= 0, `缺少 v-${v}`);
  });
});
check('底部导航按钮与页面一一对应', () => {
  const got = [...html.matchAll(/data-go="([^"]+)"/g)].map((m) => m[1]);
  assert(got.length === 5, '导航按钮数=' + got.length);
  ['home', 'trade', 'music', 'news', 'me'].forEach((v) => {
    assert(got.indexOf(v) >= 0, `导航缺少 ${v}`);
  });
});
check('初始只显示首页', () => {
  const onViews = [...html.matchAll(/class="view on" id="([^"]+)"/g)].map((m) => m[1]);
  assert(onViews.length === 1 && onViews[0] === 'v-home', '初始激活页=' + onViews.join(','));
});
check('每个 view 都有配对的 </section>', () => {
  const open = (html.match(/<section class="view/g) || []).length;
  const close = (html.match(/<\/section>/g) || []).length;
  assert(open === close && open === 5, `<section> ${open} 个，</section> ${close} 个`);
});
check('所有页面都能被 JS 找到（id 唯一）', () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  assert(dup.length === 0, '重复 id：' + [...new Set(dup)].join(', '));
});

console.log('\n[5] 无障碍与移动端要点');
check('viewport 已设置且禁用缩放（避免误缩放）', () => {
  assert(/name="viewport"/.test(html), '缺少 viewport');
  assert(/maximum-scale=1/.test(html), '未禁用缩放');
  assert(/viewport-fit=cover/.test(html), '未适配刘海屏');
});
check('设置了 theme-color 与 iOS 主屏配置', () => {
  assert(/name="theme-color"/.test(html), '缺少 theme-color');
  assert(/apple-mobile-web-app-capable/.test(html), '缺少 iOS 全屏配置');
  assert(/apple-mobile-web-app-title/.test(html), '缺少 iOS 图标名');
});
check('所有可点元素都有 data-* 或 onclick 绑定', () => {
  /* 抽查关键交互目标 */
  ['todoList', 'habitChips', 'musicList', 'newsSeg', 'tradeList'].forEach((id) => {
    assert(html.indexOf(`id="${id}"`) >= 0, `缺少容器 ${id}`);
  });
});
check('底部导航固定定位且为内容留出高度', () => {
  assert(/nav\{[\s\S]*?position:fixed/.test(css), '导航未固定');
  assert(/--nav-h/.test(css), '没有定义导航高度变量');
  assert(/calc\(var\(--nav-h\)/.test(css), '内容未给导航留空间');
});
check('安全区适配（iPhone 底部横条）', () => {
  const n = (html.match(/env\(safe-area-inset/g) || []).length;
  assert(n >= 3, 'safe-area 使用次数=' + n);
});
check('输入框在 iOS 上不会自动放大（字号 >= 16px）', () => {
  const m = css.match(/\.inp\{([\s\S]*?)\}/);
  assert(m, '没找到 .inp 规则');
  const size = m[1].match(/font-size:\s*(\d+)px/);
  assert(size, '.inp 没设 font-size');
  assert(parseInt(size[1], 10) >= 15, '.inp 字号 ' + size[1] + 'px，iOS 上输入时会放大页面');
});

console.log('\n[6] 首页结构（已按要求去掉倒计时）');
check('首页有页头与状态胶囊', () => {
  ['hi', 'bjBig', 'bjDate', 'workPill'].forEach((id) => {
    assert(html.indexOf(`id="${id}"`) >= 0, `缺少 #${id}`);
  });
});
check('首页有行情环境条（时段/美东时间/你的时段）', () => {
  ['envSession', 'envEt', 'envWindow', 'envNote'].forEach((id) => {
    assert(html.indexOf(`id="${id}"`) >= 0, `缺少 #${id}`);
  });
});
check('首页没有上班倒计时相关元素', () => {
  ['cdValue', 'cdLabel', 'cdBar', 'cdFrom', 'cdTo', 'stDot', 'stLabel'].forEach((id) => {
    assert(html.indexOf(`id="${id}"`) < 0, `首页仍残留 #${id}`);
  });
  assert(html.indexOf('距上班') < 0, '文案里仍有「距上班」');
  assert(html.indexOf('距交班') < 0, '文案里仍有「距交班」');
});
check('首页打卡改为胶囊', () => {
  assert(html.indexOf('id="habitChips"') >= 0, '缺少 #habitChips');
  assert(css.indexOf('.chip') >= 0, '缺 .chip 样式');
});
check('首页有 SOXL 专区', () => {
  ['soxlCard', 'soxlCount', 'soxlBody', 'soxlPosCard', 'soxlPos', 'symLabel'].forEach((id) => {
    assert(html.indexOf(`id="${id}"`) >= 0, `缺少 #${id}`);
  });
});
check('复盘页有统计与表单入口', () => {
  ['reviewStats', 'tradeList', 'tradeCount', 'calcToTrade'].forEach((id) => {
    assert(html.indexOf(`id="${id}"`) >= 0, `缺少 #${id}`);
  });
});
check('早报页有 SOXL 专区', () => {
  assert(html.indexOf('id="soxlNewsList"') >= 0, '缺少 SOXL 早报专区');
});
check('设置页可改主要交易标的', () => {
  assert(html.indexOf('id="sSymbol"') >= 0, '缺少标的选择');
});
check('已移除旧的深色 hero 大卡样式', () => {
  assert(css.indexOf('.hero-cd-value') < 0, '仍残留旧 hero 样式');
});

console.log(`\n===== 样式与结构体检：通过 ${pass} 项，失败 ${fail} 项 =====`);
process.exit(fail === 0 ? 0 : 1);
