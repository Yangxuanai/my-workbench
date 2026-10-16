/* ============================================================
   小羊的工作台 —— 业务逻辑
   依赖 js/time.js（window.WBTime）
   ============================================================ */
(function () {
  'use strict';

  var T = window.WBTime;
  var LS_KEY = 'wb_data_v1';

  /* ---------------- 默认配置 ---------------- */

  var HABITS = [
    { id: 'journal', name: '交易复盘', icon: '📓', target: 1, unit: '次' },
    { id: 'prep', name: '开盘前准备', icon: '📋', target: 1, unit: '次' },
    { id: 'english', name: '英语学习', icon: '📖', target: 30, unit: '分钟' },
    { id: 'ai', name: 'AI 学习', icon: '🤖', target: 45, unit: '分钟' },
    { id: 'read', name: '读书', icon: '📚', target: 30, unit: '分钟' },
    { id: 'tennis', name: '网球 / 运动', icon: '🎾', target: 60, unit: '分钟' },
    { id: 'water', name: '喝够 8 杯水', icon: '💧', target: 8, unit: '杯' },
    { id: 'sleep', name: '按时睡觉', icon: '🌙', target: 1, unit: '次' },
    { id: 'discipline', name: '不报复性交易', icon: '🛡️', target: 1, unit: '次' },
    { id: 'gaming', name: '王者 ≤ 1 局', icon: '🎮', target: 1, unit: '局' }
  ];

  var DEFAULT_DATA = {
    settings: {
      name: '小羊',
      symbol: 'SOXL',
      englishTarget: 'CET-6 / IELTS 6.5',
      book: '股票大作手回忆录',
      bookCur: 0,
      bookTotal: 320,
      vocab: 0
    },
    todos: [],
    habits: {},
    trades: [],
    focus: [],
    activeMusic: 0,
    activeNews: 'us'
  };

  /* ---------------- 存储 ---------------- */

  var data = null;

  function load() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      data = raw ? JSON.parse(raw) : null;
    } catch (e) {
      data = null;
    }
    if (!data || typeof data !== 'object') data = clone(DEFAULT_DATA);
    fillDefaults(data);
    if (!data.todos.length) seedTodos();
    return data;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function fillDefaults(d) {
    Object.keys(DEFAULT_DATA).forEach(function (k) {
      if (d[k] === undefined || d[k] === null) d[k] = clone(DEFAULT_DATA[k]);
    });
    Object.keys(DEFAULT_DATA.settings).forEach(function (k) {
      if (d.settings[k] === undefined) d.settings[k] = DEFAULT_DATA.settings[k];
    });
    return d;
  }

  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      toast('本地存储写入失败');
      return false;
    }
  }

  function todayKey() { return T.bjDateKey(Date.now()); }

  function uid(p) {
    return (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function seedTodos() {
    var k = todayKey();
    data.todos = [
      { id: uid('t'), text: '看半导体板块盘前异动', done: false, date: k },
      { id: uid('t'), text: '复盘昨日 SOXL 交易', done: false, date: k },
      { id: uid('t'), text: '背 50 个单词', done: false, date: k },
      { id: uid('t'), text: '读 30 分钟书', done: false, date: k }
    ];
  }

  /* ---------------- 小工具 ---------------- */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function pct(a, b) { return b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0; }

  /** 金额千分位；正数带 + */
  function money(v, withSign) {
    var n = Math.round(v);
    var s = Math.abs(n).toLocaleString('en-US');
    if (n < 0) return '-' + s;
    return withSign && n > 0 ? '+' + s : s;
  }

  /** 价格保留 2 位，去掉多余的 0 */
  function price(v) {
    if (v === null || v === undefined || v === '') return '—';
    var n = Math.round(parseFloat(v) * 100) / 100;
    return String(n);
  }

  var toastTimer = null;
  function toast(msg) {
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('on'); }, 1900);
  }

  /* ---------------- 导航 ---------------- */

  var current = 'home';

  function go(name) {
    current = name;
    var views = document.querySelectorAll('.view');
    for (var i = 0; i < views.length; i++) views[i].classList.remove('on');
    var target = $('v-' + name);
    if (target) target.classList.add('on');
    var btns = document.querySelectorAll('nav button');
    for (var j = 0; j < btns.length; j++) {
      btns[j].classList.toggle('on', btns[j].getAttribute('data-go') === name);
    }
    window.scrollTo(0, 0);
    if (name === 'trade') renderTrade();
    if (name === 'news') renderNews();
    if (name === 'music') renderMusic();
    if (name === 'me') renderMe();
  }

  /* ============================================================
     交易复盘：核心 —— 由 入场价 / 方向 / 股数 / 出场价 自动算盈亏
     ============================================================ */

  /**
   * 计算一笔交易的盈亏。
   * 做多： (出场 - 入场) * 股数
   * 做空： (入场 - 出场) * 股数
   * 返回 { pnl, pnlPerShare, returnPct, rMultiple }
   *   returnPct 基于入场成本（浮点约定，非保证金口径）
   *   rMultiple 仅在填了止损价时给出
   */
  function computePnl(t) {
    var entry = parseFloat(t.entry);
    var shares = parseFloat(t.shares);
    if (!(entry > 0) || !(shares > 0)) return null;

    var out = {
      pnl: null,
      pnlPerShare: null,
      returnPct: null,
      rMultiple: null,
      cost: entry * shares,
      isOpen: true
    };

    var exitRaw = t.exit;
    var hasExit = exitRaw !== null && exitRaw !== undefined && exitRaw !== '' && !isNaN(parseFloat(exitRaw));
    if (!hasExit) return out;

    var exit = parseFloat(exitRaw);
    var perShare = t.direction === 'long' ? exit - entry : entry - exit;
    out.pnlPerShare = perShare;
    out.pnl = perShare * shares;
    out.returnPct = (perShare / entry) * 100;
    out.isOpen = false;

    var stop = parseFloat(t.stop);
    if (stop > 0) {
      var riskPerShare = Math.abs(entry - stop);
      if (riskPerShare > 0) {
        out.rMultiple = Math.round((perShare / riskPerShare) * 100) / 100;
      }
    }
    return out;
  }

  /** 复盘统计 */
  function reviewStats() {
    var closed = [];
    data.trades.forEach(function (t) {
      var c = computePnl(t);
      if (c && !c.isOpen) closed.push({ t: t, c: c });
    });
    var open = data.trades.filter(function (t) {
      var c = computePnl(t);
      return c && c.isOpen;
    });

    var wins = closed.filter(function (x) { return x.c.pnl > 0; });
    var losses = closed.filter(function (x) { return x.c.pnl < 0; });
    var flat = closed.filter(function (x) { return x.c.pnl === 0; });
    var grossWin = wins.reduce(function (s, x) { return s + x.c.pnl; }, 0);
    var grossLoss = Math.abs(losses.reduce(function (s, x) { return s + x.c.pnl; }, 0));
    var net = grossWin - grossLoss;
    var n = closed.length;

    var rList = closed.filter(function (x) { return x.c.rMultiple !== null; })
      .map(function (x) { return x.c.rMultiple; });
    var avgR = rList.length ? rList.reduce(function (a, b) { return a + b; }, 0) / rList.length : null;

    /* 连续盈亏（按时间正序，从最近往前数连续同号） */
    var sorted = closed.slice().sort(function (a, b) { return b.t.ts - a.t.ts; });
    var streak = 0;
    var streakType = null;
    for (var i = 0; i < sorted.length; i++) {
      var p = sorted[i].c.pnl;
      var type = p > 0 ? 'win' : (p < 0 ? 'loss' : null);
      if (!type) break;
      if (streakType === null) { streakType = type; streak = 1; }
      else if (streakType === type) streak++;
      else break;
    }

    return {
      total: data.trades.length,
      closed: n,
      open: open.length,
      wins: wins.length,
      losses: losses.length,
      flat: flat.length,
      winRate: n ? Math.round((wins.length / n) * 100) : 0,
      net: net,
      grossWin: grossWin,
      grossLoss: grossLoss,
      avgWin: wins.length ? grossWin / wins.length : 0,
      avgLoss: losses.length ? grossLoss / losses.length : 0,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0),
      expectancy: n ? net / n : 0,
      avgR: avgR,
      streak: streak,
      streakType: streakType,
      bestTrade: closed.length ? Math.max.apply(null, closed.map(function (x) { return x.c.pnl; })) : 0,
      worstTrade: closed.length ? Math.min.apply(null, closed.map(function (x) { return x.c.pnl; })) : 0
    };
  }

  function renderReviewStats() {
    var s = reviewStats();
    var box = $('reviewStats');
    if (!s.total) {
      box.innerHTML = '<div class="empty">还没有复盘记录<br>点右上角记下第一笔</div>';
      return;
    }
    var pf = s.profitFactor === Infinity ? '∞' : (s.profitFactor ? s.profitFactor.toFixed(2) : '—');
    var streakText = s.streak ? (s.streakType === 'win' ? '连赢 ' : '连亏 ') + s.streak + ' 笔' : '—';

    var html = '<div class="result">' +
      '<div class="k">总盈亏（USD）</div>' +
      '<div class="v ' + (s.net >= 0 ? 'up' : 'down') + '">' + (s.net >= 0 ? '+' : '') + money(s.net) + '</div>' +
      '<div class="s">' + s.closed + ' 笔已平仓' + (s.open ? ' · ' + s.open + ' 笔持仓中' : '') + '</div>' +
      '</div>';

    html += '<div class="grid g3">' +
      tile('胜率', s.winRate + '<small>%</small>', s.wins + ' 胜 / ' + s.losses + ' 负') +
      tile('盈亏比', pf, '总盈利/总亏损') +
      tile('单笔期望', (s.expectancy >= 0 ? '+' : '') + money(s.expectancy), '每笔平均') +
      '</div><div class="grid g3" style="margin-top:10px">' +
      tile('平均盈利', '+' + money(s.avgWin), '盈利单') +
      tile('平均亏损', '-' + money(s.avgLoss), '亏损单') +
      tile('平均 R', s.avgR === null ? '—' : (s.avgR >= 0 ? '+' : '') + s.avgR.toFixed(2), '风险倍数') +
      '</div>';

    html += '<div class="sep"></div>' +
      kv('当前连胜/连亏', streakText) +
      kv('最大单笔盈利', '+' + money(s.bestTrade)) +
      kv('最大单笔亏损', money(s.worstTrade));

    box.innerHTML = html;
  }

  function tile(k, v, u) {
    return '<div class="tile"><div class="k">' + esc(k) + '</div><div class="v num">' + v + '</div>' +
      (u ? '<div class="u">' + esc(u) + '</div>' : '') + '</div>';
  }
  function kv(k, v) {
    return '<div class="kv"><span class="k">' + esc(k) + '</span><span class="v">' + v + '</span></div>';
  }

  function renderTradeList() {
    var box = $('tradeList');
    $('tradeCount').textContent = data.trades.length ? data.trades.length + ' 笔' : '—';
    if (!data.trades.length) {
      box.innerHTML = '<div class="empty">还没有记录<br>记下入场价、方向、股数、出场价，盈亏自动算</div>';
      return;
    }

    box.innerHTML = data.trades.slice(0, 40).map(function (t) {
      var c = computePnl(t);
      var open = c && c.isOpen;
      var pnlHtml;
      if (open) {
        pnlHtml = '<span class="tag b">持仓中</span>';
      } else {
        pnlHtml = '<div class="num ' + (c.pnl >= 0 ? 'up' : 'down') + '" style="font-size:17px;font-weight:700">' +
          (c.pnl >= 0 ? '+' : '') + money(c.pnl) + '</div>' +
          '<div style="font-size:11.5px;color:var(--ink-3)">' +
          (c.returnPct >= 0 ? '+' : '') + c.returnPct.toFixed(2) + '%' +
          (c.rMultiple !== null ? ' · ' + (c.rMultiple >= 0 ? '+' : '') + c.rMultiple + 'R' : '') +
          '</div>';
      }

      var meta = [
        (t.direction === 'long' ? '做多' : '做空'),
        '入场 ' + price(t.entry),
        t.shares + ' 股'
      ];
      if (!open) meta.push('出场 ' + price(t.exit));

      return '<div class="row">' +
        '<div class="grow">' +
        '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">' +
        '<span style="font-size:15.5px;font-weight:700">' + esc(t.symbol) + '</span>' +
        '<span class="tag ' + (t.direction === 'long' ? 'g' : 'r') + '">' + (t.direction === 'long' ? '做多' : '做空') + '</span>' +
        (t.setup ? '<span class="tag n">' + esc(t.setup) + '</span>' : '') +
        '</div>' +
        '<div class="d num">' + meta.join(' · ') + '</div>' +
        (t.note ? '<div class="d">' + esc(t.note) + '</div>' : '') +
        '<div class="d">' + T.bjDateKey(t.ts).slice(5) + ' ' + T.WEEKDAY_CN[T.bjParts(t.ts).weekday] + '</div>' +
        '</div>' +
        '<div style="text-align:right;flex:0 0 auto">' +
        pnlHtml +
        '<div style="margin-top:8px">' +
        (open ? '<span class="more tap" data-close="' + t.id + '" style="color:var(--accent);margin-right:10px">填出场价</span>' : '') +
        '<span class="more tap" data-deltrade="' + t.id + '">删除</span>' +
        '</div>' +
        '</div>' +
        '</div>';
    }).join('');
  }

  /* ---------------- 首页 ---------------- */

  function greeting() {
    var h = T.bjParts(Date.now()).hour;
    if (h < 5) return '还在盯盘';
    if (h < 11) return '早上好';
    if (h < 13) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  }

  /** 当前时段对交易者的意义 */
  function focusText(sessionKey) {
    switch (sessionKey) {
      case 'pre': return '盘前';
      case 'regular': return '盘中';
      case 'after': return '盘后';
      case 'closed': return '休市';
      default: return '隔夜';
    }
  }

  function symbol() {
    return (data.settings.symbol || 'SOXL').toUpperCase();
  }

  function renderHome() {
    var now = Date.now();
    var snap = T.marketSnapshot(now);
    var night = snap.night;
    var bj = T.bjParts(now);
    var name = data.settings.name || '小羊';
    var sym = symbol();

    /* 页头 */
    $('hi').textContent = name + '，' + greeting();
    $('bjBig').textContent = T.pad2(bj.hour) + ':' + T.pad2(bj.minute);
    var pill = $('workPill');
    if (night.inWindow) {
      pill.textContent = '上班中';
      pill.className = 'pill on';
      pill.innerHTML = '<i></i>上班中';
    } else {
      pill.className = 'pill off';
      pill.innerHTML = '<i></i>休息中';
    }
    $('bjDate').textContent = bj.year + ' 年 ' + bj.month + ' 月 ' + bj.day + ' 日 ' +
      T.WEEKDAY_CN[bj.weekday];

    /* 行情环境条：只做参照，不放倒计时 */
    $('envSession').textContent = snap.session.label;
    $('envSession').style.color =
      snap.session.key === 'regular' ? 'var(--accent)' :
      snap.session.key === 'pre' ? 'var(--amber)' :
      snap.session.key === 'after' ? 'var(--blue)' : 'var(--ink-2)';
    $('envEt').textContent = T.pad2(snap.etNow.hour) + ':' + T.pad2(snap.etNow.minute);

    /* 「今天对应美东」优先取**今天**的窗口；今天休息才提示下一班 */
    var todayWin = T.buildWorkWindow(T.bjDateKey(now));
    if (todayWin) {
      $('envWindow').textContent = T.hhmm(todayWin.start) + '-' + T.hhmm(todayWin.end);
    } else {
      $('envWindow').textContent = '休息';
    }

    var noteParts = ['你的工作日：<b>周一~周五</b>（北京）'];
    if (todayWin) {
      noteParts.push('今天对应 <b>美东 ' + esc(todayWin.etRangeText) + '</b>');
    } else if (night.nextWindow) {
      noteParts.push('今天休息，下一班 <b>' +
        T.mmdd(night.nextWindow.start) + ' ' + T.WEEKDAY_CN[T.bjParts(night.nextWindow.start).weekday] +
        '</b>（美东 ' + esc(night.nextWindow.etRangeText) + '）');
    }
    noteParts.push(T.dstLabel(now) + '，美东钟点随季节平移');
    $('envNote').innerHTML = noteParts.join('；') + '。';

    $('symLabel').textContent = sym;

    renderSoxl();
    renderSoxlPos();
    renderTodos();
    renderHabitChips();
    renderHomeStats();
  }

  /** 首页里的三个小指标 */
  function renderHomeStats() {
    $('mStreak').innerHTML = streakDays() + '<small>天</small>';

    /* 本周（北京周一起算）的复盘笔数与盈亏 */
    var now = Date.now();
    var bjKey = T.bjDateKey(now);
    var wd = T.bjWeekday(bjKey);                 // 0=周日
    var sinceKey = T.shiftKey(bjKey, -(wd === 0 ? 6 : wd - 1));
    var startTs = T.bjAt(sinceKey, 0, 0);

    var weekTrades = data.trades.filter(function (t) { return t.ts >= startTs; });
    var weekPnl = 0;
    var closedCount = 0;
    weekTrades.forEach(function (t) {
      var c = computePnl(t);
      if (c && !c.isOpen) { weekPnl += c.pnl; closedCount++; }
    });

    $('mWeekTrades').innerHTML = weekTrades.length + '<small>笔</small>';
    var pnlEl = $('mWeekPnl');
    pnlEl.textContent = (weekPnl >= 0 ? '+' : '') + money(weekPnl);
    pnlEl.className = 'v num ' + (weekPnl > 0 ? 'up' : (weekPnl < 0 ? 'down' : ''));
  }

  function streakDays() {
    var k = todayKey();
    var n = 0;
    for (var i = 0; i < 400; i++) {
      var day = data.habits[k];
      if (day && Object.keys(day).length) n++;
      else if (i > 0) break;
      k = T.shiftKey(k, -1);
    }
    return n;
  }

  function habitStreak(id) {
    var k = todayKey();
    var n = 0;
    for (var i = 0; i < 400; i++) {
      var day = data.habits[k];
      if (day && day[id]) n++;
      else if (i > 0) break;
      k = T.shiftKey(k, -1);
    }
    return n;
  }

  /* ---------------- 首页：SOXL 专属 ---------------- */

  function soxlItems() {
    if (!newsCache) return [];
    var sym = symbol();
    var out = [];
    var groups = newsCache.groups || [];
    for (var g = 0; g < groups.length; g++) {
      var items = groups[g].items || [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var flagged = it.soxl === true;
        var mentioned = (it.title + ' ' + (it.body || '')).toUpperCase().indexOf(sym) >= 0;
        if (flagged || mentioned) {
          out.push(Object.assign({}, it, { _group: groups[g].name }));
        }
      }
    }
    return out;
  }

  function renderSoxl() {
    var sym = symbol();
    var items = soxlItems();
    var card = $('soxlCard');
    if (card) card.style.display = '';

    if (!newsCache) {
      $('soxlCount').textContent = '加载中';
      $('soxlBody').innerHTML = '<div class="empty">正在读取今日 ' + esc(sym) + ' 关注…</div>';
      return;
    }
    $('soxlCount').textContent = items.length ? items.length + ' 条' : '暂无';

    if (!items.length) {
      $('soxlBody').innerHTML =
        '<div class="empty">今天还没有 ' + esc(sym) + ' 相关条目<br>' +
        '<span style="color:var(--ink-4)">在 news.json 里给条目加 "soxl": true 即可进这里</span></div>';
      return;
    }

    $('soxlBody').innerHTML = items.slice(0, 5).map(function (it, i) {
      var meta = [];
      if (it.source) meta.push(esc(it.source));
      if (it.time) meta.push(esc(it.time));
      return '<div class="ni' + (i === 0 ? ' hot' : '') + '">' +
        '<div class="h">' + esc(it.title) + '</div>' +
        (it.body ? '<div class="b">' + esc(it.body) + '</div>' : '') +
        '<div class="m">' + meta.join('<span class="dotsep"></span>') +
        (it.url ? '<span class="dotsep"></span><a href="' + esc(it.url) + '" target="_blank" rel="noopener">原文 ↗</a>' : '') +
        '</div></div>';
    }).join('');
  }

  /** 持仓汇总：把 SYMBOL 的未平仓记录聚合 */
  function renderSoxlPos() {
    var sym = symbol();
    var mine = data.trades.filter(function (t) { return (t.symbol || '').toUpperCase() === sym; });
    var open = mine.filter(function (t) {
      var c = computePnl(t);
      return c && c.isOpen;
    });
    var card = $('soxlPosCard');
    if (!open.length) {
      if (card) card.style.display = 'none';
      return;
    }
    if (card) card.style.display = '';

    var totalShares = 0;
    var totalCost = 0;
    var longShares = 0;
    var shortShares = 0;
    open.forEach(function (t) {
      var c = computePnl(t);
      totalShares += parseFloat(t.shares) || 0;
      totalCost += c.cost;
      if (t.direction === 'long') longShares += parseFloat(t.shares) || 0;
      else shortShares += parseFloat(t.shares) || 0;
    });
    var avg = totalShares ? totalCost / totalShares : 0;

    $('soxlPos').innerHTML =
      '<div class="grid g3">' +
      tile('持仓', String(totalShares) + '<small>股</small>',
        (longShares ? '多 ' + longShares : '') + (shortShares ? (longShares ? ' / ' : '') + '空 ' + shortShares : '')) +
      tile('均价', '$' + price(avg), open.length + ' 笔未平') +
      tile('成本', '$' + money(totalCost), '占用资金') +
      '</div>' +
      '<div class="sep"></div>' +
      '<div style="font-size:12.5px;color:var(--ink-3);line-height:1.65">' +
      '平仓后到「复盘」里填出场价，盈亏会自动算出来并计入统计。</div>';
  }

  /* ---------------- 首页：待办 / 打卡 ---------------- */

  function renderTodos() {
    var k = todayKey();
    var list = data.todos.filter(function (t) { return !t.date || t.date === k; });
    var box = $('todoList');
    if (!list.length) {
      box.innerHTML = '<div class="empty">今天还没有要事，点右上角加一条</div>';
      return;
    }
    box.innerHTML = list.map(function (t) {
      return '<div class="row tap" data-todo="' + t.id + '">' +
        '<div class="ck ' + (t.done ? 'on' : '') + '"></div>' +
        '<div class="grow"><div class="t" style="' +
        (t.done ? 'color:var(--ink-3);text-decoration:line-through' : '') + '">' + esc(t.text) + '</div></div>' +
        '<div class="x" data-del-todo="' + t.id + '">✕</div>' +
        '</div>';
    }).join('');
  }

  /** 打卡改成胶囊，一眼看完 10 项，不用点进二级页 */
  function renderHabitChips() {
    var k = todayKey();
    var day = data.habits[k] || {};
    var done = HABITS.filter(function (h) { return day[h.id]; }).length;
    $('habitMore').textContent = done + '/' + HABITS.length;
    $('habitBar').style.width = pct(done, HABITS.length) + '%';

    $('habitChips').innerHTML = HABITS.map(function (h) {
      var on = !!day[h.id];
      return '<span class="chip ' + (on ? 'on' : '') + '" data-habit="' + h.id + '">' +
        (on ? '✓' : '') + h.icon + ' ' + esc(h.name) + '</span>';
    }).join('');
  }

  /* ---------------- 交易页 ---------------- */

  function renderTrade() {
    var now = Date.now();
    var snap = T.marketSnapshot(now);
    var n = snap.night;
    var todayWin = T.buildWorkWindow(T.bjDateKey(now));
    $('tradeSub').textContent = '工作日 周一~周五（北京）· ' + T.dstLabel(now) +
      (todayWin ? ' · 今天对应美东 ' + todayWin.etRangeText : ' · 今天休息');

    renderReviewStats();
    renderTradeList();

    $('tlEtDate').textContent = T.mmddEt(now) + ' ' + T.WEEKDAY_CN[snap.etNow.weekday];
    var tl = T.timelineFor(now);
    var stateMap = { current: ['g', '进行中'], past: ['n', '已结束'], future: ['b', '未开始'], closed: ['n', '休市'] };
    var railMap = { green: 'g', amber: 'a', blue: 'b' };
    $('timeline').innerHTML = tl.map(function (s) {
      var m = stateMap[s.state] || ['n', ''];
      return '<div class="tl"><div class="rail ' + (railMap[s.color] || '') + '"></div><div class="body">' +
        '<div class="hd"><div class="n">' + s.name + '</div><span class="tag ' + m[0] + '">' + m[1] + '</span></div>' +
        '<div class="tm">' + s.etRange + '</div><div class="tm">🇨🇳 ' + s.bjRange + '</div>' +
        '</div></div>';
    }).join('');

    $('tlNote').innerHTML =
      '你的时段是 <b>北京 周一~周五 上午 08:00-16:00</b>，正好覆盖美东 <b>盘后收盘 20:00 → 次日盘前开始 04:00</b>。' +
      '（冬令时美东同样是 20:00-04:00，但北京时间会变成 09:00-17:00。）<br>' +
      (todayWin
        ? '今天（' + T.WEEKDAY_CN[T.bjParts(now).weekday] + '，' + T.bjDateKey(now) + '）对应：<b>美东 ' + esc(todayWin.etRangeText) + '</b>'
        : '今天（' + T.WEEKDAY_CN[T.bjParts(now).weekday] + '）是周末，美股休市，你休息。');

    renderCalc();
    renderHolidays();
  }

  function renderHolidays() {
    var list = T.upcomingHolidays(Date.now(), 5);
    $('holidays').innerHTML = list.length
      ? list.map(function (h) {
        return '<div class="row"><div class="grow"><div class="t">' + esc(h.name) + '</div>' +
          '<div class="d mono">' + h.date + '</div></div><span class="tag n">休市</span></div>';
      }).join('')
      : '<div class="empty">暂无</div>';
  }

  /* --- 仓位计算 ---
     定位：给定「进仓股数 + 入场价 + 止损价」，算出
       投入资金（股数 × 入场价）
       每股风险、总风险（到止损的亏损）
       1R / 2R / 3R 目标价与对应盈利
     不再需要账户资金与风险百分比——股数由你直接给。 */

  var calcDir = 'long';

  function calcInput() {
    return {
      shares: parseFloat($('cShares').value) || 0,
      entry: parseFloat($('cEntry').value) || 0,
      stop: parseFloat($('cStop').value) || 0,
      dir: calcDir
    };
  }

  function computePosition(c) {
    /* 股数 + 入场价是必需的；止损价缺失时只算投入资金 */
    if (!(c.shares > 0) || !(c.entry > 0)) return { empty: true };

    var cost = c.shares * c.entry;
    var base = {
      shares: c.shares,
      entry: c.entry,
      cost: cost,
      perUnit: null,
      maxLoss: null,
      targets: null
    };

    if (!(c.stop > 0)) return base;

    /* 方向校验 */
    var perUnit = c.dir === 'long' ? c.entry - c.stop : c.stop - c.entry;
    if (perUnit <= 0) {
      return {
        invalid: true,
        tip: c.dir === 'long' ? '做多时，止损价必须低于入场价' : '做空时，止损价必须高于入场价'
      };
    }

    return Object.assign(base, {
      perUnit: perUnit,
      maxLoss: perUnit * c.shares,
      /** 风险占投入资金的比例 */
      riskPct: (perUnit / c.entry) * 100,
      targets: [1, 2, 3].map(function (r) {
        var p = c.dir === 'long' ? c.entry + perUnit * r : c.entry - perUnit * r;
        return {
          r: r,
          price: p,
          profit: perUnit * r * c.shares,
          /** 相对投入资金的收益率 */
          returnPct: ((c.dir === 'long' ? p - c.entry : c.entry - p) / c.entry) * 100
        };
      })
    });
  }

  function renderCalc() {
    var r = computePosition(calcInput());
    var box = $('calcOut');
    if (r.empty) { box.innerHTML = ''; return; }
    if (r.invalid) { box.innerHTML = '<div class="warn">' + esc(r.tip) + '</div>'; return; }

    var html = '<div class="result"><div class="k">投入资金（USD）</div>' +
      '<div class="v num">$' + money(r.cost) + '</div>' +
      '<div class="s">' + r.shares.toLocaleString('en-US') + ' 股 × $' + price(r.entry) + '</div></div>';

    html += kv('股数', r.shares.toLocaleString('en-US'));
    html += kv('入场价', '$' + price(r.entry));

    if (r.perUnit === null) {
      html += '<div class="warn" style="margin-top:12px">填上止损价，就能算出最大亏损和 1R/2R/3R 目标。</div>';
      box.innerHTML = html;
      return;
    }

    html += kv('止损价', '$' + price(calcInput().stop)) +
      kv('每股风险', '$' + price(r.perUnit)) +
      kv('最大亏损', '<span class="down">-$' + money(r.maxLoss) + '</span>') +
      kv('风险占投入', r.riskPct.toFixed(2) + '%') +
      r.targets.map(function (t) {
        return kv('<span class="tag g">' + t.r + 'R</span>',
          '$' + price(t.price) +
          ' <span class="up" style="margin-left:6px">+$' + money(t.profit) + '</span>' +
          ' <span style="color:var(--ink-3);font-weight:400;margin-left:4px">' +
          (t.returnPct >= 0 ? '+' : '') + t.returnPct.toFixed(2) + '%</span>');
      }).join('');

    box.innerHTML = html;
  }

  /* ---------------- 弹层 ---------------- */

  function openSheet(html) {
    $('sheetBody').innerHTML = html;
    $('sheet').classList.add('on');
  }
  function closeSheet() { $('sheet').classList.remove('on'); }

  function openTodo() {
    openSheet('<h3>添加要事</h3>' +
      '<div class="field"><input class="inp" id="todoInput" placeholder="例如：看半导体盘前异动" /></div>' +
      '<div class="btn-row"><button class="btn gho" onclick="WB.closeSheet()">取消</button>' +
      '<button class="btn pri" onclick="WB.addTodo()">添加</button></div>');
    var el = $('todoInput');
    if (el) setTimeout(function () { el.focus(); }, 80);
  }

  function addTodo() {
    var v = ($('todoInput').value || '').trim();
    if (!v) { toast('请输入内容'); return; }
    data.todos.unshift({ id: uid('t'), text: v, done: false, date: todayKey() });
    save(); closeSheet(); renderTodos();
  }

  /**
   * 记一笔 / 编辑一笔。
   * 只需填：标的、方向、入场价、股数、出场价（可选）。盈亏自动算。
   */
  function openTrade(editId) {
    var t = editId ? data.trades.filter(function (x) { return x.id === editId; })[0] : null;
    if (!t && editId) return;
    var sym = t ? t.symbol : (data.settings.symbol || 'SOXL');
    var dir = t ? t.direction : 'long';
    var v = function (k) { return t && t[k] != null ? t[k] : ''; };

    openSheet('<h3>' + (t ? '编辑复盘' : '记一笔复盘') + '</h3>' +
      '<div class="sub">盈亏会根据「方向 + 入场价 + 股数 + 出场价」自动算</div>' +
      '<input type="hidden" id="tId" value="' + (t ? t.id : '') + '" />' +
      '<div class="field"><label class="lab">标的</label>' +
      '<input class="inp" id="tSymbol" placeholder="SOXL" value="' + esc(sym) + '" /></div>' +
      '<div class="seg" id="tDir">' +
      '<button data-dir="long" class="' + (dir === 'long' ? 'on' : '') + '">做多</button>' +
      '<button data-dir="short" class="' + (dir === 'short' ? 'on' : '') + '">做空</button></div>' +
      '<div class="f2">' +
      '<div class="field"><label class="lab">入场价</label>' +
      '<input class="inp mono" id="tEntry" type="number" inputmode="decimal" placeholder="0.00" value="' + v('entry') + '" /></div>' +
      '<div class="field"><label class="lab">股数</label>' +
      '<input class="inp mono" id="tShares" type="number" inputmode="numeric" placeholder="100" value="' + v('shares') + '" /></div>' +
      '</div>' +
      '<div class="field"><label class="lab">出场价 <span style="color:var(--ink-4)">（还没平仓就留空）</span></label>' +
      '<input class="inp mono" id="tExit" type="number" inputmode="decimal" placeholder="平仓后填这里" value="' + v('exit') + '" /></div>' +
      '<div class="field"><label class="lab">止损价 <span style="color:var(--ink-4)">（可选，填了会算 R 倍数）</span></label>' +
      '<input class="inp mono" id="tStop" type="number" inputmode="decimal" placeholder="0.00" value="' + v('stop') + '" /></div>' +
      '<div class="field"><label class="lab">复盘备注</label>' +
      '<textarea class="inp" id="tNote" placeholder="进场理由、执行情况、情绪、下次改进">' + esc(v('note')) + '</textarea></div>' +
      '<div id="tPreview"></div>' +
      '<div class="btn-row"><button class="btn gho" onclick="WB.closeSheet()">取消</button>' +
      '<button class="btn pri" onclick="WB.saveTrade()">保存</button></div>');
  }

  var tradeDir = 'long';

  /** 表单实时预览盈亏 —— 让你填出场价之前就知道会算什么 */
  function previewTrade() {
    var box = $('tPreview');
    if (!box) return;
    var entry = parseFloat($('tEntry').value);
    var shares = parseFloat($('tShares').value);
    var exitRaw = $('tExit').value;
    if (!(entry > 0) || !(shares > 0)) { box.innerHTML = ''; return; }

    var hasExit = exitRaw !== '' && !isNaN(parseFloat(exitRaw));
    if (!hasExit) {
      box.innerHTML = '<div class="warn">还没填出场价，保存后会记成「持仓中」，之后随时补填。</div>';
      return;
    }
    var c = computePnl({
      direction: tradeDir, entry: entry, shares: shares,
      exit: parseFloat(exitRaw), stop: parseFloat($('tStop').value)
    });
    if (!c || c.isOpen) { box.innerHTML = ''; return; }

    /* 方向与价格明显矛盾时提醒（不阻止保存） */
    var conflict = '';
    if (tradeDir === 'long' && parseFloat(exitRaw) < entry) conflict = '做多但出场价低于入场价，确认没填反？';
    if (tradeDir === 'short' && parseFloat(exitRaw) > entry) conflict = '做空但出场价高于入场价，确认没填反？';

    box.innerHTML =
      '<div class="result"><div class="k">预计盈亏（USD）</div>' +
      '<div class="v num ' + (c.pnl >= 0 ? 'up' : 'down') + '">' + (c.pnl >= 0 ? '+' : '') + money(c.pnl) + '</div>' +
      '<div class="s">每股 ' + (c.pnlPerShare >= 0 ? '+' : '') + price(c.pnlPerShare) +
      ' · 收益率 ' + (c.returnPct >= 0 ? '+' : '') + c.returnPct.toFixed(2) + '%' +
      (c.rMultiple !== null ? ' · ' + (c.rMultiple >= 0 ? '+' : '') + c.rMultiple + 'R' : '') +
      '</div></div>' +
      (conflict ? '<div class="warn" style="margin-bottom:12px">' + esc(conflict) + '</div>' : '');
  }

  function saveTrade() {
    var id = $('tId').value;
    var symbol = ($('tSymbol').value || '').trim().toUpperCase();
    var entry = parseFloat($('tEntry').value);
    var shares = parseFloat($('tShares').value);
    var exitRaw = $('tExit').value;
    var stopRaw = $('tStop').value;
    var note = ($('tNote').value || '').trim();

    if (!symbol) { toast('请输入标的代码'); return; }
    if (!(entry > 0)) { toast('请输入入场价'); return; }
    if (!(shares > 0)) { toast('请输入股数'); return; }

    var exit = exitRaw === '' ? null : parseFloat(exitRaw);
    if (exit !== null && isNaN(exit)) { toast('出场价格式不对'); return; }
    var stop = stopRaw === '' ? null : parseFloat(stopRaw);
    if (stop !== null && isNaN(stop)) { toast('止损价格式不对'); return; }

    var rec = {
      symbol: symbol,
      direction: tradeDir,
      entry: entry,
      shares: shares,
      exit: exit,
      stop: stop,
      note: note,
      ts: Date.now()
    };

    if (id) {
      data.trades = data.trades.map(function (t) {
        return t.id === id ? Object.assign(t, rec) : t;
      });
    } else {
      rec.id = uid('tr');
      data.trades.unshift(rec);
    }
    save();
    closeSheet();
    renderTrade();
    renderHome();

    if (exit !== null) {
      markHabit('journal', true);
      var c = computePnl(rec);
      toast('已记录，盈亏 ' + (c.pnl >= 0 ? '+' : '') + money(c.pnl));
    } else {
      toast('已记录为持仓中');
    }
  }

  /** 给持仓中的记录补填出场价 */
  function fillExit(id) {
    var t = data.trades.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    openSheet('<h3>填出场价</h3>' +
      '<div class="sub">' + esc(t.symbol) + ' · ' + (t.direction === 'long' ? '做多' : '做空') +
      ' · 入场 ' + price(t.entry) + ' · ' + t.shares + ' 股</div>' +
      '<div class="field"><label class="lab">出场价</label>' +
      '<input class="inp mono" id="feExit" type="number" inputmode="decimal" placeholder="0.00" /></div>' +
      '<div id="fePreview"></div>' +
      '<div class="btn-row"><button class="btn gho" onclick="WB.closeSheet()">取消</button>' +
      '<button class="btn pri" onclick="WB.doFillExit(\'' + id + '\')">确认平仓</button></div>');

    var input = $('feExit');
    if (input) {
      input.addEventListener('input', function () {
        var v = parseFloat(input.value);
        var box = $('fePreview');
        if (!(v >= 0) || isNaN(v)) { box.innerHTML = ''; return; }
        var c = computePnl({ direction: t.direction, entry: t.entry, shares: t.shares, exit: v, stop: t.stop });
        box.innerHTML = '<div class="result"><div class="k">这笔盈亏（USD）</div>' +
          '<div class="v num ' + (c.pnl >= 0 ? 'up' : 'down') + '">' + (c.pnl >= 0 ? '+' : '') + money(c.pnl) + '</div>' +
          '<div class="s">收益率 ' + (c.returnPct >= 0 ? '+' : '') + c.returnPct.toFixed(2) + '%' +
          (c.rMultiple !== null ? ' · ' + (c.rMultiple >= 0 ? '+' : '') + c.rMultiple + 'R' : '') + '</div></div>';
      });
      setTimeout(function () { input.focus(); }, 80);
    }
  }

  function doFillExit(id) {
    var v = parseFloat($('feExit').value);
    if (isNaN(v) || v < 0) { toast('请输入有效价格'); return; }
    data.trades = data.trades.map(function (t) {
      return t.id === id ? Object.assign(t, { exit: v }) : t;
    });
    save(); closeSheet(); renderTrade(); renderHome();
    markHabit('journal', true);
    var t = data.trades.filter(function (x) { return x.id === id; })[0];
    var c = computePnl(t);
    toast('已平仓，盈亏 ' + (c.pnl >= 0 ? '+' : '') + money(c.pnl));
  }

  /* ---------------- 打卡 ---------------- */

  function markHabit(id, on) {
    var k = todayKey();
    if (!data.habits[k]) data.habits[k] = {};
    if (on) data.habits[k][id] = Date.now();
    else delete data.habits[k][id];
    if (!Object.keys(data.habits[k]).length) delete data.habits[k];
    save();
    renderHabitChips();
    var s = streakDays();
    $('mStreak').innerHTML = s + '<small>天</small>';
  }

  function toggleHabit(id) {
    var k = todayKey();
    var day = data.habits[k] || {};
    markHabit(id, !day[id]);
  }

  /* ---------------- 音乐 ---------------- */

  var musicCache = null;
  var FALLBACK_MUSIC = {
    playlists: [
      { id: 0, name: '盯盘专注', icon: '📈', desc: '低干扰纯音乐，长时间盯盘不累', tag: '盯盘', neteaseId: '', url: 'https://music.163.com/' }
    ]
  };

  function loadMusic() {
    if (musicCache) { renderMusic(); return; }
    fetch('music.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('missing'); return r.json(); })
      .then(function (j) { musicCache = (j && j.playlists && j.playlists.length) ? j : FALLBACK_MUSIC; })
      .catch(function () { musicCache = FALLBACK_MUSIC; })
      .then(renderMusic);
  }

  function renderMusic() {
    if (!musicCache) {
      $('musicList').innerHTML = '<div class="empty">加载中…</div>';
      return;
    }
    var list = musicCache.playlists;
    var idx = Math.min(data.activeMusic || 0, list.length - 1);
    $('musicCount').textContent = list.length + ' 张';

    $('musicList').innerHTML = list.map(function (m, i) {
      return '<div class="mi ' + (i === idx ? 'on' : '') + '" data-music="' + i + '">' +
        '<div class="cv">' + (m.icon || '🎵') + '</div>' +
        '<div class="grow"><div class="nm">' + esc(m.name) + '</div>' +
        '<div class="ds">' + esc(m.desc || '') + '</div></div>' +
        '<div class="more">' + esc(m.tag || '') + '</div>' +
        '</div>';
    }).join('');

    var cur = list[idx];
    var box = $('playerBox');
    if (!cur) { box.innerHTML = ''; return; }
    if (cur.neteaseId) {
      box.innerHTML = '<iframe class="player" src="https://music.163.com/outchain/player?type=0&id=' +
        encodeURIComponent(cur.neteaseId) + '&auto=0&height=330" allow="autoplay"></iframe>';
      $('playerHint').textContent = '网易云官方外链';
    } else {
      box.innerHTML = '<div class="empty">这张歌单没有内嵌 ID<br>用下面的按钮到网易云打开</div>';
      $('playerHint').textContent = '需在网易云打开';
    }
  }

  function pickMusic(i) {
    data.activeMusic = i;
    save();
    if (!musicCache) { loadMusic(); return; }
    renderMusic();
  }

  function curMusic() {
    if (!musicCache) return null;
    var list = musicCache.playlists;
    return list[Math.min(data.activeMusic || 0, list.length - 1)];
  }

  function musicUrl(m) {
    if (!m) return 'https://music.163.com/';
    if (m.url) return m.url;
    if (m.neteaseId) return 'https://music.163.com/#/playlist?id=' + m.neteaseId;
    return 'https://music.163.com/';
  }

  function copyMusicLink() {
    var m = curMusic();
    if (!m) { toast('还没选歌单'); return; }
    copyText(musicUrl(m));
  }

  function openMusicApp() {
    window.open(musicUrl(curMusic()), '_blank');
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('已复制'); }, function () { legacyCopy(text); });
    } else {
      legacyCopy(text);
    }
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('已复制'); } catch (e) { toast('复制失败'); }
    document.body.removeChild(ta);
  }

  /* ---------------- 新闻 ---------------- */

  var newsCache = null;
  var NEWS_FALLBACK = {
    updatedAt: '',
    groups: [
      { key: 'us', name: '美股财经', items: [] },
      { key: 'cn', name: '国内', items: [] },
      { key: 'other', name: '其他', items: [] }
    ]
  };

  function loadNews(force) {
    if (newsCache && !force) { renderNews(); renderSoxl(); return; }
    $('newsMeta').textContent = '加载中…';
    fetch('news.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('missing'); return r.json(); })
      .then(function (j) {
        if (!j || !j.groups || !j.groups.length) throw new Error('bad');
        newsCache = j;
      })
      .catch(function () { newsCache = NEWS_FALLBACK; })
      .then(function () {
        renderSoxl();
        if (current === 'news') renderNews();
        renderNewsMeta();
      });
  }

  function renderNewsMeta() {
    if (!newsCache || !newsCache.updatedAt) {
      $('newsMeta').textContent = '未找到 news.json（用本地文件打开时会读不到，部署后可正常加载）';
      return;
    }
    $('newsMeta').textContent = '更新于 ' + newsCache.updatedAt;
  }

  function renderSoxlNews() {
    var items = soxlItems();
    $('soxlNewsCount').textContent = items.length ? items.length + ' 条' : '—';
    if (!newsCache) { $('soxlNewsList').innerHTML = '<div class="empty">加载中…</div>'; return; }
    if (!items.length) {
      $('soxlNewsList').innerHTML =
        '<div class="empty">没有标记 SOXL 的条目<br>' +
        '<span style="color:var(--ink-4)">在 news.json 里给条目加 "soxl": true，或在标题里带上 SOXL</span></div>';
      return;
    }
    $('soxlNewsList').innerHTML = items.map(function (it) {
      var meta = [];
      if (it.source) meta.push(esc(it.source));
      if (it.time) meta.push(esc(it.time));
      if (it._group) meta.push(esc(it._group));
      return '<div class="ni">' +
        '<div class="h">' + esc(it.title) + '</div>' +
        (it.body ? '<div class="b">' + esc(it.body) + '</div>' : '') +
        '<div class="m">' + meta.join('<span class="dotsep"></span>') +
        (it.url ? '<span class="dotsep"></span><a href="' + esc(it.url) + '" target="_blank" rel="noopener">原文 ↗</a>' : '') +
        '</div></div>';
    }).join('');
  }

  function renderNews() {
    if (!newsCache) { loadNews(); return; }
    renderNewsMeta();
    renderSoxlNews();

    var groups = newsCache.groups;
    var activeKey = data.activeNews || (groups[0] && groups[0].key);
    if (!groups.some(function (g) { return g.key === activeKey; })) activeKey = groups[0].key;

    $('newsSeg').innerHTML = groups.map(function (g) {
      return '<button class="' + (g.key === activeKey ? 'on' : '') + '" data-news="' + g.key + '">' +
        esc(g.name) + ' ' + g.items.length + '</button>';
    }).join('');

    var g = groups.filter(function (x) { return x.key === activeKey; })[0];
    if (!g || !g.items.length) {
      $('newsList').innerHTML = '<div class="empty">这一栏还没有内容</div>';
      return;
    }
    $('newsList').innerHTML = g.items.map(function (it) {
      var meta = [];
      if (it.source) meta.push(esc(it.source));
      if (it.time) meta.push(esc(it.time));
      return '<div class="ni">' +
        '<div class="h">' + (it.soxl ? '<span class="tag g" style="margin-right:6px">SOXL</span>' : '') + esc(it.title) + '</div>' +
        (it.body ? '<div class="b">' + esc(it.body) + '</div>' : '') +
        '<div class="m">' + meta.join('<span class="dotsep"></span>') +
        (it.url ? '<span class="dotsep"></span><a href="' + esc(it.url) + '" target="_blank" rel="noopener">原文 ↗</a>' : '') +
        '</div></div>';
    }).join('');
  }

  function pickNews(key) {
    data.activeNews = key;
    save();
    renderNews();
  }

  /* ---------------- 我的 ---------------- */

  function renderMe() {
    var s = data.settings;
    $('sName').value = s.name || '';
    $('sSymbol').value = s.symbol || '';
    $('sEnglish').value = s.englishTarget || '';
    $('sBook').value = s.book || '';
    $('sBookCur').value = s.bookCur || 0;
    $('sBookTotal').value = s.bookTotal || 320;
    $('sVocab').value = s.vocab || 0;

    var bookPct = pct(s.bookCur || 0, s.bookTotal || 0);
    var habitsTotal = Object.keys(data.habits).reduce(function (n, k) {
      return n + Object.keys(data.habits[k]).length;
    }, 0);
    $('meSub').textContent = '读书 ' + bookPct + '% · 累计打卡 ' + habitsTotal +
      ' 次 · 复盘 ' + data.trades.length + ' 笔';
    $('verFoot').innerHTML = '小羊的工作台 · 数据仅存本机<br>时区引擎 84 项单测通过';
  }

  function saveSettings() {
    var s = data.settings;
    s.name = ($('sName').value || '').trim() || '小羊';
    s.symbol = (($('sSymbol').value || '').trim() || 'SOXL').toUpperCase();
    s.englishTarget = ($('sEnglish').value || '').trim();
    s.book = ($('sBook').value || '').trim();
    s.bookCur = parseInt($('sBookCur').value, 10) || 0;
    s.bookTotal = parseInt($('sBookTotal').value, 10) || 320;
    s.vocab = parseInt($('sVocab').value, 10) || 0;
    save();
    renderHome(); renderMe();
    toast('已保存');
  }

  function exportData() {
    copyText(JSON.stringify({ v: 1, at: new Date().toISOString(), data: data }));
  }

  function importData() {
    openSheet('<h3>导入备份</h3>' +
      '<div class="field"><textarea class="inp" id="importText" placeholder=\'{"v":1,...}\'></textarea></div>' +
      '<div class="btn-row"><button class="btn gho" onclick="WB.closeSheet()">取消</button>' +
      '<button class="btn pri" onclick="WB.doImport()">导入</button></div>');
  }

  function doImport() {
    var txt = ($('importText').value || '').trim();
    var obj;
    try { obj = JSON.parse(txt); } catch (e) { toast('内容不是合法备份'); return; }
    var d = obj && obj.data ? obj.data : obj;
    if (!d || typeof d !== 'object') { toast('备份格式不对'); return; }
    data = fillDefaults(d);
    save(); closeSheet();
    renderHome(); renderMe(); renderTrade();
    toast('导入成功');
  }

  function clearAll() {
    if (!window.confirm('会清空打卡、复盘记录、设置等全部数据，确定吗？')) return;
    data = clone(DEFAULT_DATA);
    seedTodos();
    save();
    renderHome(); renderMe(); renderTrade();
    toast('已清空');
  }

  /* ---------------- 事件绑定 ---------------- */

  function bindEvents() {
    document.querySelector('nav').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-go]');
      if (b) go(b.getAttribute('data-go'));
    });

    $('todoList').addEventListener('click', function (e) {
      var del = e.target.closest('[data-del-todo]');
      if (del) {
        var id = del.getAttribute('data-del-todo');
        data.todos = data.todos.filter(function (t) { return t.id !== id; });
        save(); renderTodos();
        return;
      }
      var row = e.target.closest('[data-todo]');
      if (row) {
        var tid = row.getAttribute('data-todo');
        data.todos = data.todos.map(function (t) {
          return t.id === tid ? Object.assign(t, { done: !t.done }) : t;
        });
        save(); renderTodos();
      }
    });

    $('habitChips').addEventListener('click', function (e) {
      var chip = e.target.closest('[data-habit]');
      if (chip) toggleHabit(chip.getAttribute('data-habit'));
    });

    ['cShares', 'cEntry', 'cStop'].forEach(function (id) {
      $(id).addEventListener('input', renderCalc);
    });

    $('dirSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-dir]');
      if (!b) return;
      calcDir = b.getAttribute('data-dir');
      var bs = $('dirSeg').querySelectorAll('button');
      for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', bs[i] === b);
      renderCalc();
    });

    $('calcToTrade').addEventListener('click', function () {
      var c = calcInput();
      var r = computePosition(c);
      if (r.empty) { toast('先填股数和入场价'); return; }
      if (r.invalid) { toast(r.tip); return; }
      openTrade();
      $('tEntry').value = String(c.entry);
      $('tShares').value = String(c.shares);
      if (r.perUnit !== null) $('tStop').value = String(c.stop);
      tradeDir = c.dir;
      var bs = $('tDir').querySelectorAll('button');
      for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', bs[i].getAttribute('data-dir') === c.dir);
      previewTrade();
    });

    $('tradeList').addEventListener('click', function (e) {
      var c = e.target.closest('[data-close]');
      if (c) { fillExit(c.getAttribute('data-close')); return; }
      var d = e.target.closest('[data-deltrade]');
      if (d) {
        var id = d.getAttribute('data-deltrade');
        if (!window.confirm('删除这条复盘记录？')) return;
        data.trades = data.trades.filter(function (t) { return t.id !== id; });
        save(); renderTrade(); renderHome();
      }
    });

    /* 弹层内的事件委托：方向切换、实时预览 */
    $('sheetBody').addEventListener('click', function (e) {
      var b = e.target.closest('#tDir button[data-dir]');
      if (b) {
        tradeDir = b.getAttribute('data-dir');
        var bs = $('tDir').querySelectorAll('button');
        for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', bs[i] === b);
        previewTrade();
      }
    });
    $('sheetBody').addEventListener('input', function (e) {
      var id = e.target && e.target.id;
      if (id === 'tEntry' || id === 'tShares' || id === 'tExit' || id === 'tStop') previewTrade();
    });

    $('musicList').addEventListener('click', function (e) {
      var row = e.target.closest('[data-music]');
      if (row) pickMusic(parseInt(row.getAttribute('data-music'), 10));
    });

    $('newsSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-news]');
      if (b) pickNews(b.getAttribute('data-news'));
    });
  }

  /* ---------------- 时钟 ---------------- */

  var timer = null;
  var newsTimer = null;

  function tick() {
    if (document.hidden) return;
    if (current === 'home') renderHome();
    else if (current === 'trade') renderTrade();
  }

  function start() {
    load();
    bindEvents();
    renderHome();
    renderMe();
    loadNews();
    loadMusic();

    var delay = 1000 - (Date.now() % 1000);
    setTimeout(function () {
      tick();
      timer = setInterval(tick, 1000);
    }, delay);

    newsTimer = setInterval(function () { if (!document.hidden) loadNews(true); }, 30 * 60 * 1000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { tick(); loadNews(false); }
    });

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      });
    }
  }

  /* ---------------- 导出 ---------------- */

  window.WB = {
    go: go,
    openTodo: openTodo,
    addTodo: addTodo,
    closeSheet: closeSheet,
    openTrade: openTrade,
    saveTrade: saveTrade,
    fillExit: fillExit,
    doFillExit: doFillExit,
    toggleHabit: toggleHabit,
    copyMusicLink: copyMusicLink,
    openMusicApp: openMusicApp,
    pickMusic: pickMusic,
    pickNews: pickNews,
    loadNews: loadNews,
    saveSettings: saveSettings,
    exportData: exportData,
    importData: importData,
    doImport: doImport,
    clearAll: clearAll,
    _internal: {
      HABITS: HABITS,
      DEFAULT_DATA: DEFAULT_DATA,
      computePnl: computePnl,
      computePosition: computePosition,
      reviewStats: reviewStats,
      soxlItems: soxlItems,
      streakDays: streakDays,
      habitStreak: habitStreak,
      todayKey: todayKey,
      money: money,
      price: price,
      getData: function () { return data; },
      setData: function (d) { data = fillDefaults(d); return data; },
      renderHome: renderHome,
      renderTrade: renderTrade,
      renderNews: renderNews,
      renderMusic: renderMusic,
      renderSoxl: renderSoxl,
      previewTrade: previewTrade,
      setCalcDir: function (d) { calcDir = d; },
      load: load,
      save: save,
      setMusicCache: function (m) { musicCache = m; },
      setNewsCache: function (n) { newsCache = n; }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
