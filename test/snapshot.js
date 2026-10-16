/**
 * 真实当前时间下的行为快照（人工核对用）。
 * 运行：node test/snapshot.js
 */
const T = require('../js/time.js');

const now = Date.now();
const DAY = 86400000;
const wd = (ts) => T.WEEKDAY_CN[T.bjParts(ts).weekday];
const etwd = (ts) => T.WEEKDAY_CN[T.etParts(ts).weekday];
const COL = (s, n) => String(s).padEnd(n);

console.log('现在：');
console.log('  北京时间 ', T.bjDateKey(now), wd(now), T.hhmm(now));
console.log('  美东时间 ', T.etDateKey(now), etwd(now), T.hhmmEt(now));
console.log('  模式     ', T.dstLabel(now));
console.log('  是否上班 ', T.nightState(now).inWindow ? '是' : '否');

console.log('\n===== 本周排班表（按北京日期）=====');
console.log(COL('北京日期', 20) + COL('是否上班', 10) + '对应美东');
console.log('-'.repeat(70));
/* 从本周一算起 */
const bjKey = T.bjDateKey(now);
const w = T.bjWeekday(bjKey);
const monday = T.shiftKey(bjKey, w === 0 ? -6 : -(w - 1));
for (let d = 0; d < 7; d++) {
  const key = T.shiftKey(monday, d);
  const win = T.buildWorkWindow(key);
  console.log(
    COL(key + ' ' + T.WEEKDAY_CN[T.bjWeekday(key)], 20),
    COL(win ? '上班' : '休息', 10),
    win ? win.etRangeText + '  （北京 ' + T.hhmm(win.start) + '-' + T.hhmm(win.end) + '）' : '—'
  );
}

console.log('\n===== 接下来 5 个工作日 =====');
{
  let printed = 0;
  let cursor = bjKey;
  for (let i = 0; i < 20 && printed < 5; i++) {
    const win = T.buildWorkWindow(cursor);
    if (win) {
      /* 用「当前时间」和该窗口自己比较，而不是用 nightState 的当前窗口 */
      const state = now >= win.end ? '已过' : (now >= win.start ? '进行中' : '未开始');
      console.log(
        COL(cursor + ' ' + T.WEEKDAY_CN[T.bjWeekday(cursor)], 20),
        COL('北京 ' + T.hhmm(win.start) + '-' + T.hhmm(win.end), 22),
        COL('美东 ' + win.etRangeText, 34),
        state
      );
      printed++;
    }
    cursor = T.shiftKey(cursor, 1);
  }
}

console.log('\n===== 当前时刻前后扫描（每 2 小时）=====');
console.log(COL('场景', 10) + '| ' + COL('北京', 18) + '| ' + COL('美东', 18) + '| ' + COL('时段', 6) + '| ' + COL('上班?', 6) + '| 今天对应美东');
console.log('-'.repeat(112));
for (let h = -4; h <= 26; h += 2) {
  const ts = now + h * 3600000;
  const s = T.marketSnapshot(ts);
  /* 「今天对应美东」应取当天的窗口，而不是下一个窗口 */
  const todayWin = T.buildWorkWindow(T.bjDateKey(ts));
  console.log(
    COL(h === 0 ? '现在' : (h > 0 ? '+' + h + 'h' : h + 'h'), 10) + '| ' +
    COL(T.bjDateKey(ts).slice(5) + ' ' + wd(ts) + ' ' + T.hhmm(ts), 18) + '| ' +
    COL(T.etDateKey(ts).slice(5) + ' ' + etwd(ts) + ' ' + T.hhmmEt(ts), 18) + '| ' +
    COL(s.session.label, 6) + '| ' +
    COL(s.night.inWindow ? '上班' : '休息', 6) + '| ' +
    (todayWin ? todayWin.etRangeText : '休息日')
  );
}

console.log('\n===== 你给的例子校验 =====');
const ex1 = Date.parse('2026-10-16T00:00:00Z'); // 北京 10-16 08:00
const ex2 = Date.parse('2026-10-16T08:00:00Z'); // 北京 10-16 16:00
console.log('北京 2026-10-16 08:00 -> 美东', T.etDateKey(ex1), T.hhmmEt(ex1), ' 期望 2026-10-15 20:00');
console.log('北京 2026-10-16 16:00 -> 美东', T.etDateKey(ex2), T.hhmmEt(ex2), ' 期望 2026-10-16 04:00');
const s1 = T.marketSnapshot(ex1);
console.log('08:00 是否上班:', s1.night.inWindow, '（2026-10-16 是周五，应上班）');
console.log('当天对应美东:', s1.night.ref ? s1.night.ref.etRangeText : '—');
console.log('当班剩余(秒):', s1.night.untilEndSeconds, '=', T.countdown(s1.night.untilEndSeconds));
