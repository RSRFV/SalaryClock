import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  baseHourly,
  overtimeHourly,
  rateFor,
  daySummary,
  monthSummary,
  fmtClock,
  fmtDur,
  fmtMoney,
  distanceMeters,
  fmtDistance,
  countWeekdays,
  isHoliday,
  isRestDay,
  daysInMonth,
  leaveOf,
  leaveCredit,
  shiftLabel,
  shiftOf,
  paidWorkMs,
  lunchWindow,
  lunchOverlapMs,
  segmentPay,
  scheduleOf,
  scheduledWorkdays,
  parseDateKey,
  dateKey,
  isWeekend,
  complianceHint,
  perSecond,
} from '../calc.js';

const S = { ...DEFAULT_SETTINGS };
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('标准时薪：16000 / 21.75 / 8', () => {
  near(baseHourly(S), 16000 / 174);
  assert.equal(Number(baseHourly(S).toFixed(2)), 91.95);
});

test('月计薪天数/工时为 0 时不产生 Infinity', () => {
  assert.equal(baseHourly({ ...S, workDaysPerMonth: 0 }), 0);
  assert.equal(baseHourly({ ...S, hoursPerDay: 0 }), 0);
  assert.equal(baseHourly({ ...S, monthlySalary: -100 }), 0);
});

test('固定加班时薪：平日/周末同为 100', () => {
  assert.equal(overtimeHourly(S, '2026-10-30'), 100); // 周五
  assert.equal(overtimeHourly(S, '2026-10-31'), 100); // 周六
  assert.equal(rateFor(S, 'normal', '2026-10-31'), baseHourly(S));
});

test('倍率口径：平日 1.5 倍、周末 2 倍', () => {
  const m = { ...S, otMode: 'multiplier' };
  near(overtimeHourly(m, '2026-10-30'), baseHourly(S) * 1.5);
  near(overtimeHourly(m, '2026-10-31'), baseHourly(S) * 2);
});

test('单日汇总：1h 正常 + 0.5h 加班', () => {
  const date = '2026-10-31';
  const base = parseDateKey(date).getTime();
  const day = {
    date,
    segments: [
      { t: 'normal', s: base, e: base + 3600e3 },
      { t: 'overtime', s: base + 3600e3, e: base + 5400e3 },
    ],
  };
  const d = daySummary(day, S);
  near(d.normalMs, 3600e3);
  near(d.otMs, 1800e3);
  near(d.totalMs, 5400e3);
  near(d.pay, baseHourly(S) + 50);
  assert.equal(d.active, null);
});

test('进行中的时段按 now 实时计算', () => {
  const date = '2026-10-31';
  const base = parseDateKey(date).getTime();
  const day = { date, segments: [{ t: 'normal', s: base, e: null }] };
  const d = daySummary(day, S, base + 2 * 3600e3);
  near(d.pay, baseHourly(S) * 2);
  assert.ok(d.active);
});

test('月汇总只统计目标月份，并跳过跨月数据', () => {
  const mk = '2026-10';
  const days = {
    '2026-09-30': { date: '2026-09-30', segments: [{ t: 'normal', s: 0, e: 3600e3 }] },
    '2026-10-08': {
      date: '2026-10-08',
      segments: [{ t: 'normal', s: 0, e: 8 * 3600e3 }],
    },
    '2026-10-09': {
      date: '2026-10-09',
      segments: [
        { t: 'normal', s: 0, e: 8 * 3600e3 },
        { t: 'overtime', s: 8 * 3600e3, e: 9 * 3600e3 },
      ],
    },
  };
  const m = monthSummary(days, S, mk);
  assert.equal(m.dayCount, 2);
  near(m.pay, baseHourly(S) * 16 + 100);
  near(m.otMs, 3600e3);
});

test('格式化：时长/金额/时钟', () => {
  assert.equal(fmtClock(0), '00:00:00');
  assert.equal(fmtClock(8 * 3600e3 + 32 * 60e3 + 5000), '08:32:05');
  assert.equal(fmtClock(30 * 3600e3), '30:00:00');
  assert.equal(fmtDur(8 * 3600e3 + 32 * 60e3), '8h 32m');
  assert.equal(fmtDur(45 * 60e3), '45m');
  assert.equal(fmtMoney(1234.5), '1,234.50');
  assert.equal(fmtMoney(0), '0.00');
});

test('距离：纬度 0.01 度约 1112 米', () => {
  const a = { lat: 39.9042, lng: 116.4074 };
  const b = { lat: 39.9142, lng: 116.4074 };
  const d = distanceMeters(a, b);
  assert.ok(d > 1100 && d < 1125, String(d));
  assert.equal(fmtDistance(d), '1.11km');
  assert.equal(fmtDistance(320), '320m');
  assert.equal(distanceMeters(null, b), Infinity);
});

test('周末判定与日期工具', () => {
  assert.equal(isWeekend('2026-10-31'), true); // 周六
  assert.equal(isWeekend('2026-10-30'), false); // 周五
  assert.equal(dateKey(parseDateKey('2026-01-05')), '2026-01-05');
});

test('本月工作日：2026-10 有 22 个工作日', () => {
  assert.equal(countWeekdays(2026, 9), 22);
  assert.equal(countWeekdays(2026, 1), 20); // 2026-02：28 天，2/1 周日
  assert.equal(countWeekdays(2027, 1), 20); // 2027-02：28 天
});

test('节假日：固定时薪与倍率分别生效', () => {
  const fixed = { ...S, holidays: ['2026-10-01'] };
  assert.equal(overtimeHourly(fixed, '2026-10-01'), 300);
  assert.equal(overtimeHourly(fixed, '2026-10-02'), 100);

  const mult = { ...S, otMode: 'multiplier', holidays: ['2026-10-01'] };
  near(overtimeHourly(mult, '2026-10-01'), baseHourly(S) * 3);
  near(overtimeHourly(mult, '2026-10-02'), baseHourly(S) * 1.5);
  assert.equal(isHoliday(fixed, '2026-10-01'), true);
  assert.equal(isHoliday(fixed, '2026-10-02'), false);
});

test('排班：默认上班日，标记休息日才扣减', () => {
  const schedule = {
    '2026-10-01': { rest: true },
    '2026-10-02': { rest: true },
    '2026-10-03': { start: '09:00', end: '18:00' }, // 旧格式：视为上班
    '2026-11-01': { rest: true },
  };
  assert.equal(daysInMonth('2026-10'), 31);
  assert.equal(scheduledWorkdays(schedule, '2026-10'), 29);
  assert.equal(scheduledWorkdays(schedule, '2026-11'), 29);
  assert.equal(isRestDay({ schedule }, '2026-10-01'), true);
  assert.equal(isRestDay({ schedule }, '2026-10-03'), false);
  assert.equal(isRestDay({ schedule }, '2026-12-01'), false);
});

test('请假：照常计薪，无打卡记录也计入月汇总', () => {
  const date = '2026-11-02';
  const s = { ...S, schedule: { [date]: { leave: '年假' } } };
  const credit = baseHourly(S) * 8;
  near(leaveCredit(s, date), credit);
  assert.equal(leaveOf(s, date), '年假');
  assert.equal(shiftLabel(s, date), '年假');
  assert.equal(shiftOf(s, date), null);
  near(daySummary({ date, segments: [] }, s).pay, credit);
  near(monthSummary({}, s, '2026-11').pay, credit);
  assert.equal(monthSummary({}, s, '2026-11').dayCount, 1);
});

test('午休：不计薪时扣除重叠，计薪时照常', () => {
  const s = { ...S, lunchStart: '12:00', lunchEnd: '13:00', lunchPaid: false };
  const date = '2026-11-02';
  const base = parseDateKey(date).getTime();
  const day = { date, segments: [{ t: 'normal', s: base + 9 * 3600e3, e: base + 18 * 3600e3 }] };
  const d = daySummary(day, s);
  near(d.pay, baseHourly(s) * 8);
  near(d.unpaidLunchMs, 3600e3);
  near(paidWorkMs(day, s, base + 18 * 3600e3), 8 * 3600e3);
  near(segmentPay(day.segments[0], s, date, base + 18 * 3600e3), baseHourly(s) * 8);

  const paid = { ...s, lunchPaid: true };
  near(daySummary(day, paid).pay, baseHourly(s) * 9);
  assert.equal(daySummary(day, paid).unpaidLunchMs, 0);
});

test('合规提示：100/h 低于 1.5 倍参考线会提示', () => {
  assert.match(complianceHint(S), /低于常见法定口径/);
  const ok = { ...S, otFixedRate: 200 };
  assert.doesNotMatch(complianceHint(ok), /低于/);
  assert.equal(perSecond(100), '0.0278');
});
