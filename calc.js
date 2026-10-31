/**
 * SalaryClock 薪资计算内核
 * 纯函数、无 DOM 依赖，可单测、可复用到小程序 / RN / 后端。
 */

export const DEFAULT_SETTINGS = {
  // 收入口径
  monthlySalary: 16000,      // 月薪（元）
  workDaysPerMonth: 21.75,   // 月计薪天数（法定口径 21.75）
  hoursPerDay: 8,            // 每日标准工时

  // 加班口径
  otMode: 'fixed',           // 'fixed' 固定时薪 | 'multiplier' 按倍率
  otFixedRate: 100,          // 固定加班时薪（元/小时）
  otMultiplier: 1.5,         // 平日加班倍率
  otWeekendMultiplier: 2,    // 周末加班倍率
  otHolidayRate: 300,        // 固定模式下法定节假日加班时薪
  otHolidayMultiplier: 3,    // 倍率模式下法定节假日倍率
  holidays: [],              // 法定节假日日期 ['2026-10-01', ...]，手动/日历同步
  holidaySource: '',         // 最近一次自动同步来源：calendar | server | cache | failed
  holidaySyncedAt: 0,        // 最近一次自动同步时间

  // 排班
  shiftMode: false,          // 是否排班制
  shiftStart: '09:00',       // 排班默认证上班时间
  shiftEnd: '18:00',         // 排班默认下班时间
  schedule: {},              // { 'YYYY-MM-DD': { rest:true } }，未标记即上班日

  // 打卡方式
  checkInMode: 'manual',     // 'manual' 手动 | 'auto' 自动
  autoGeofence: true,        // 自动模式：进入公司范围自动打卡
  autoWifi: false,           // 自动模式：连接指定 WiFi 自动打卡
  wifiSsid: '',              // 指定 WiFi 名称（需 Android 壳支持读取）

  // 位置
  geofenceMode: 'loose',     // 'off' 关闭 | 'loose' 提醒 | 'strict' 拦截
  company: null,             // { lat, lng, radius, label }

  // 界面
  animateAmount: true,       // 首页金额是否逐秒跳动
  theme: 'light',            // 'light' 白色简洁 | 'dark' 夜间 | 'pink' 粉色可爱
};

export const pad2 = (n) => String(n).padStart(2, '0');

/** 本地时区 YYYY-MM-DD */
export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function monthKeyOf(k) {
  return k.slice(0, 7);
}

export function parseDateKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function weekdayCN(k) {
  return '周' + '日一二三四五六'[parseDateKey(k).getDay()];
}

export function isWeekend(k) {
  const w = parseDateKey(k).getDay();
  return w === 0 || w === 6;
}

export function hhmm(ts) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const num = (v, fallback = 0) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

/** 标准时薪 = 月薪 ÷ 月计薪天数 ÷ 每日工时 */
export function baseHourly(settings) {
  const days = num(settings.workDaysPerMonth, 21.75);
  const hours = num(settings.hoursPerDay, 8);
  const denom = days * hours;
  if (denom <= 0) return 0;
  return Math.max(0, num(settings.monthlySalary)) / denom;
}

/** 是否法定节假日（由用户在设置里维护日期列表） */
export function isHoliday(settings, dateStr) {
  if (!settings || !Array.isArray(settings.holidays)) return false;
  return settings.holidays.includes(dateStr);
}

/** 加班时薪（按记录所属日期判断：节假日 > 周末 > 平日） */
export function overtimeHourly(settings, dateStr = dateKey()) {
  if (settings.otMode === 'multiplier') {
    const base = baseHourly(settings);
    if (isHoliday(settings, dateStr)) return base * num(settings.otHolidayMultiplier, 3);
    const mult = isWeekend(dateStr)
      ? num(settings.otWeekendMultiplier, 2)
      : num(settings.otMultiplier, 1.5);
    return base * mult;
  }
  if (isHoliday(settings, dateStr)) return Math.max(0, num(settings.otHolidayRate));
  return Math.max(0, num(settings.otFixedRate));
}

/** 某天排班（无记录视为上班日） */
export function scheduleOf(settings, dateStr) {
  const schedule = settings && settings.schedule;
  const entry = schedule && schedule[dateStr];
  return entry || null;
}

/** 是否被标记为休息日 */
export function isRestDay(settings, dateStr) {
  const entry = scheduleOf(settings, dateStr);
  return !!(entry && entry.rest === true);
}

export function daysInMonth(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** 某月排班上班日数量：整月天数 − 标记为休息日的天数 */
export function scheduledWorkdays(schedule, monthKey) {
  const total = daysInMonth(monthKey);
  if (!schedule || typeof schedule !== 'object') return total;
  let rest = 0;
  for (const key of Object.keys(schedule)) {
    if (!key.startsWith(monthKey)) continue;
    const entry = schedule[key];
    if (entry && entry.rest === true) rest += 1;
  }
  return Math.max(0, total - rest);
}

/** 某类工时的单价 */
export function rateFor(settings, type, dateStr) {
  return type === 'overtime' ? overtimeHourly(settings, dateStr) : baseHourly(settings);
}

/** 计时段毫秒数（进行中的段按 now 计算） */
export function segmentMs(seg, now = Date.now()) {
  const end = seg.e == null ? now : seg.e;
  return Math.max(0, end - seg.s);
}

/** 单段薪资 */
export function segmentPay(seg, settings, dateStr, now = Date.now()) {
  const hours = segmentMs(seg, now) / 3600000;
  return hours * rateFor(settings, seg.t, dateStr);
}

export const EMPTY_DAY = {
  normalMs: 0,
  otMs: 0,
  totalMs: 0,
  pay: 0,
  active: null,
};

/** 一天的汇总 */
export function daySummary(day, settings, now = Date.now()) {
  if (!day || !Array.isArray(day.segments)) return { ...EMPTY_DAY };
  let normalMs = 0;
  let otMs = 0;
  let pay = 0;
  let active = null;
  for (const seg of day.segments) {
    const ms = segmentMs(seg, now);
    pay += (ms / 3600000) * rateFor(settings, seg.t, day.date);
    if (seg.t === 'overtime') otMs += ms;
    else normalMs += ms;
    if (seg.e == null) active = seg;
  }
  return { normalMs, otMs, totalMs: normalMs + otMs, pay, active };
}

/** 一个月（YYYY-MM）的汇总，now 用于计算进行中的时段 */
export function monthSummary(days, settings, monthKey, now = Date.now()) {
  let pay = 0;
  let normalMs = 0;
  let otMs = 0;
  let dayCount = 0;
  for (const key of Object.keys(days || {})) {
    if (!key.startsWith(monthKey)) continue;
    const d = daySummary(days[key], settings, now);
    if (d.totalMs > 0) dayCount += 1;
    pay += d.pay;
    normalMs += d.normalMs;
    otMs += d.otMs;
  }
  return { pay, normalMs, otMs, totalMs: normalMs + otMs, dayCount };
}

/** 计时器展示：HH:MM:SS，小时不封顶 */
export function fmtClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

/** 时长展示：8h 32m / 32m */
export function fmtDur(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${pad2(m)}m`;
}

/** 金额展示：1,234.56 */
export function fmtMoney(n) {
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** 每秒收益文案（元） */
export function perSecond(rate) {
  return (rate / 3600).toFixed(4);
}

/** 某年某月（monthIndex 0-based）的工作日天数，仅排除周六周日 */
export function countWeekdays(year, monthIndex) {
  let n = 0;
  const d = new Date(year, monthIndex, 1);
  while (d.getMonth() === monthIndex) {
    const w = d.getDay();
    if (w >= 1 && w <= 5) n += 1;
    d.setDate(d.getDate() + 1);
  }
  return n;
}

/** 两坐标距离（米），Haversine */
export function distanceMeters(a, b) {
  if (!a || !b || typeof a.lat !== 'number' || typeof b.lat !== 'number') return Infinity;
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function fmtDistance(m) {
  if (!Number.isFinite(m)) return '未知';
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(2)}km`;
}

/** 加班费率合规提示（仅产品提示，不构成法律意见） */
export function complianceHint(settings) {
  const base = baseHourly(settings);
  if (!(base > 0)) return '';
  const legal1 = base * 1.5;
  const legal3 = base * 3;
  const holidayRate =
    settings.otMode === 'multiplier'
      ? base * num(settings.otHolidayMultiplier, 3)
      : Math.max(0, num(settings.otHolidayRate));
  if (settings.otMode === 'fixed') {
    const rate = Math.max(0, num(settings.otFixedRate));
    const head =
      rate + 0.02 < legal1
        ? `固定加班时薪 ¥${rate.toFixed(2)}/h 低于常见法定口径：工作日加班不低于 1.5 倍（¥${legal1.toFixed(2)}/h），休息日不低于 2 倍（¥${(base * 2).toFixed(2)}/h）。`
        : `固定加班时薪 ¥${rate.toFixed(2)}/h，高于 1.5 倍参考线（¥${legal1.toFixed(2)}/h）。`;
    return `${head}节假日加班时薪 ¥${holidayRate.toFixed(2)}/h（3 倍参考 ¥${legal3.toFixed(2)}/h）。演示数据仅作参考。`;
  }
  return `倍率口径：平日 ×${num(settings.otMultiplier, 1.5)} ≈ ¥${(base * num(settings.otMultiplier, 1.5)).toFixed(2)}/h，周末 ×${num(settings.otWeekendMultiplier, 2)} ≈ ¥${(base * num(settings.otWeekendMultiplier, 2)).toFixed(2)}/h，节假日 ×${num(settings.otHolidayMultiplier, 3)} ≈ ¥${holidayRate.toFixed(2)}/h。`;
}
