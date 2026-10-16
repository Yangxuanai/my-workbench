/**
 * 时间引擎单测：node test/test-time.js
 * 覆盖：工作日规则（北京周一~周五）、冬夏令时、跨周末、单位回归、交易时段、锚点。
 */
const T = require('../js/time.js');

let pass = 0;
let fail = 0;

function eq(name, got, want) {
  if (got === want) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  期望 ${JSON.stringify(want)}，得到 ${JSON.stringify(got)}`); }
}
function truthy(name, got) {
  if (got) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  (假值)`); }
}
const ts = (s) => Date.parse(s);

console.log('\n[1] 夏令时判定');
truthy('2026-08-17 是夏令时', T.isDst(ts('2026-08-17T14:00:00Z')) === true);
truthy('2026-01-05 是冬令时', T.isDst(ts('2026-01-05T15:30:00Z')) === false);
eq('切换前 2026-03-08 01:00 ET 属冬令时', T.isDst(ts('2026-03-08T06:00:00Z')), false);
eq('切换后 2026-03-08 04:00 ET 属夏令时', T.isDst(ts('2026-03-08T08:00:00Z')), true);
eq('11月切换 2026-11-01 00:30 ET 仍夏令时', T.isDst(ts('2026-11-01T04:30:00Z')), true);
eq('11月切换 2026-11-01 02:30 ET 已冬令时', T.isDst(ts('2026-11-01T07:30:00Z')), false);

console.log('\n[2] 工作窗口：北京 周一 08:00-16:00（夏令时）');
{
  /* 北京 2026-08-17 周一 08:00 = UTC 08-17 00:00 = 美东 08-16 周日 20:00 */
  const mon = ts('2026-08-17T00:00:00Z');
  eq('北京周一 08:00', T.hhmm(mon), '08:00');
  eq('对应美东周日 20:00', T.etDateKey(mon) + ' ' + T.hhmmEt(mon), '2026-08-16 20:00');

  const w = T.buildWorkWindow('2026-08-17');
  truthy('周一有窗口', !!w);
  eq('窗口起点就是北京 08:00', w.start, mon);
  eq('窗口终点北京 16:00', T.hhmm(w.end), '16:00');
  eq('窗口跨度 8 小时', (w.end - w.start) / 3600000, 8);
  eq('美东对照 = 周日 20:00 → 周一 04:00', w.etRangeText, '周日 20:00 → 周一 04:00');
  eq('窗口起点美东 20:00', T.hhmmEt(w.start), '20:00');
  eq('窗口终点美东 04:00', T.hhmmEt(w.end), '04:00');

  const s = T.nightState(mon);
  truthy('此刻正在窗口内', s.inWindow === true);
  eq('窗口归属北京周一', s.window.dateKey, '2026-08-17');
}

console.log('\n[3] 工作日严格是周一~周五');
{
  const week = [
    ['2026-08-17', '周一', true],
    ['2026-08-18', '周二', true],
    ['2026-08-19', '周三', true],
    ['2026-08-20', '周四', true],
    ['2026-08-21', '周五', true],
    ['2026-08-22', '周六', false],
    ['2026-08-23', '周日', false]
  ];
  week.forEach(function (row) {
    const key = row[0];
    eq(key + ' 是' + row[1], T.WEEKDAY_CN[T.bjWeekday(key)], row[1]);
    eq('  ' + row[1] + ' 是否上班', T.isWorkDay(key), row[2]);
    eq('  ' + row[1] + ' 是否有窗口', !!T.buildWorkWindow(key), row[2]);
  });
  /* 回归：旧 bug 把上班日推到了周二~周六 */
  eq('周六不是上班日（回归）', T.isWorkDay('2026-08-22'), false);
  eq('周一是上班日（回归）', T.isWorkDay('2026-08-17'), true);
  eq('周日不是上班日', T.isWorkDay('2026-08-23'), false);
}

console.log('\n[4] 周一到周五对应的美东逐日对照（夏令时）');
{
  const expect = [
    ['2026-08-17', '周一', '周日 20:00 → 周一 04:00'],
    ['2026-08-18', '周二', '周一 20:00 → 周二 04:00'],
    ['2026-08-19', '周三', '周二 20:00 → 周三 04:00'],
    ['2026-08-20', '周四', '周三 20:00 → 周四 04:00'],
    ['2026-08-21', '周五', '周四 20:00 → 周五 04:00']
  ];
  expect.forEach(function (row) {
    eq('北京' + row[1] + ' → 美东 ' + row[2], T.buildWorkWindow(row[0]).etRangeText, row[2]);
  });
  /* 整周正好覆盖「美东周日收盘 → 周五盘前」 */
  const first = T.buildWorkWindow('2026-08-17');
  const last = T.buildWorkWindow('2026-08-21');
  eq('整周起点 = 美东周日 20:00',
    T.WEEKDAY_CN[T.etParts(first.start).weekday] + ' ' + T.hhmmEt(first.start), '周日 20:00');
  eq('整周终点 = 美东周五 04:00',
    T.WEEKDAY_CN[T.etParts(last.end).weekday] + ' ' + T.hhmmEt(last.end), '周五 04:00');
}

console.log('\n[5] 冬令时：北京 09:00-17:00，美东仍是 20:00-04:00');
{
  const mon = ts('2027-01-04T01:00:00Z');
  eq('北京周一 09:00 = 美东周日 20:00', T.etDateKey(mon) + ' ' + T.hhmmEt(mon), '2027-01-03 20:00');
  const w = T.buildWorkWindow('2027-01-04');
  eq('冬令时窗口起点北京 09:00', T.hhmm(w.start), '09:00');
  eq('冬令时窗口终点北京 17:00', T.hhmm(w.end), '17:00');
  eq('冬令时窗口仍 8 小时', (w.end - w.start) / 3600000, 8);
  eq('冬令时美东对照不变', w.etRangeText, '周日 20:00 → 周一 04:00');
  eq('冬令时北京 08:00 尚未上班', T.nightState(ts('2027-01-04T00:00:00Z')).inWindow, false);
  /* 冬令时工作日同样是周一到周五 */
  eq('冬令时周六仍休息', T.isWorkDay('2027-01-09'), false);
}

console.log('\n[6] 周末状态');
{
  const sat = ts('2026-08-22T04:00:00Z'); // 北京周六 12:00
  eq('北京时间校验：周六', T.WEEKDAY_CN[T.bjParts(sat).weekday], '周六');
  const s = T.nightState(sat);
  eq('周六不上班', s.inWindow, false);
  eq('上一窗口 = 周五', s.prevWindow.dateKey, '2026-08-21');
  eq('下一窗口 = 下周一', s.nextWindow.dateKey, '2026-08-24');
  eq('距下周一上班 44 小时（周六12:00→周一08:00）', Math.round(s.remainingSeconds / 3600), 44);

  const sun = ts('2026-08-23T04:00:00Z');
  eq('北京时间校验：周日', T.WEEKDAY_CN[T.bjParts(sun).weekday], '周日');
  eq('周日不上班', T.nightState(sun).inWindow, false);

  /* 周一 07:00（上班前 1 小时） */
  const monBefore = ts('2026-08-16T23:00:00Z');
  const s2 = T.nightState(monBefore);
  eq('周一 07:00 还没上班', s2.inWindow, false);
  eq('距上班 1 小时', Math.round(s2.remainingSeconds / 3600), 1);
}

console.log('\n[7] 单位回归：对外时间量一律是「秒」');
{
  /* 历史 bug：nightState 给的是毫秒，被直接交给按秒设计的 countdown()，
     「还剩 2 小时」显示成「160 天」。这里把单位钉死。 */
  const mid = ts('2026-08-17T04:00:00Z'); // 周一 12:00，窗口已过 4 小时
  const s = T.nightState(mid);
  eq('nightState.remainingSeconds 是秒', s.remainingSeconds, 4 * 3600);
  eq('nightState.elapsedSeconds 是秒', s.elapsedSeconds, 4 * 3600);

  const v = T.nightView(mid);
  eq('nightView.remainingSeconds = 4 小时', v.remainingSeconds, 4 * 3600);
  eq('nightView.untilEndSeconds = 4 小时', v.untilEndSeconds, 4 * 3600);
  eq('倒计时文案 04:00:00（不是「160天」）', T.countdown(v.remainingSeconds), '04:00:00');

  const atStart = ts('2026-08-17T00:00:00Z');
  const v2 = T.nightView(atStart);
  eq('刚上班剩余 8 小时', T.countdown(v2.remainingSeconds), '08:00:00');
  eq('刚上班进度 0', v2.progress, 0);

  const rest = T.nightView(ts('2026-08-17T09:00:00Z')); // 北京 17:00，已下班 1 小时
  truthy('下班后不在窗口内', rest.inWindow === false);
  eq('下班后 remainingSeconds = 距下次上班 15 小时', rest.remainingSeconds, 15 * 3600);
  eq('下班后 untilEndSeconds 为 0', rest.untilEndSeconds, 0);
}

console.log('\n[8] 倒计时文案合理性');
{
  const v = T.nightView(ts('2026-08-17T04:00:00Z'));
  eq('上班中剩余不足 1 天', Math.floor(v.remainingSeconds / 86400), 0);
  const weekend = T.nightView(ts('2026-08-21T08:00:00Z')); // 周五 16:00 下班
  eq('周末最长空档 64 小时', Math.round(weekend.remainingSeconds / 3600), 64);
  truthy('不超过 3 天', Math.floor(weekend.remainingSeconds / 86400) <= 3);
}

console.log('\n[9] 交易时段识别');
{
  eq('美东 10:00 -> 盘中', T.sessionAt(ts('2026-08-17T14:00:00Z')).key, 'regular');
  eq('美东 05:00 -> 盘前', T.sessionAt(ts('2026-08-17T09:00:00Z')).key, 'pre');
  eq('美东 17:00 -> 盘后', T.sessionAt(ts('2026-08-17T21:00:00Z')).key, 'after');
  eq('美东 22:00 -> 隔夜', T.sessionAt(ts('2026-08-18T02:00:00Z')).key, 'overnight');
  eq('周六 -> 休市', T.sessionAt(ts('2026-08-22T14:00:00Z')).key, 'closed');
  eq('2026-07-03 独立日补休 -> 休市', T.sessionAt(ts('2026-07-03T14:00:00Z')).key, 'closed');
}

console.log('\n[10] 上班瞬间 = 美东盘后收盘');
{
  const before = ts('2026-08-16T22:00:00Z'); // 北京周一 06:00，上班前 2 小时
  const snap = T.marketSnapshot(before);
  const n = T.nightState(before);
  /* 距「今天上班」2 小时 */
  eq('距上班 2 小时', Math.round(n.remainingSeconds / 3600), 2);
  eq('下一窗口就是今天 08:00', T.bjDateKey(n.nextWindow.start) + ' ' + T.hhmm(n.nextWindow.start), '2026-08-17 08:00');
  /* 上班瞬间正是美东盘后收盘（20:00 ET） */
  eq('上班时刻对应美东 20:00', T.hhmmEt(n.nextWindow.start), '20:00');
  eq('该锚点后即进入工作窗口', T.nightState(n.nextWindow.start + 1000).inWindow, true);
  /* 「下一个盘后收盘锚点」指的是再下一班，用于跨度展示 */
  eq('下一个盘后收盘锚点是次日（美东周一）20:00', T.hhmmEt(snap.anchors.afterClose.at), '20:00');
  truthy('该锚点在未来', snap.anchors.afterClose.at > before);
}

console.log('\n[10b] 时长描述文案');
{
  eq('44 小时描述', T.describeDuration(44 * 3600), '1 天 20 小时');
  eq('2 小时描述', T.describeDuration(2 * 3600), '2 小时');
  eq('90 分钟描述', T.describeDuration(90 * 60), '1 小时 30 分');
  eq('30 分钟描述', T.describeDuration(30 * 60), '30 分钟');
}

console.log('\n[11] 锚点跳过周末');
{
  const sat = ts('2026-08-22T04:00:00Z');
  const a = T.nextAnchor(sat, 'open');
  eq('周六之后的下一个开盘是周一（美东）', a.etKey, '2026-08-24');
  eq('周一开盘对应北京 21:30（夏令时）', T.hhmm(a.at), '21:30');
}

console.log('\n[12] 提前收盘日与节假日');
{
  eq('2026-11-27 收盘时间为 13:00', T.closeHour('2026-11-27'), 13);
  eq('2026-11-26 感恩节休市', T.tradingDayInfo('2026-11-26').isTrading, false);
  eq('提前收盘日 14:00 美东 -> 盘后', T.sessionAt(ts('2026-11-27T19:00:00Z')).key, 'after');
  /* 节假日不影响「工作日」判定：窗口只由北京星期决定 */
  eq('感恩节当天如果是周四，仍然算工作日', T.isWorkDay('2026-11-26'), true);
}

console.log('\n[13] 格式化与日期键');
{
  eq('倒计时含天', T.countdown(90061), '1天 01:01:01');
  eq('倒计时纯时分秒', T.countdown(3661), '01:01:01');
  eq('短倒计时小时', T.countdownShort(7800), '2 小时 10 分');
  eq('下一交易日跳过周末', T.nextTradingDay('2026-08-22', true), '2026-08-24');
  eq('上一交易日跳过周末', T.prevTradingDay('2026-08-23', true), '2026-08-21');
  eq('平移 +1 天跨月', T.shiftKey('2026-08-31', 1), '2026-09-01');
  eq('平移跨年', T.shiftKey('2026-12-31', 1), '2027-01-01');
  eq('闰年 2 月', T.shiftKey('2028-02-28', 1), '2028-02-29');
}

console.log('\n[14] 时段轴');
{
  const tl = T.timelineFor(ts('2026-08-17T14:00:00Z'));
  eq('时段轴 3 段', tl.length, 3);
  eq('盘中为 current', tl[1].state, 'current');
  eq('盘前为 past', tl[0].state, 'past');
  eq('盘后为 future', tl[2].state, 'future');
}

console.log(`\n===== 时间引擎：通过 ${pass} 项，失败 ${fail} 项 =====`);
process.exit(fail === 0 ? 0 : 1);
