/**
 * 首页内容预览：把 renderHome 真正渲染出来的文字打印出来，人工核对。
 * 运行：node test/preview-home.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');

/* 复用 smoke.js 里的 DOM 模拟：直接 require 它不方便，这里做一份精简版 */
const VOID = /^(br|meta|link|img|input|hr|source|area|base|col|embed|param|track|wbr)$/i;

function parseTree(html) {
  const tree = { id: null, tag: 'root', children: [], parent: null, attrs: {} };
  let cur = tree;
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1] === '/') { if (cur.parent) cur = cur.parent; continue; }
    const attrs = {};
    const ar = /([\w:-]+)\s*=\s*"([^"]*)"/g;
    let a;
    while ((a = ar.exec(m[3])) !== null) attrs[a[1]] = a[2];
    const node = { id: attrs.id || null, tag: m[2], children: [], parent: cur, attrs };
    cur.children.push(node);
    if (m[4] === '/' || VOID.test(m[2])) continue;
    cur = node;
  }
  return tree;
}

const idIndex = {};
function mk(node) {
  const el = {
    id: node.id || '', tag: node.tag, attrs: node.attrs,
    dataset: {}, _html: '', _text: '', _children: [], _parentEl: null, _listeners: {},
    className: node.attrs.class || '', style: {},
    get innerHTML() { return this._html; },
    set innerHTML(v) {
      this._html = String(v);
      const t = parseTree(this._html);
      this._children = t.children.map(mk);
      this._children.forEach((c) => { c._parentEl = el; });
      (function walk(n) { if (n.id) idIndex[n.id] = n; n._children.forEach(walk); })(el);
    },
    get textContent() {
      if (this._text) return this._text;
      let s = '';
      this._children.forEach((c) => { s += c.textContent; });
      if (!s && this._html) s = this._html.replace(/<[^>]*>/g, '');
      return s;
    },
    set textContent(v) { this._text = String(v); this._html = String(v); this._children = []; },
    classList: {
      add(c) { const s = (el.className || '').split(/\s+/).filter(Boolean); if (s.indexOf(c) < 0) s.push(c); el.className = s.join(' '); },
      remove(c) { el.className = (el.className || '').split(/\s+/).filter((x) => x && x !== c).join(' '); },
      contains(c) { return (el.className || '').split(/\s+/).indexOf(c) >= 0; },
      toggle(c, on) { if (on === undefined) on = !el.classList.contains(c); if (on) el.classList.add(c); else el.classList.remove(c); }
    },
    addEventListener(t, f) { (el._listeners[t] = el._listeners[t] || []).push(f); },
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }, appendChild() {}, removeChild() {}, focus() {}, select() {},
    getAttribute(k) { return el.attrs[k] != null ? el.attrs[k] : null; }, setAttribute(k, v) { el.attrs[k] = v; }
  };
  Object.keys(node.attrs).forEach((k) => {
    const camel = k.replace(/^data-(.)/, (x, c) => c.toUpperCase()).replace(/-(.)/g, (x, c) => c.toUpperCase());
    if (k.indexOf('data-') === 0) el.dataset[camel] = node.attrs[k];
    if (k === 'value') el.value = node.attrs[k];
  });
  if (el.value === undefined) el.value = '';
  el._children = node.children.map(mk);
  el._children.forEach((c) => { c._parentEl = el; });
  return el;
}

const bodyEl = (() => {
  const el = mk(parseTree(HTML));
  (function walk(n) { if (n.id && !idIndex[n.id]) idIndex[n.id] = n; n._children.forEach(walk); })(el);
  return el;
})();

const documentEl = {
  readyState: 'complete', hidden: false, body: bodyEl, documentElement: bodyEl,
  getElementById: (id) => idIndex[id] || null,
  querySelector: () => ({ addEventListener() {} }),
  querySelectorAll: () => [],
  createElement: () => mk({ id: null, tag: 'div', children: [], parent: null, attrs: {} }),
  addEventListener: () => {}
};

const storage = {};
const localStorageMock = {
  getItem: (k) => (k in storage ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: (k) => { delete storage[k]; }, clear: () => {}
};

const NEWS = {
  updatedAt: '2026-10-16 07:50',
  groups: [
    { key: 'us', name: '美股财经', items: [
      { title: 'SOXL 盘前走强，费城半导体指数期货上涨', body: '三倍杠杆产品，波动约为半导体的 3 倍，注意仓位与止损。', source: 'Reuters', time: '07:40', url: 'https://example.com/a', soxl: true },
      { title: '存储板块盘前普跌，美光跌超 1%', body: '会拖累费半权重，进而压制 SOXL。', source: '中新经纬', time: '07:35', soxl: true },
      { title: '英伟达财报临近，半导体波动率抬升', body: '', source: 'CNBC', time: '07:20' }
    ] },
    { key: 'cn', name: '国内', items: [{ title: 'A股小幅高开', source: '财联社', time: '09:30' }] },
    { key: 'other', name: '其他', items: [] }
  ]
};

const windowMock = {
  WBTime: null, scrollTo: () => {}, confirm: () => true, alert: () => {}, open: () => {},
  addEventListener: () => {}, setTimeout: () => 1, clearTimeout: () => {},
  setInterval: () => 1, clearInterval: () => {},
  navigator: {}, localStorage: localStorageMock, document: documentEl, console
};

function run(rel) {
  const code = fs.readFileSync(path.join(WEB, rel), 'utf8');
  const mod = { exports: {} };
  const fn = vm.compileFunction(code, [
    'window', 'document', 'localStorage', 'navigator', 'console',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'fetch', 'module', 'exports', 'require', 'Request', 'caches', 'self'
  ], { filename: rel });
  fn(windowMock, documentEl, localStorageMock, windowMock.navigator, console,
    windowMock.setTimeout, windowMock.clearTimeout, windowMock.setInterval, windowMock.clearInterval,
    () => Promise.reject(new Error('offline')), mod, mod.exports, require, class {}, {}, {});
  return mod.exports;
}

run('js/time.js');
run('js/app.js');

const WB = windowMock.WB;
const IN = WB._internal;
IN.setNewsCache(NEWS);
IN.renderHome();

function txt(id) {
  const el = documentEl.getElementById(id);
  return el ? el.textContent : '(缺元素 ' + id + ')';
}
function strip(s) { return String(s).replace(/\s+/g, ' ').trim(); }

console.log('\n================ 首页渲染结果 ================\n');
console.log('【页头】');
console.log('  ' + strip(txt('hi')));
console.log('  ' + strip(txt('bjBig')) + '   [' + strip(txt('workPill')) + ']');
console.log('  ' + strip(txt('bjDate')));

console.log('\n【行情环境条】');
console.log('  美股时段 : ' + strip(txt('envSession')));
console.log('  美东时间 : ' + strip(txt('envEt')));
console.log('  你的时段 : ' + strip(txt('envWindow')));
console.log('  说明     : ' + strip(txt('envNote')));

console.log('\n【今日 SOXL】(' + strip(txt('soxlCount')) + ')');
const soxlHtml = documentEl.getElementById('soxlBody').innerHTML;
(soxlHtml.match(/<div class="h">([^<]*)<\/div>/g) || []).forEach((s, i) => {
  console.log('  ' + (i + 1) + '. ' + s.replace(/<[^>]*>/g, ''));
});

console.log('\n【持仓】');
const posCard = documentEl.getElementById('soxlPosCard');
console.log('  显示状态 : ' + (posCard.style.display === 'none' ? '隐藏（当前无持仓，符合预期）' : '显示'));

console.log('\n【今日要事】');
const todoHtml = documentEl.getElementById('todoList').innerHTML;
(todoHtml.match(/>([^<>]{2,40})<\/div>/g) || []).slice(0, 6).forEach((s) => {
  const t = s.replace(/[<>]|div/g, '').replace(/\/$/, '').trim();
  if (t) console.log('  · ' + t);
});

console.log('\n【今日打卡】(' + strip(txt('habitMore')) + ')');
const chipHtml = documentEl.getElementById('habitChips').innerHTML;
(chipHtml.match(/data-habit="([^"]+)"/g) || []).forEach((s) => {
  const id = s.match(/"([^"]+)"/)[1];
  const h = IN.HABITS.filter((x) => x.id === id)[0];
  if (h) console.log('  ' + h.icon + ' ' + h.name);
});

console.log('\n【小指标】');
console.log('  连续   : ' + strip(txt('mStreak')));
console.log('  本周复盘: ' + strip(txt('mWeekTrades')));
console.log('  本周盈亏: ' + strip(txt('mWeekPnl')));

console.log('\n【确认没有倒计时元素】');
['cdValue', 'cdLabel', 'cdBar', 'stDot'].forEach((id) => {
  console.log('  ' + id + ' : ' + (documentEl.getElementById(id) ? '仍存在（异常）' : '已移除 ✓'));
});

/* ---------------- 仓位计算器预览 ---------------- */
console.log('\n================ 仓位计算器（输入股数）================\n');
function calcPreview(label, vals, dir) {
  const set = (id, v) => {
    const el = documentEl.getElementById(id);
    if (!el) throw new Error('缺元素 ' + id);
    el.value = v == null ? '' : String(v);
  };
  /* 方向是模块内部状态，这里模拟点击分段按钮来切换 */
  if (dir) {
    IN.setCalcDir(dir);
  }
  Object.keys(vals).forEach((k) => set(k, vals[k]));
  IN.renderTrade();
  const html = documentEl.getElementById('calcOut').innerHTML;
  const text = html
    .replace(/<div class="result">/g, '\n  ')
    .replace(/<\/div>/g, '\n')
    .replace(/<[^>]*>/g, '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  console.log(label + '：');
  text.forEach((line) => console.log('    ' + line));
  console.log('');
}

calcPreview('做多 500 股，$30 入场，$28.5 止损', { cShares: 500, cEntry: 30, cStop: 28.5 }, 'long');
calcPreview('做多 300 股，$25 入场，不填止损', { cShares: 300, cEntry: 25, cStop: '' }, 'long');
calcPreview('做空 200 股，$100 入场，$105 止损', { cShares: 200, cEntry: 100, cStop: 105 }, 'short');

console.log('【账户资金输入已移除】');
['cAccount', 'cRisk', 'cShares'].forEach((id) => {
  const el = documentEl.getElementById(id);
  console.log('  ' + id + ' : ' + (el ? (id === 'cShares' ? '存在 ✓（新字段）' : '仍存在（异常）') : '已移除 ✓'));
});
console.log('\n==============================================\n');
