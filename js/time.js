/**
 * 时区与交易时段引擎（纯逻辑，便于单独测试）
 * ------------------------------------------------------------
 * 核心事实：美东 20:00（盘后收盘）= 北京 08:00（次日）
 *   夏令时 EDT(UTC-4)：美东 20:00 = 北京 08:00  => 北京 8:00-16:00 = 美东 20:00-04:00
 *   冬令时 EST(UTC-5)：美东 20:00 = 北京 09:00  => 北京 8:00-16:00 = 美东 19:00-03:00
 * 因此「小羊的夜盘窗口」起点锚定在**美东盘后收盘时刻**，不是固定北京时间。
 * 这样冬夏令时切换时，窗口会自动跟着美股节奏平移 1 小时。
 *
 * 所有函数都不依赖运行环境的本地时区，只做 UTC 运算 + 固定偏移。
 */

const ET_DST = -4; // 夏令时 EDT
const ET_STD = -5; // 冬令时 EST
const BJ_OFFSET = 8; // 北京时间固定 UTC+8

/* 美东时间轴（小时，可用小数） */
const ET_PRE_OPEN = 4; // 盘前开始
const ET_OPEN = 9.5; // 连续竞价开盘
const ET_CLOSE = 16; // 常规收盘（有提前收盘日则更早）
const ET_AFTER_CLOSE = 20; // 盘后收盘（= 次日北京 08:00/09:00）

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/* 美股休市日 2025-2027 */
const HOLIDAYS = {
  '2025-01-01': "New Year's Day",
  '2025-01-09': 'National Day of Mourning',
  '2025-01-20': 'Martin Luther King Jr. Day',
  '2025-02-17': "Washington's Birthday",
  '2025-04-18': 'Good Friday',
  '2025-05-26': 'Memorial Day',
  '2025-06-19': 'Juneteenth',
  '2025-07-04': 'Independence Day',
  '2025-09-01': 'Labor Day',
  '2025-11-27': 'Thanksgiving Day',
  '2025-12-25': 'Christmas Day',
  '2026-01-01': "New Year's Day",
  '2026-01-19': 'Martin Luther King Jr. Day',
  '2026-02-16': "Washington's Birthday",
  '2026-04-03': 'Good Friday',
  '2026-05-25': 'Memorial Day',
  '2026-06-19': 'Juneteenth',
  '2026-07-03': 'Independence Day (observed)',
  '2026-09-07': 'Labor Day',
  '2026-11-26': 'Thanksgiving Day',
  '2026-12-25': 'Christmas Day',
  '2027-01-01': "New Year's Day",
  '2027-01-18': 'Martin Luther King Jr. Day',
  '2027-02-15': "Washington's Birthday",
  '2027-03-26': 'Good Friday',
  '2027-05-31': 'Memorial Day',
  '2027-06-18': 'Juneteenth (observed)',
  '2027-07-05': 'Independence Day (observed)',
  '2027-09-06': 'Labor Day',
  '2027-11-25': 'Thanksgiving Day',
  '2027-12-24': 'Christmas Day (observed)'
};

/* 提前收盘日（美东 13:00 收盘） */
const EARLY_CLOSES = {
  '2025-07-03': 13,
  '2025-11-28': 13,
  '2025-12-24': 13,
  '2026-11-27': 13,
  '2026-12-24': 13,
  '2027-11-26': 13
};

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

/* ---------------- 夏令时判定 ---------------- */

function secondSundayUtc(year, monthIndex) {
  const first = Date.UTC(year, monthIndex, 1);
  const dow = new Date(first).getUTCDay();
  const offset = dow === 0 ? 7 : 7 - dow;
  return Date.UTC(year, monthIndex, 1 + offset, 7, 0, 0); // 美东 02:00 EST = UTC 07:00
}

function firstSundayUtc(year, monthIndex) {
  const first = Date.UTC(year, monthIndex, 1);
  const dow = new Date(first).getUTCDay();
  const offset = dow === 0 ? 0 : 7 - dow;
  return Date.UTC(year, monthIndex, 1 + offset, 6, 0, 0); // 美东 02:00 EDT = UTC 06:00
}

function isDst(ts) {
  const year = new Date(ts).getUTCFullYear();
  return ts >= secondSundayUtc(year, 2) && ts < firstSundayUtc(year, 10);
}

function etOffset(ts) {
  return isDst(ts) ? ET_DST : ET_STD;
}

/* ---------------- 时间切分 ---------------- */

function partsAt(ts, offsetHours) {
  const d = new Date(ts + offsetHours * 3600000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes()
  };
}

function etParts(ts) {
  return partsAt(ts, etOffset(ts));
}

function bjParts(ts) {
  return partsAt(ts, BJ_OFFSET);
}

function dateKey(p) {
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

function etDateKey(ts) {
  return dateKey(etParts(ts));
}

function bjDateKey(ts) {
  return dateKey(bjParts(ts));
}

function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { y: y, m: m, d: d };
}

/** 美东某日 00:00 对应的 UTC 时间戳 */
function etDayStartUtc(key) {
  const { y, m, d } = parseKey(key);
  const guess = Date.UTC(y, m - 1, d, 5, 0, 0);
  return Date.UTC(y, m - 1, d, 0, 0, 0) - etOffset(guess) * 3600000;
}

/** 美东某日 h 时（可用小数）对应的 UTC 时间戳 */
function etAt(key, hour) {
  const h = Math.floor(hour);
  const min = Math.round((hour - h) * 60);
  return etDayStartUtc(key) + (h * 60 + min) * 60000;
}

/** 北京某日 h 时对应的 UTC 时间戳 */
function bjAt(key, hour, minute) {
  const { y, m, d } = parseKey(key);
  return Date.UTC(y, m - 1, d, hour || 0, minute || 0, 0) - BJ_OFFSET * 3600000;
}

function shiftKey(key, deltaDays) {
  const { y, m, d } = parseKey(key);
  const t = Date.UTC(y, m - 1, d, 12, 0, 0) + deltaDays * 86400000;
  const nd = new Date(t);
  return `${nd.getUTCFullYear()}-${pad2(nd.getUTCMonth() + 1)}-${pad2(nd.getUTCDate())}`;
}

/** 北京日期键平移（用于跨时区的日期归属） */
function shiftBjKeyToEt(key, deltaDays) {
  return shiftKey(key, deltaDays);
}

/* ---------------- 交易日 ---------------- */

function tradingDayInfo(key) {
  const { y, m, d } = parseKey(key);
  const weekday = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
  if (weekday === 0 || weekday === 6) {
    return { isTrading: false, reason: '周末休市', holiday: null, earlyClose: null, weekday: weekday };
  }
  if (HOLIDAYS[key]) {
    return { isTrading: false, reason: HOLIDAYS[key], holiday: HOLIDAYS[key], earlyClose: null, weekday: weekday };
  }
  const early = EARLY_CLOSES[key] || null;
  return {
    isTrading: true,
    reason: early ? `提前收盘 ${early}:00` : '正常交易日',
    holiday: null,
    earlyClose: early,
    weekday: weekday
  };
}

function closeHour(key) {
  const info = tradingDayInfo(key);
  return info.earlyClose || ET_CLOSE;
}

/** 下一个交易日（若含当天则返回当天） */
function nextTradingDay(key, inclusive) {
  let cursor = inclusive ? key : shiftKey(key, 1);
  for (let i = 0; i < 15; i++) {
    if (tradingDayInfo(cursor).isTrading) return cursor;
    cursor = shiftKey(cursor, 1);
  }
  return cursor;
}

/** 上一个交易日（含当天则返回当天） */
function prevTradingDay(key, inclusive) {
  let cursor = key;
  if (!inclusive) cursor = shiftKey(cursor, -1);
  for (let i = 0; i < 15; i++) {
    if (tradingDayInfo(cursor).isTrading) return cursor;
    cursor = shiftKey(cursor, -1);
  }
  return cursor;
}

/* ---------------- 工作窗口（小羊的作息） ---------------- */
/**
 * 最终确认的作息（小羊本人核对过）：
 *   上班：北京时间 周一 ~ 周五 08:00 - 16:00
 *   休息：周六、周日
 *
 * 由于北京时间比美东快 12~13 小时，同一时刻跨美东日期，
 * 因此这五个北京工作日对应的美东区间正好是：
 *   美东 【周日盘后收盘 20:00】 → 【周五盘前开始 04:00】
 *
 * 北京 → 美东 逐日对照（夏令时 EDT，冬令时 EST 整体早 1 小时）：
 *   北京 周一 08:00-16:00  =  美东 周日 20:00 → 周一 04:00
 *   北京 周二 08:00-16:00  =  美东 周一 20:00 → 周二 04:00
 *   北京 周三 08:00-16:00  =  美东 周二 20:00 → 周三 04:00
 *   北京 周四 08:00-16:00  =  美东 周三 20:00 → 周四 04:00
 *   北京 周五 08:00-16:00  =  美东 周四 20:00 → 周五 04:00
 *   北京 周六、周日 = 休息
 *
 * 关键点：**窗口完全由北京星期决定**，不受美股节假日影响。
 * 之前绑在「美东交易日」上是错的，会把窗口推到周二~周六。
 */

const WORK_HOURS = 8;          // 每个工作日 8 小时
const WORK_BJ_START_DST = 8;   // 夏令时：北京 08:00 上班
const WORK_BJ_START_STD = 9;   // 冬令时：北京 09:00 上班（= 美东 20:00）

/** 按北京日期键取星期几 */
function bjWeekday(dateKey) {
  const { y, m, d } = parseKey(dateKey);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
}

/** 该北京日期是否上班（周一~周五） */
function isWorkDay(dateKey) {
  const wd = bjWeekday(dateKey);
  return wd >= 1 && wd <= 5;
}

/** 该北京日期上班时，对应美东的 UTC 偏移（用当天中午判定，避免切换日抖动） */
function workEtOffset(dateKey) {
  const { y, m, d } = parseKey(dateKey);
  return etOffset(Date.UTC(y, m - 1, d, 12, 0, 0));
}

/** 该北京日期对应的「北京上班时刻」（夏令时 08:00 / 冬令时 09:00） */
function workStartHourBjy(dateKey) {
  return workEtOffset(dateKey) === ET_DST ? WORK_BJ_START_DST : WORK_BJ_START_STD;
}

/**
 * 建立某个北京工作日对应的窗口。
 * 只有工作日才有窗口；周末返回 null。
 */
function buildWorkWindow(dateKey) {
  if (!isWorkDay(dateKey)) return null;
  const offset = workEtOffset(dateKey);
  const hour = offset === ET_DST ? WORK_BJ_START_DST : WORK_BJ_START_STD;
  const start = bjAt(dateKey, hour, 0);
  const end = start + WORK_HOURS * 3600000;

  /* 窗口期间的真正偏移（窗口起点处判定），用于算出美东钟点 */
  const offAtStart = etOffset(start);
  const etStart = start + offAtStart * 3600000;
  const etEnd = end + offAtStart * 3600000;

  return {
    dateKey: dateKey,
    start: start,
    end: end,
    hours: WORK_HOURS,
    bjStart: bjParts(start),
    bjEnd: bjParts(end),
    /** 美东起止（真实换算） */
    etStart: etParts(start),
    etEnd: etParts(end),
    etOffset: offAtStart,
    /** 美东钟点文案，例如 20:00 / 04:00 */
    etStartText: hhmmEt(start),
    etEndText: hhmmEt(end),
    /** 美东日期文案，例如 周日 / 周一 */
    etStartWeekday: WEEKDAY_CN[etParts(start).weekday],
    etEndWeekday: WEEKDAY_CN[etParts(end).weekday],
    /** 完整美东对照，例如「周日 20:00 → 周一 04:00」 */
    etRangeText: `${WEEKDAY_CN[etParts(start).weekday]} ${hhmmEt(start)} → ${WEEKDAY_CN[etParts(end).weekday]} ${hhmmEt(end)}`,
    /** 该窗口最终的落点：次日（美东）盘前开始——对外用「美东周几」标注更直观 */
    sessionWeekday: WEEKDAY_CN[etParts(end).weekday]
  };
}

/** 生成 [fromKey, toKey] 之内所有北京工作日 */
function workDaysBetween(fromKey, toKey) {
  const out = [];
  let cursor = fromKey;
  for (let i = 0; i < 40; i++) {
    if (cursor > toKey) break;
    if (isWorkDay(cursor)) out.push(cursor);
    cursor = shiftKey(cursor, 1);
  }
  return out;
}

/**
 * 当前工作窗口状态。
 * 所有对外时间量单位统一为**秒**。
 */
function nightState(ts) {
  const now = typeof ts === 'number' ? ts : Date.now();
  const bjKey = bjDateKey(now);
  const keys = workDaysBetween(shiftKey(bjKey, -8), shiftKey(bjKey, 8));
  const windows = keys.map((k) => buildWorkWindow(k)).filter(Boolean);

  let current = null;
  let prev = null;
  let next = null;
  windows.forEach((w) => {
    if (now >= w.start && now < w.end) {
      current = w;
    } else if (w.end <= now) {
      if (!prev || w.end > prev.end) prev = w;
    } else if (!next || w.start < next.start) {
      next = w;
    }
  });

  const state = {
    window: current,
    prevWindow: prev,
    nextWindow: next,
    inWindow: !!current,
    ref: current || next || prev
  };
  if (current) {
    state.progress = Math.min(1, Math.max(0, (now - current.start) / (current.end - current.start)));
    state.remainingSeconds = Math.floor((current.end - now) / 1000);
    state.elapsedSeconds = Math.floor((now - current.start) / 1000);
  } else if (next) {
    state.progress = 0;
    state.remainingSeconds = Math.floor((next.start - now) / 1000);
    state.elapsedSeconds = 0;
  } else {
    state.progress = 1;
    state.remainingSeconds = 0;
    state.elapsedSeconds = 0;
  }
  return state;
}

/** 兼容调用：返回当前或最近的窗口 */
function currentWindow(ts) {
  const s = nightState(ts);
  const w = s.window || s.nextWindow || s.prevWindow;
  return Object.assign({}, w, {
    active: s.inWindow,
    progress: s.progress,
    remainingSeconds: s.remainingSeconds,
    elapsedSeconds: s.elapsedSeconds,
    nextStart: s.nextWindow ? s.nextWindow.start : null
  });
}

/** 界面直接可用的工作窗口视图（时间量统一为秒） */
function nightView(ts) {
  const now = typeof ts === 'number' ? ts : Date.now();
  const s = nightState(now);
  return {
    inWindow: s.inWindow,
    window: s.window,
    prevWindow: s.prevWindow,
    nextWindow: s.nextWindow,
    ref: s.ref,
    progress: s.progress,
    elapsedSeconds: s.elapsedSeconds,
    remainingSeconds: s.remainingSeconds,
    untilEndSeconds: s.inWindow ? s.remainingSeconds : 0,
    untilNextSeconds: s.inWindow
      ? Math.floor(((s.nextWindow ? s.nextWindow.start : (s.ref ? s.ref.end : now)) - now) / 1000)
      : s.remainingSeconds
  };
}

/** 北京 8:00–16:00 这个意图窗口的起止（按当天北京 08:00 计算，用于展示对照） */
function intentWindow(ts) {
  const bjKey = bjDateKey(ts);
  return {
    start: bjAt(bjKey, 8, 0),
    end: bjAt(bjKey, 16, 0),
    bjKey: bjKey
  };
}

/* ---------------- 交易时段状态 ---------------- */

/**
 * 美东时间下当前处于哪个交易时段。
 * 返回 key: pre | regular | after | overnight（隔夜休市）
 */
function sessionAt(ts) {
  const key = etDateKey(ts);
  const info = tradingDayInfo(key);
  const p = etParts(ts);
  const ch = closeHour(key);

  if (!info.isTrading) {
    return {
      key: 'closed',
      label: '休市',
      desc: info.reason,
      color: 'gray',
      dayKey: key,
      dayInfo: info,
      progress: 0
    };
  }
  if (p.minutes >= ET_PRE_OPEN * 60 && p.minutes < ET_OPEN * 60) {
    return {
      key: 'pre',
      label: '盘前',
      desc: '盘前交易时段',
      color: 'amber',
      dayKey: key,
      dayInfo: info,
      progress: (p.minutes - ET_PRE_OPEN * 60) / ((ET_OPEN - ET_PRE_OPEN) * 60),
      start: etAt(key, ET_PRE_OPEN),
      end: etAt(key, ET_OPEN)
    };
  }
  if (p.minutes >= ET_OPEN * 60 && p.minutes < ch * 60) {
    return {
      key: 'regular',
      label: '盘中',
      desc: '连续竞价时段',
      color: 'green',
      dayKey: key,
      dayInfo: info,
      progress: (p.minutes - ET_OPEN * 60) / ((ch - ET_OPEN) * 60),
      start: etAt(key, ET_OPEN),
      end: etAt(key, ch)
    };
  }
  if (p.minutes >= ch * 60 && p.minutes < ET_AFTER_CLOSE * 60) {
    return {
      key: 'after',
      label: '盘后',
      desc: '盘后交易时段',
      color: 'blue',
      dayKey: key,
      dayInfo: info,
      progress: (p.minutes - ch * 60) / ((ET_AFTER_CLOSE - ch) * 60),
      start: etAt(key, ch),
      end: etAt(key, ET_AFTER_CLOSE)
    };
  }
  return {
    key: 'overnight',
    label: '隔夜',
    desc: '盘后已收，等待盘前',
    color: 'gray',
    dayKey: key,
    dayInfo: info,
    progress: 0,
    start: etAt(key, ET_AFTER_CLOSE),
    end: etAt(key, ET_AFTER_CLOSE)
  };
}

/* ---------------- 关键时间锚点 ---------------- */

/**
 * 下一个锚点。name 对应：
 * afterClose 盘后收盘（= 小羊上班）
 * preOpen    盘前开始
 * open       连续竞价开盘
 * close      常规收盘
 */
function nextAnchor(ts, name) {
  const todayKey = etDateKey(ts);
  const tryKeys = [todayKey, nextTradingDay(shiftKey(todayKey, 1), true)];

  for (let i = 0; i < tryKeys.length; i++) {
    const key = tryKeys[i];
    const info = tradingDayInfo(key);
    if (!info.isTrading) continue;
    const hour = name === 'afterClose' ? ET_AFTER_CLOSE
      : name === 'preOpen' ? ET_PRE_OPEN
      : name === 'open' ? ET_OPEN
      : closeHour(key);
    const at = etAt(key, hour);
    if (at > ts) {
      return { name: name, at: at, etKey: key, etHour: hour, dayInfo: info, isToday: key === todayKey };
    }
  }
  /* 兜底：再往后找一个交易日 */
  const key = nextTradingDay(shiftKey(todayKey, 2), true);
  const hour = name === 'afterClose' ? ET_AFTER_CLOSE : name === 'preOpen' ? ET_PRE_OPEN : name === 'open' ? ET_OPEN : closeHour(key);
  return { name: name, at: etAt(key, hour), etKey: key, etHour: hour, dayInfo: tradingDayInfo(key), isToday: false };
}

/** 权威的「当前 + 下一个」信息包 */
function marketSnapshot(ts) {
  const now = typeof ts === 'number' ? ts : Date.now();
  const session = sessionAt(now);
  const night = nightView(now);
  const anchors = {
    afterClose: nextAnchor(now, 'afterClose'),
    preOpen: nextAnchor(now, 'preOpen'),
    open: nextAnchor(now, 'open'),
    close: nextAnchor(now, 'close')
  };

  return {
    now: now,
    session: session,
    night: night,
    window: night.window,
    anchors: anchors,
    /* 下一次上班（盘后收盘）—— 小羊最关心的时间点，单位秒 */
    primary: {
      name: 'afterClose',
      at: anchors.afterClose.at,
      seconds: Math.max(0, Math.floor((anchors.afterClose.at - now) / 1000))
    },
    openIn: Math.max(0, Math.floor((anchors.open.at - now) / 1000)),
    closeIn: Math.max(0, Math.floor((anchors.close.at - now) / 1000)),
    dst: isDst(now),
    etNow: etParts(now),
    bjNow: bjParts(now)
  };
}

const ANCHOR_LABEL = {
  afterClose: '盘后收盘',
  preOpen: '盘前开始',
  open: '连续竞价开盘',
  close: '常规收盘'
};

/* ---------------- 格式化 ---------------- */

function hhmm(ts) {
  const p = bjParts(ts);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

function hhmmEt(ts) {
  const p = etParts(ts);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

function mmdd(ts) {
  const p = bjParts(ts);
  return `${p.month}/${p.day}`;
}

function mmddEt(ts) {
  const p = etParts(ts);
  return `${p.month}/${p.day}`;
}

function weekdayCn(ts) {
  return WEEKDAY_CN[bjParts(ts).weekday];
}

function countdown(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}天 ${pad2(h)}:${pad2(m)}:${pad2(sec)}`;
  return `${pad2(h)}:${pad2(m)}:${pad2(sec)}`;
}

function countdownShort(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分钟`;
}

/** 描述性时长文案（用于说明哪一天上班） */
function describeDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h > 0 ? `${d} 天 ${h} 小时` : `${d} 天`;
  if (h > 0) return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`;
  return `${m} 分钟`;
}

/* ---------------- 时段轴（用于展示） ---------------- */

function timelineFor(ts) {
  const key = etDateKey(ts);
  const info = tradingDayInfo(key);
  const ch = closeHour(key);
  const p = etParts(ts);
  const rows = [
    { key: 'pre', name: '盘前', start: ET_PRE_OPEN, end: ET_OPEN, color: 'amber' },
    { key: 'regular', name: '连续竞价', start: ET_OPEN, end: ch, color: 'green' },
    { key: 'after', name: '盘后', start: ch, end: ET_AFTER_CLOSE, color: 'blue' }
  ];
  return rows.map((r) => {
    const s = etAt(key, r.start);
    const e = etAt(key, r.end);
    let state = 'future';
    if (!info.isTrading) state = 'closed';
    else if (p.minutes >= r.start * 60 && p.minutes < r.end * 60) state = 'current';
    else if (p.minutes >= r.end * 60) state = 'past';
    return {
      key: r.key,
      name: r.name,
      color: r.color,
      state: state,
      etRange: `${fmtHour(r.start)} - ${fmtHour(r.end)} 美东`,
      bjRange: `${mmdd(s)} ${hhmm(s)} - ${mmdd(e)} ${hhmm(e)} 北京`
    };
  });
}

function fmtHour(v) {
  const h = Math.floor(v);
  const m = Math.round((v - h) * 60);
  return `${pad2(h)}:${pad2(m)}`;
}

/** 接下来的休市日 */
function upcomingHolidays(ts, count) {
  const out = [];
  let cursor = etDateKey(ts);
  const limit = count || 4;
  for (let i = 0; i < 400 && out.length < limit; i++) {
    cursor = shiftKey(cursor, 1);
    const info = tradingDayInfo(cursor);
    if (!info.isTrading && info.holiday) out.push({ date: cursor, name: info.holiday });
  }
  return out;
}

/** 冬夏令时文案 */
function dstLabel(ts) {
  const timing = typeof ts === 'number' ? ts : Date.now();
  return isDst(timing) ? '夏令时 EDT' : '冬令时 EST';
}

/** 北京 8:00-16:00 对应的美东窗口文案 */
function windowEtLabel(ts) {
  const s = nightState(ts);
  const w = s.window || s.nextWindow || s.prevWindow;
  if (!w) return '—';
  return `${mmddEt(w.start)} ${hhmmEt(w.start)} - ${mmddEt(w.end)} ${hhmmEt(w.end)}`;
}

/* 导出（同时兼容浏览器与 node 测试） */
const EXPORTS = {
  ET_DST,
  ET_STD,
  ET_PRE_OPEN,
  ET_OPEN,
  ET_CLOSE,
  ET_AFTER_CLOSE,
  HOLIDAYS,
  EARLY_CLOSES,
  WEEKDAY_CN,
  ANCHOR_LABEL,
  pad2,
  isDst,
  etOffset,
  etParts,
  bjParts,
  etDateKey,
  bjDateKey,
  etAt,
  bjAt,
  shiftKey,
  shiftBjKeyToEt,
  tradingDayInfo,
  closeHour,
  nextTradingDay,
  prevTradingDay,
  bjWeekday,
  isWorkDay,
  workEtOffset,
  workStartHourBjy,
  buildWorkWindow,
  workDaysBetween,
  nightState,
  nightView,
  currentWindow,
  intentWindow,
  sessionAt,
  nextAnchor,
  marketSnapshot,
  hhmm,
  hhmmEt,
  mmdd,
  mmddEt,
  weekdayCn,
  countdown,
  countdownShort,
  describeDuration,
  timelineFor,
  fmtHour,
  upcomingHolidays,
  dstLabel,
  windowEtLabel
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = EXPORTS;
}
if (typeof window !== 'undefined') {
  window.WBTime = EXPORTS;
}
