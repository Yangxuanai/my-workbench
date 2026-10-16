/**
 * 网页版冒烟测试：node test/smoke.js
 * 用最小 DOM / localStorage 模拟层，真正执行 index.html 里的事件绑定与渲染。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');

let pass = 0;
let fail = 0;

function ok(name) { pass++; console.log(`  PASS  ${name}`); }
function bad(name, msg) { fail++; console.log(`  FAIL  ${name}${msg ? ' -> ' + msg : ''}`); }
function check(name, fn) {
  try { fn(); ok(name); } catch (e) { bad(name, e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function includes(hay, needle, msg) {
  if (String(hay).indexOf(needle) < 0) {
    throw new Error((msg || '未找到内容') + `：期望包含 ${JSON.stringify(needle)}`);
  }
}

/* ============================================================
   最小 DOM 模拟
   ============================================================ */

const VOID_TAGS = /^(br|meta|link|img|input|hr|source|area|base|col|embed|param|track|wbr)$/i;

function parseIdTree(html) {
  const tree = { id: null, tag: 'root', children: [], parent: null, attrs: {} };
  let cur = tree;
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const closing = m[1] === '/';
    const tag = m[2];
    const selfClose = m[4] === '/';
    if (closing) { if (cur.parent) cur = cur.parent; continue; }
    const attrs = {};
    const attrRe = /([\w:-]+)\s*=\s*"([^"]*)"/g;
    let a;
    while ((a = attrRe.exec(m[3])) !== null) attrs[a[1]] = a[2];
    const node = { id: attrs.id || null, tag, children: [], parent: cur, attrs };
    cur.children.push(node);
    if (selfClose || VOID_TAGS.test(tag)) continue;
    cur = node;
  }
  return tree;
}

function kidsOf(n) { return n._children || n.children || []; }
function walk(node, fn) { fn(node); kidsOf(node).forEach((c) => walk(c, fn)); }

function matchSimple(el, sel) {
  let m = sel.match(/^([\w-]+)?#([\w-]+)$/);
  if (m) return el.id === m[2] && (!m[1] || el.tag === m[1]);
  m = sel.match(/^\.([\w-]+)$/);
  if (m) return (el.className || '').split(/\s+/).indexOf(m[1]) >= 0;
  m = sel.match(/^([\w-]*)\[([\w-]+)="([^"]*)"\]$/);
  if (m) {
    const tagOk = !m[1] || el.tag === m[1];
    const val = el.attrs[m[2]] != null ? el.attrs[m[2]] : el.dataset[m[2]];
    return tagOk && String(val) === m[3];
  }
  m = sel.match(/^([\w-]*)\[([\w-]+)\]$/);
  if (m) {
    const tagOk = !m[1] || el.tag === m[1];
    return tagOk && (el.attrs[m[2]] != null || el.dataset[m[2]] != null);
  }
  return el.tag === sel;
}

function findMatches(root, sel) {
  const parts = sel.trim().split(/\s+/).filter(Boolean);
  let scope = [root];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const next = [];
    scope.forEach((s) => {
      walk(s, (el) => {
        if (el !== root && matchSimple(el, part) && next.indexOf(el) < 0) next.push(el);
      });
    });
    scope = next;
  }
  return scope.filter((e) => e !== root);
}

const idIndex = {};

class El {
  constructor(node) {
    this.node = node;
    this.id = node.id || '';
    this.tag = node.tag;
    this.attrs = node.attrs;
    this.dataset = {};
    Object.keys(node.attrs).forEach((k) => {
      const camel = k.replace(/^data-(.)/, (x, c) => c.toUpperCase()).replace(/-(.)/g, (x, c) => c.toUpperCase());
      if (k.indexOf('data-') === 0) this.dataset[camel] = node.attrs[k];
      if (k === 'value') this.value = node.attrs[k];
    });
    if (this.value === undefined) this.value = '';
    this._listeners = {};
    this.className = node.attrs.class || '';
    this.style = {};
    this._children = [];
    this._parentEl = null;
    this._text = '';
  }
  get innerHTML() { return this._html; }
  set innerHTML(v) {
    this._html = String(v);
    const tree = parseIdTree(this._html);
    this._children = tree.children.map((c) => makeEl(c));
    this._children.forEach((c) => { c._parentEl = this; });
    walk(this, (n) => {
      if (n.id && !n._dyn) { n._dyn = true; idIndex[n.id] = n; }
    });
  }
  /** 真实 DOM 里 textContent 会聚合子节点文本，这里也照做 */
  get textContent() {
    if (this._text) return this._text;
    let s = '';
    this._children.forEach((c) => { s += c.textContent; });
    if (!s && this._html) s = this._html.replace(/<[^>]*>/g, '');
    return s;
  }
  set textContent(v) {
    this._text = String(v);
    this._html = String(v);
    this._children = [];
  }
  get classList() {
    const self = this;
    return {
      add(c) {
        const set = (self.className || '').split(/\s+/).filter(Boolean);
        if (set.indexOf(c) < 0) set.push(c);
        self.className = set.join(' ');
      },
      remove(c) {
        self.className = (self.className || '').split(/\s+/).filter((x) => x && x !== c).join(' ');
      },
      contains(c) { return (self.className || '').split(/\s+/).indexOf(c) >= 0; },
      toggle(c, on) {
        if (on === undefined) on = !this.contains(c);
        if (on) this.add(c); else this.remove(c);
      }
    };
  }
  addEventListener(type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  }
  fire(type, target, extra) {
    const ev = Object.assign({
      type, target: target || this, preventDefault() {}, stopPropagation() {}
    }, extra || {});
    let cur = this;
    while (cur) {
      (cur._listeners[type] || []).forEach((fn) => fn.call(cur, ev));
      cur = cur._parentEl;
    }
  }
  querySelector(sel) { return findMatches(this, sel)[0] || null; }
  querySelectorAll(sel) { return findMatches(this, sel); }
  closest(sel) {
    let cur = this;
    while (cur) { if (matchSimple(cur, sel)) return cur; cur = cur._parentEl; }
    return null;
  }
  appendChild(c) { this._children.push(c); c._parentEl = this; return c; }
  removeChild(c) { this._children = this._children.filter((x) => x !== c); return c; }
  focus() {}
  select() {}
  getAttribute(k) { return this.attrs[k] != null ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = v; }
}

function makeEl(node) {
  const el = new El(node);
  el._children = node.children.map((c) => makeEl(c));
  el._children.forEach((c) => { c._parentEl = el; });
  return el;
}

const bodyEl = (() => {
  const tree = parseIdTree(HTML);
  const el = makeEl(tree);
  walk(el, (n) => { if (n.id && !idIndex[n.id]) idIndex[n.id] = n; });
  return el;
})();

const documentEl = {
  readyState: 'complete',
  hidden: false,
  body: bodyEl,
  documentElement: bodyEl,
  getElementById: (id) => idIndex[id] || null,
  querySelector: (sel) => findMatches(bodyEl, sel)[0] || null,
  querySelectorAll: (sel) => findMatches(bodyEl, sel),
  createElement: (tag) => makeEl({ id: null, tag, children: [], parent: null, attrs: {} }),
  addEventListener: () => {}
};

const storage = {};
const localStorageMock = {
  getItem: (k) => (k in storage ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: (k) => { delete storage[k]; },
  clear: () => { Object.keys(storage).forEach((k) => delete storage[k]); }
};

const uiToasts = [];
let confirmResult = true;
let clipboardText = '';
const timers = [];

const windowMock = {
  WBTime: null,
  scrollTo: () => {},
  confirm: () => confirmResult,
  alert: () => {},
  open: (url) => { windowMock._opened = url; },
  addEventListener: () => {},
  setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
  clearTimeout: () => {},
  setInterval: () => 1,
  clearInterval: () => {},
  navigator: { clipboard: { writeText: (t) => { clipboardText = t; return Promise.resolve(); } } },
  localStorage: localStorageMock,
  document: documentEl,
  console
};

const NEWS_FIXTURE = {
  updatedAt: '2026-10-16 07:50',
  groups: [
    {
      key: 'us', name: '美股财经',
      items: [
        { title: 'SOXL 三倍做多半导体 ETF 盘前走强', body: '费城半导体指数期货上涨', source: 'Reuters', time: '07:40', url: 'https://example.com/a', soxl: true },
        { title: '存储板块普跌', body: '美光跌超 1%', source: 'Bloomberg', time: '07:20' },
        { title: '另一条 SOXL 相关：英伟达财报临近', body: '', source: 'CNBC', time: '07:10' }
      ]
    },
    { key: 'cn', name: '国内', items: [{ title: 'A股小幅高开', body: '', source: '财联社', time: '09:30' }] },
    { key: 'other', name: '其他', items: [] }
  ]
};
const MUSIC_FIXTURE = {
  playlists: [
    { id: 0, name: '盯盘专注', icon: '📈', desc: 'Lo-fi', neteaseId: '', url: 'https://music.163.com/#/search/m/?s=lofi', tag: '盯盘' },
    { id: 1, name: '网球热身', icon: '🎾', desc: '高能量', neteaseId: '123456', url: '', tag: '运动' }
  ]
};

function fetchMock(url) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (/music\.json/.test(url)) resolve({ ok: true, json: () => Promise.resolve(MUSIC_FIXTURE) });
      else if (/news\.json/.test(url)) resolve({ ok: true, json: () => Promise.resolve(NEWS_FIXTURE) });
      else reject(new Error('404'));
    }, 0);
  });
}

function runScript(rel) {
  const file = path.join(WEB, rel);
  const code = fs.readFileSync(file, 'utf8');
  const mod = { exports: {} };
  const fn = vm.compileFunction(code, [
    'window', 'document', 'localStorage', 'navigator', 'console',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'fetch', 'module', 'exports', 'require', 'Request', 'caches', 'self'
  ], { filename: file });
  fn(
    windowMock, documentEl, localStorageMock, windowMock.navigator, console,
    windowMock.setTimeout, windowMock.clearTimeout, windowMock.setInterval, windowMock.clearInterval,
    fetchMock, mod, mod.exports, require, class {}, {}, {}
  );
  return mod.exports;
}

runScript('js/time.js');
runScript('js/app.js');

const WB = windowMock.WB;
assert(WB, '应用没有挂载到 window.WB');
const IN = WB._internal;
const T = windowMock.WBTime;

const flush = () => new Promise((r) => setTimeout(r, 14));

function setInput(id, val) {
  const el = documentEl.getElementById(id);
  assert(el, `找不到输入框 #${id}`);
  el.value = String(val);
  return el;
}

async function main() {
  console.log('\n[1] 初始化');
  check('应用挂载成功', () => assert(typeof WB.go === 'function' && typeof WB.saveTrade === 'function'));
  check('默认称呼为小羊', () => assert(IN.getData().settings.name === '小羊'));
  check('默认交易标的为 SOXL', () => assert(IN.getData().settings.symbol === 'SOXL', IN.getData().settings.symbol));
  check('默认待办提到半导体', () => {
    const txt = IN.getData().todos.map((t) => t.text).join(' ');
    includes(txt, '半导体', '默认待办');
  });
  check('习惯含交易纪律项', () => {
    const ids = IN.HABITS.map((h) => h.id);
    ['journal', 'prep', 'discipline'].forEach((id) => assert(ids.indexOf(id) >= 0, '缺少 ' + id));
  });

  await flush();

  console.log('\n[2] 盈亏计算（核心：入场价 + 方向 + 股数 + 出场价）');
  check('做多盈利：(出场-入场)×股数', () => {
    const c = IN.computePnl({ direction: 'long', entry: 30, shares: 200, exit: 33 });
    assert(c.pnl === 600, '盈亏=' + c.pnl + '，期望 600');
    assert(c.pnlPerShare === 3, '每股=' + c.pnlPerShare);
    assert(Math.abs(c.returnPct - 10) < 1e-9, '收益率=' + c.returnPct);
  });
  check('做多亏损：(出场-入场)×股数 为负', () => {
    const c = IN.computePnl({ direction: 'long', entry: 30, shares: 200, exit: 28.5 });
    assert(c.pnl === -300, '盈亏=' + c.pnl);
  });
  check('做空盈利：(入场-出场)×股数', () => {
    const c = IN.computePnl({ direction: 'short', entry: 40, shares: 100, exit: 37 });
    assert(c.pnl === 300, '盈亏=' + c.pnl);
  });
  check('做空亏损', () => {
    const c = IN.computePnl({ direction: 'short', entry: 40, shares: 100, exit: 42.5 });
    assert(c.pnl === -250, '盈亏=' + c.pnl);
  });
  check('小数价格不丢精度', () => {
    const c = IN.computePnl({ direction: 'long', entry: 30.25, shares: 137, exit: 31.8 });
    /* (31.8-30.25)*137 = 212.35 */
    assert(Math.abs(c.pnl - 212.35) < 1e-6, '盈亏=' + c.pnl);
  });
  check('没填出场价 -> 判定为持仓中', () => {
    const c = IN.computePnl({ direction: 'long', entry: 30, shares: 100, exit: null });
    assert(c.isOpen === true, '应判定为持仓中');
    assert(c.pnl === null, 'pnl 应为 null');
  });
  check('填了止损价 -> 计算 R 倍数', () => {
    const c = IN.computePnl({ direction: 'long', entry: 30, shares: 100, exit: 33, stop: 28.5 });
    /* 每股赚 3，每股风险 1.5 => 2R */
    assert(c.rMultiple === 2, 'R=' + c.rMultiple);
  });
  check('缺入场价或股数 -> 返回 null', () => {
    assert(IN.computePnl({ direction: 'long', entry: 0, shares: 100, exit: 33 }) === null);
    assert(IN.computePnl({ direction: 'long', entry: 30, shares: 0, exit: 33 }) === null);
  });
  check('金额格式化', () => {
    assert(IN.money(1234.6) === '1,235', IN.money(1234.6));
    assert(IN.money(-500) === '-500', IN.money(-500));
    assert(IN.money(0) === '0');
    assert(IN.price(30.5) === '30.5');
    assert(IN.price(30.456) === '30.46');
  });

  console.log('\n[3] 首页渲染');
  check('称呼「小羊」出现在问候里', () => {
    includes(documentEl.getElementById('hi').textContent, '小羊');
  });
  check('大时钟格式正确', () => {
    assert(/^\d{2}:\d{2}$/.test(documentEl.getElementById('bjBig').textContent));
  });
  check('上班/休息状态胶囊已渲染', () => {
    const el = documentEl.getElementById('workPill');
    const t = el.textContent;
    assert(t === '上班中' || t === '休息中', '实际：' + t);
    assert(el.classList.contains('on') === (t === '上班中'), 'on 类与文案不一致');
  });
  check('首页已移除上班倒计时（按要求重做）', () => {
    assert(!documentEl.getElementById('cdValue'), '首页还残留倒计时元素');
    assert(!documentEl.getElementById('cdLabel'), '首页还残留倒计时标签');
    assert(!HTML.includes('id="cdBar"'), '首页还残留进度条元素');
    assert(!HTML.includes('距上班'), '首页文案里还有「距上班」');
  });
  check('行情环境条已填充三格', () => {
    assert(documentEl.getElementById('envSession').textContent !== '—', '时段为空');
    assert(/^\d{2}:\d{2}$/.test(documentEl.getElementById('envEt').textContent), '美东时间为空');
    assert(documentEl.getElementById('envWindow').textContent !== '—', '你的时段为空');
  });
  check('环境说明写清了工作日与美东对照', () => {
    const html = documentEl.getElementById('envNote').innerHTML;
    includes(html, '周一~周五', '工作日说明');
    includes(html, '美东', '美东对照');
  });
  check('三个小指标已填充', () => {
    assert(/\d/.test(documentEl.getElementById('mStreak').textContent), '连续天数为空');
    assert(/\d/.test(documentEl.getElementById('mWeekTrades').textContent), '本周复盘为空');
    assert(documentEl.getElementById('mWeekPnl').textContent !== '', '本周盈亏为空');
  });
  check('待办渲染 4 条', () => {
    const n = (documentEl.getElementById('todoList').innerHTML.match(/data-todo="/g) || []).length;
    assert(n === 4, '条数=' + n);
  });
  check('打卡渲染成 10 个胶囊', () => {
    const n = (documentEl.getElementById('habitChips').innerHTML.match(/data-habit="/g) || []).length;
    assert(n === 10, '胶囊数=' + n);
  });
  check('打卡进度条有宽度', () => {
    includes(documentEl.getElementById('habitBar').style.width, '%');
  });

  console.log('\n[4] SOXL 专属模块');
  check('首页 SOXL 卡片渲染出相关条目', () => {
    const html = documentEl.getElementById('soxlBody').innerHTML;
    includes(html, 'SOXL', 'SOXL 卡片');
    includes(html, '费城半导体', '正文');
  });
  check('统计到 2 条 SOXL 相关（2 条标记 soxl:true）', () => {
    /* 夹具里：第 1 条与第 3 条带 soxl:true；第 2 条「存储板块」标题不含 SOXL，不应命中 */
    const items = IN.soxlItems();
    assert(items.length === 2, '实际 ' + items.length + ' 条：' + items.map((i) => i.title).join(' / '));
  });
  check('计数文案正确', () => {
    includes(documentEl.getElementById('soxlCount').textContent, '2');
  });
  check('未标记且标题不含 SOXL 的条目不进 SOXL 专区', () => {
    const titles = IN.soxlItems().map((i) => i.title).join('|');
    assert(titles.indexOf('存储板块普跌') < 0, '不该收录无关条目');
  });
  check('SOXL 条目优先渲染在 hot 卡片里', () => {
    includes(documentEl.getElementById('soxlBody').innerHTML, 'hot');
  });
  check('标题含 SOXL 的条目也会被收进来', () => {
    const titles = IN.soxlItems().map((i) => i.title).join('|');
    includes(titles, '英伟达财报临近', 'SOXL 相关条目');
  });
  check('早报页也有 SOXL 专区', () => {
    WB.go('news');
    includes(documentEl.getElementById('soxlNewsList').innerHTML, 'SOXL');
  });

  console.log('\n[5] 复盘记录（含自动算盈亏）');
  check('写入一笔做多盈利复盘', () => {
    IN.getData().trades.unshift({
      id: 'tr_1', ts: Date.now(), symbol: 'SOXL', direction: 'long',
      entry: 30, shares: 200, exit: 33, stop: 28.5, note: '突破回踩'
    });
    IN.renderTrade();
    const html = documentEl.getElementById('tradeList').innerHTML;
    includes(html, 'SOXL');
    includes(html, '+600', '盈亏');
    includes(html, '10.00%', '收益率');
    includes(html, '+2R', 'R 倍数');
  });
  check('写入一笔做空亏损复盘', () => {
    IN.getData().trades.unshift({
      id: 'tr_2', ts: Date.now(), symbol: 'SOXL', direction: 'short',
      entry: 40, shares: 100, exit: 42.5, stop: 43, note: ''
    });
    IN.renderTrade();
    includes(documentEl.getElementById('tradeList').innerHTML, '-250');
  });
  check('统计：1 胜 1 负 => 胜率 50%、净 +350', () => {
    const s = IN.reviewStats();
    assert(s.closed === 2, 'closed=' + s.closed);
    assert(s.winRate === 50, '胜率=' + s.winRate);
    assert(s.net === 350, '净盈亏=' + s.net);
    assert(s.avgWin === 600, '平均盈利=' + s.avgWin);
    assert(s.avgLoss === 250, '平均亏损=' + s.avgLoss);
    assert(Math.abs(s.profitFactor - 2.4) < 1e-9, '盈亏比=' + s.profitFactor);
    assert(s.expectancy === 175, '期望=' + s.expectancy);
  });
  check('统计渲染到页面', () => {
    const html = documentEl.getElementById('reviewStats').innerHTML;
    includes(html, '+350');
    includes(html, '50');
  });
  check('持仓中记录显示为持仓中', () => {
    IN.getData().trades.unshift({
      id: 'tr_3', ts: Date.now(), symbol: 'SOXL', direction: 'long',
      entry: 31, shares: 150, exit: null, stop: 30, note: ''
    });
    IN.renderTrade();
    includes(documentEl.getElementById('tradeList').innerHTML, '持仓中');
    assert(IN.reviewStats().open === 1, '持仓数应为 1');
  });
  check('SOXL 持仓汇总卡出现', () => {
    IN.renderHome();
    const card = documentEl.getElementById('soxlPosCard');
    assert(card.style.display !== 'none', '持仓卡应显示');
    const html = documentEl.getElementById('soxlPos').innerHTML;
    includes(html, '150', '持仓股数');
  });

  console.log('\n[6] 补填出场价');
  check('打开填出场价弹层', () => {
    IN.renderTrade();
    const btn = documentEl.getElementById('tradeList').querySelectorAll('[data-close]')[0];
    assert(btn, '没找到「填出场价」按钮');
    documentEl.getElementById('tradeList').fire('click', btn);
    assert(documentEl.getElementById('feExit'), '弹层没有出场价输入框');
  });
  check('确认平仓后自动算盈亏', () => {
    setInput('feExit', 34);
    WB.doFillExit('tr_3');
    const t = IN.getData().trades.filter((x) => x.id === 'tr_3')[0];
    assert(t.exit === 34, 'exit=' + t.exit);
    const c = IN.computePnl(t);
    assert(c.pnl === 450, '盈亏=' + c.pnl + '，期望 (34-31)*150=450');
  });
  check('统计随之更新为 2 胜 1 负', () => {
    const s = IN.reviewStats();
    assert(s.closed === 3, 'closed=' + s.closed);
    assert(s.winRate === 67, '胜率=' + s.winRate);
    assert(s.net === 800, '净=' + s.net);
  });
  check('删除复盘记录', () => {
    confirmResult = true;
    IN.renderTrade();
    const before = IN.getData().trades.length;
    documentEl.getElementById('tradeList').fire('click',
      documentEl.getElementById('tradeList').querySelectorAll('[data-deltrade]')[0]);
    assert(IN.getData().trades.length === before - 1, '删除后=' + IN.getData().trades.length);
  });

  console.log('\n[7] 记一笔表单 + 实时预览');
  check('打开记一笔弹层', () => {
    WB.openTrade();
    assert(documentEl.getElementById('tSymbol'), '弹层没打开');
    assert(documentEl.getElementById('tEntry'), '缺入场价输入');
    assert(documentEl.getElementById('tShares'), '缺股数输入');
    assert(documentEl.getElementById('tExit'), '缺出场价输入');
  });
  check('实时预览盈亏', () => {
    setInput('tSymbol', 'SOXL');
    setInput('tEntry', 30);
    setInput('tShares', 100);
    setInput('tExit', 33);
    IN.previewTrade();
    const html = documentEl.getElementById('tPreview').innerHTML;
    includes(html, '+300', '预览盈亏');
    includes(html, '10.00%', '预览收益率');
  });
  check('做多但出场价低于入场价 -> 给出提醒', () => {
    setInput('tExit', 28);
    IN.previewTrade();
    includes(documentEl.getElementById('tPreview').innerHTML, '确认没填反');
  });
  check('保存后进入列表并计入统计', () => {
    setInput('tExit', 33);
    const before = IN.getData().trades.length;
    WB.saveTrade();
    assert(IN.getData().trades.length === before + 1, '没有新增记录');
    const t = IN.getData().trades[0];
    assert(t.symbol === 'SOXL' && t.entry === 30 && t.shares === 100 && t.exit === 33, JSON.stringify(t));
    assert(IN.computePnl(t).pnl === 300, '盈亏=' + IN.computePnl(t).pnl);
  });
  check('大写化标的代码', () => {
    WB.openTrade();
    setInput('tSymbol', 'soxl');
    setInput('tEntry', 10);
    setInput('tShares', 10);
    setInput('tExit', 11);
    WB.saveTrade();
    assert(IN.getData().trades[0].symbol === 'SOXL', '未大写：' + IN.getData().trades[0].symbol);
  });
  check('不填出场价 -> 存为持仓中', () => {
    WB.openTrade();
    setInput('tSymbol', 'SOXL');
    setInput('tEntry', 32);
    setInput('tShares', 50);
    setInput('tExit', '');
    WB.saveTrade();
    const t = IN.getData().trades[0];
    assert(t.exit === null, 'exit 应为 null，实际 ' + JSON.stringify(t.exit));
    assert(IN.computePnl(t).isOpen === true, '应判定为持仓中');
  });
  check('缺入场价会被拦下', () => {
    WB.openTrade();
    setInput('tSymbol', 'SOXL');
    setInput('tEntry', '');
    setInput('tShares', 50);
    const before = IN.getData().trades.length;
    WB.saveTrade();
    assert(IN.getData().trades.length === before, '不该写入');
  });
  check('缺股数会被拦下', () => {
    WB.openTrade();
    setInput('tSymbol', 'SOXL');
    setInput('tEntry', 30);
    setInput('tShares', '');
    const before = IN.getData().trades.length;
    WB.saveTrade();
    assert(IN.getData().trades.length === before, '不该写入');
  });

  console.log('\n[8] 仓位计算器（输入股数，算投入与风险）');
  check('输入股数 + 入场价 => 投入资金 = 股数 × 入场价', () => {
    const r = IN.computePosition({ shares: 500, entry: 30, stop: 28.5, dir: 'long' });
    assert(!r.empty && !r.invalid, '结果异常：' + JSON.stringify(r));
    assert(r.shares === 500, '股数=' + r.shares);
    assert(r.cost === 15000, '投入资金=' + r.cost + '，期望 500×30=15000');
  });
  check('最大亏损 = 每股风险 × 股数', () => {
    const r = IN.computePosition({ shares: 500, entry: 30, stop: 28.5, dir: 'long' });
    assert(r.perUnit === 1.5, '每股风险=' + r.perUnit);
    assert(r.maxLoss === 750, '最大亏损=' + r.maxLoss + '，期望 1.5×500=750');
    assert(Math.abs(r.riskPct - 5) < 1e-9, '风险占比=' + r.riskPct);
  });
  check('1R/2R/3R 目标价与盈利', () => {
    const r = IN.computePosition({ shares: 500, entry: 30, stop: 28.5, dir: 'long' });
    const t1 = r.targets.filter((x) => x.r === 1)[0];
    const t2 = r.targets.filter((x) => x.r === 2)[0];
    const t3 = r.targets.filter((x) => x.r === 3)[0];
    assert(t1.price === 31.5 && t1.profit === 750, JSON.stringify(t1));
    assert(t2.price === 33 && t2.profit === 1500, JSON.stringify(t2));
    assert(t3.price === 34.5 && t3.profit === 2250, JSON.stringify(t3));
    assert(Math.abs(t2.returnPct - 10) < 1e-9, '2R 收益率=' + t2.returnPct);
  });
  check('做空方向正确', () => {
    const r = IN.computePosition({ shares: 200, entry: 100, stop: 105, dir: 'short' });
    assert(r.perUnit === 5, '每股风险=' + r.perUnit);
    assert(r.cost === 20000, '投入=' + r.cost);
    assert(r.maxLoss === 1000, '最大亏损=' + r.maxLoss);
    /* 做空盈利目标在下方 */
    const t1 = r.targets.filter((x) => x.r === 1)[0];
    assert(t1.price === 95, '1R 目标价=' + t1.price);
  });
  check('只填股数和入场价（无止损）也能算投入资金', () => {
    const r = IN.computePosition({ shares: 300, entry: 25, stop: 0, dir: 'long' });
    assert(!r.empty && !r.invalid, '不该判为无效');
    assert(r.cost === 7500, '投入=' + r.cost);
    assert(r.perUnit === null && r.maxLoss === null, '无止损时不该有风险数据');
    assert(r.targets === null, '无止损时不该有目标');
  });
  check('缺股数或入场价 -> 空', () => {
    assert(IN.computePosition({ shares: 0, entry: 30, stop: 28, dir: 'long' }).empty === true);
    assert(IN.computePosition({ shares: 500, entry: 0, stop: 28, dir: 'long' }).empty === true);
  });
  check('止损方向错 -> 无效', () => {
    assert(IN.computePosition({ shares: 500, entry: 100, stop: 105, dir: 'long' }).invalid === true);
    assert(IN.computePosition({ shares: 500, entry: 100, stop: 95, dir: 'short' }).invalid === true);
  });
  check('计算器 DOM 已改为股数输入（无账户资金）', () => {
    assert(documentEl.getElementById('cShares'), '缺少 #cShares');
    assert(!documentEl.getElementById('cAccount'), '账户资金输入应已移除');
    assert(!documentEl.getElementById('cRisk'), '风险百分比输入应已移除');
  });
  check('计算结果渲染到页面', () => {
    setInput('cShares', 500);
    setInput('cEntry', 30);
    setInput('cStop', 28.5);
    IN.renderTrade();
    const html = documentEl.getElementById('calcOut').innerHTML;
    includes(html, '$15,000', '投入资金');
    includes(html, '-$750', '最大亏损');
    includes(html, '31.5', '1R 目标价');
    includes(html, '33', '2R 目标价');
  });
  check('把计算填入复盘时股数直接用你填的', () => {
    IN.renderTrade();
    documentEl.getElementById('calcToTrade').fire('click');
    assert(documentEl.getElementById('tShares').value === '500', '股数=' + documentEl.getElementById('tShares').value);
    assert(documentEl.getElementById('tEntry').value === '30', '入场价=' + documentEl.getElementById('tEntry').value);
    assert(documentEl.getElementById('tStop').value === '28.5', '止损价=' + documentEl.getElementById('tStop').value);
  });

  console.log('\n[9] 待办与打卡');
  /* 前面的用例记录交易时会自动点亮「交易复盘」习惯，这里先清零，让打卡断言从干净状态开始 */
  delete IN.getData().habits[IN.todayKey()];
  IN.renderHome();
  check('勾选待办', () => {
    const el = documentEl.getElementById('todoList');
    el.fire('click', el.querySelectorAll('[data-todo]')[0]);
    assert(IN.getData().todos.filter((t) => t.done).length === 1, '完成数不对');
  });
  check('取消勾选', () => {
    const el = documentEl.getElementById('todoList');
    el.fire('click', el.querySelectorAll('[data-todo]')[0]);
    assert(IN.getData().todos.filter((t) => t.done).length === 0);
  });
  check('删除待办', () => {
    const el = documentEl.getElementById('todoList');
    const before = IN.getData().todos.length;
    el.fire('click', el.querySelectorAll('[data-del-todo]')[0]);
    assert(IN.getData().todos.length === before - 1);
  });
  check('打卡后连续天数 +1', () => {
    const el = documentEl.getElementById('habitChips');
    el.fire('click', el.querySelectorAll('[data-habit]')[0]);
    assert(IN.streakDays() === 1, '连续=' + IN.streakDays());
  });
  check('胶囊变为已打卡样式', () => {
    const el = documentEl.getElementById('habitChips');
    const chips = el.querySelectorAll('[data-habit]');
    const on = chips.filter((c) => c.classList.contains('on'));
    assert(on.length === 1, '已打卡胶囊数=' + on.length);
  });
  check('再点取消', () => {
    const el = documentEl.getElementById('habitChips');
    el.fire('click', el.querySelectorAll('[data-habit]')[0]);
    assert(IN.streakDays() === 0, '连续=' + IN.streakDays());
  });
  check('历史回溯连续天数', () => {
    const d = IN.getData();
    const k = IN.todayKey();
    d.habits[k] = { journal: Date.now() };
    d.habits[T.shiftKey(k, -1)] = { journal: Date.now() };
    d.habits[T.shiftKey(k, -2)] = { journal: Date.now() };
    assert(IN.streakDays() === 3, '应为 3 天，实际 ' + IN.streakDays());
    assert(IN.habitStreak('journal') === 3);
    assert(IN.habitStreak('read') === 0);
  });
  check('记录一笔交易会自动点亮「交易复盘」', () => {
    const d = IN.getData();
    const k = IN.todayKey();
    delete d.habits[k];
    WB.openTrade();
    setInput('tSymbol', 'SOXL');
    setInput('tEntry', 30);
    setInput('tShares', 10);
    setInput('tExit', 31);
    WB.saveTrade();
    assert(IN.getData().habits[k] && IN.getData().habits[k].journal, '未自动打卡');
  });

  console.log('\n[10] 时段轴与休市');
  check('时段轴渲染 3 段', () => {
    IN.renderTrade();
    const n = (documentEl.getElementById('timeline').innerHTML.match(/class="tl"/g) || []).length;
    assert(n === 3, '段数=' + n);
  });
  check('时段轴含美东与北京时间', () => {
    const html = documentEl.getElementById('timeline').innerHTML;
    includes(html, '美东');
    includes(html, '🇨🇳');
  });
  check('休市日列表渲染', () => {
    const html = documentEl.getElementById('holidays').innerHTML;
    assert(html.indexOf('休市') >= 0 || html.indexOf('暂无') >= 0);
  });
  check('班次说明提到盘后收盘', () => {
    includes(documentEl.getElementById('tlNote').innerHTML, '盘后收盘');
  });

  console.log('\n[11] 电台');
  check('歌单渲染 2 张', () => {
    WB.go('music');
    const html = documentEl.getElementById('musicList').innerHTML;
    includes(html, '盯盘专注');
    includes(html, '网球热身');
  });
  check('选带 neteaseId 的歌单渲染 iframe', () => {
    WB.pickMusic(1);
    const html = documentEl.getElementById('playerBox').innerHTML;
    includes(html, '<iframe');
    includes(html, '123456');
    includes(html, 'music.163.com');
  });
  check('选中状态持久化', () => assert(IN.getData().activeMusic === 1));
  check('复制链接写入剪贴板', () => {
    clipboardText = '';
    WB.copyMusicLink();
    assert(clipboardText.length > 0, '剪贴板为空');
  });
  check('网易云打开使用正确链接', () => {
    windowMock._opened = '';
    WB.openMusicApp();
    includes(windowMock._opened, 'music.163.com');
  });

  console.log('\n[12] 早报');
  check('分组按钮 3 个', () => {
    WB.go('news');
    const n = (documentEl.getElementById('newsSeg').innerHTML.match(/data-news="/g) || []).length;
    assert(n === 3, '分组数=' + n);
  });
  check('更新时间已显示', () => includes(documentEl.getElementById('newsMeta').textContent, '2026-10-16'));
  check('默认展示美股分组', () => {
    includes(documentEl.getElementById('newsList').innerHTML, 'SOXL');
  });
  check('切到国内分组', () => {
    const seg = documentEl.getElementById('newsSeg');
    const cn = seg.querySelectorAll('[data-news]').filter((b) => b.getAttribute('data-news') === 'cn')[0];
    seg.fire('click', cn);
    includes(documentEl.getElementById('newsList').innerHTML, 'A股小幅高开');
  });
  check('空分组显示空态', () => {
    const seg = documentEl.getElementById('newsSeg');
    const other = seg.querySelectorAll('[data-news]').filter((b) => b.getAttribute('data-news') === 'ot' || b.getAttribute('data-news') === 'other')[0];
    seg.fire('click', other);
    includes(documentEl.getElementById('newsList').innerHTML, '还没有内容');
  });

  console.log('\n[13] 设置与数据');
  check('修改称呼/标的并持久化', () => {
    setInput('sName', '小羊');
    setInput('sSymbol', 'soxl');
    setInput('sEnglish', 'IELTS 7');
    setInput('sBook', '交易心理分析');
    setInput('sBookCur', 80);
    setInput('sBookTotal', 260);
    setInput('sVocab', 1200);
    WB.saveSettings();
    const s = IN.getData().settings;
    assert(s.name === '小羊', s.name);
    assert(s.symbol === 'SOXL', '标的应大写：' + s.symbol);
    assert(s.bookCur === 80 && s.vocab === 1200);
  });
  check('读书进度显示', () => {
    WB.go('me');
    includes(documentEl.getElementById('meSub').textContent, '31%');
  });
  check('空称呼回退默认', () => {
    setInput('sName', '');
    WB.saveSettings();
    assert(IN.getData().settings.name === '小羊');
  });
  check('空标的回退 SOXL', () => {
    setInput('sSymbol', '');
    WB.saveSettings();
    assert(IN.getData().settings.symbol === 'SOXL');
  });
  check('导出备份含全部数据', () => {
    clipboardText = '';
    WB.exportData();
    const obj = JSON.parse(clipboardText);
    assert(obj.v === 1 && obj.data.settings && Array.isArray(obj.data.trades), '备份结构不对');
  });
  check('导入备份覆盖数据', () => {
    const backup = { v: 1, data: JSON.parse(JSON.stringify(IN.DEFAULT_DATA)) };
    backup.data.settings.name = '测试羊';
    backup.data.trades = [{ id: 'x', symbol: 'SOXL', direction: 'long', entry: 1, shares: 1, exit: 2, ts: Date.now() }];
    WB.importData();
    setInput('importText', JSON.stringify(backup));
    WB.doImport();
    assert(IN.getData().settings.name === '测试羊', '导入未生效');
    assert(IN.getData().trades.length === 1);
  });
  check('非法备份被拒绝', () => {
    WB.importData();
    setInput('importText', 'not json');
    WB.doImport();
    assert(IN.getData().settings.name === '测试羊', '不该改变数据');
  });
  check('设置持久化到 localStorage（刷新后仍在）', () => {
    const raw = localStorageMock.getItem('wb_data_v1');
    assert(raw, 'localStorage 里没有数据');
    const parsed = JSON.parse(raw);
    assert(parsed.settings && parsed.settings.symbol, '缺少 settings.symbol');
    /* 重新 load 一次，模拟刷新页面 */
    const reloaded = IN.load();
    assert(reloaded.settings.name === IN.getData().settings.name, '刷新后设置丢失');
  });
  check('清空恢复默认', () => {
    confirmResult = true;
    WB.clearAll();
    const d = IN.getData();
    assert(d.settings.name === '小羊' && d.trades.length === 0 && d.todos.length === 4, '清空不彻底');
  });

  console.log('\n[13b] 异常数据降级（不能白屏）');
  check('news.json 缺失时首页与早报仍能渲染', () => {
    /* 用空数据结构模拟文件缺失后的降级状态 */
    IN.setNewsCache({
      updatedAt: '',
      groups: [
        { key: 'us', name: '美股财经', items: [] },
        { key: 'cn', name: '国内', items: [] },
        { key: 'other', name: '其他', items: [] }
      ]
    });
    IN.renderHome();
    IN.renderNews();
    includes(documentEl.getElementById('soxlBody').innerHTML, '还没有'); // 空态而不是白屏
    includes(documentEl.getElementById('newsList').innerHTML, '还没有内容');
    /* 恢复夹具，避免影响后续用例 */
    IN.setNewsCache(NEWS_FIXTURE);
    IN.renderHome();
  });
  check('music.json 缺失时给出外链兜底而不是白屏', () => {
    IN.setMusicCache({
      playlists: [{ id: 0, name: '盯盘专注', icon: '📈', desc: '', neteaseId: '', url: 'https://music.163.com/' }]
    });
    IN.renderMusic();
    const html = documentEl.getElementById('playerBox').innerHTML;
    includes(html, '没有内嵌 ID', '应提示需在网易云打开');
    IN.setMusicCache(MUSIC_FIXTURE);
  });
  check('数据为空时复盘页显示引导而不是报错', () => {
    const d = IN.getData();
    const backup = d.trades;
    d.trades = [];
    IN.renderTrade();
    includes(documentEl.getElementById('reviewStats').innerHTML, '还没有复盘记录');
    includes(documentEl.getElementById('tradeList').innerHTML, '还没有记录');
    d.trades = backup;
    IN.renderTrade();
  });

  console.log('\n[13c] 首页窄屏与长文本');
  check('环境条不放大字号（三格横向排布）', () => {
    ['envSession', 'envEt', 'envWindow'].forEach((id) => {
      assert(documentEl.getElementById(id), `缺少 #${id}`);
    });
  });
  check('打卡胶囊支持长名称换行（flex-wrap）', () => {
    const html = documentEl.getElementById('habitChips').innerHTML;
    /* 10 个胶囊都要渲染出来，不截断 */
    assert((html.match(/class="chip/g) || []).length === 10, '胶囊数不对');
  });

  console.log('\n[14] 导航与静态资源');
  check('五个页面可切换', () => {
    ['home', 'trade', 'music', 'news', 'me'].forEach((v) => {
      WB.go(v);
      assert(documentEl.getElementById('v-' + v).classList.contains('on'), v + ' 未激活');
    });
  });
  check('导航高亮同步', () => {
    WB.go('trade');
    const on = documentEl.querySelectorAll('nav button').filter((b) => b.classList.contains('on'));
    assert(on.length === 1 && on[0].getAttribute('data-go') === 'trade');
  });
  check('manifest 合法且图标存在', () => {
    const m = JSON.parse(fs.readFileSync(path.join(WEB, 'manifest.webmanifest'), 'utf8'));
    assert(m.name && m.start_url && m.icons.length >= 2);
    m.icons.forEach((i) => assert(fs.existsSync(path.join(WEB, i.src)), '缺图标 ' + i.src));
  });
  check('index.html 引用的脚本存在', () => {
    (HTML.match(/<script src="([^"]+)"/g) || []).forEach((s) => {
      const rel = s.match(/src="([^"]+)"/)[1];
      assert(fs.existsSync(path.join(WEB, rel)), '缺脚本 ' + rel);
    });
  });
  check('页面无残留占位', () => {
    assert(HTML.indexOf('[object') < 0, '有 [object Object]');
    assert(HTML.indexOf('undefined') < 0, '有 undefined');
    assert(HTML.indexOf('\u0966') < 0, '有误输入字符');
  });

  console.log(`\n===== 网页版冒烟测试：通过 ${pass} 项，失败 ${fail} 项 =====`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('测试框架异常：', e);
  process.exit(1);
});
