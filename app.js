/**
 * 时薪时钟 SalaryClock — 应用层
 * 纯原生 ES Module，零构建依赖。
 */
import {
  DEFAULT_SETTINGS,
  baseHourly,
  overtimeHourly,
  rateFor,
  daySummary,
  monthSummary,
  segmentMs,
  segmentPay,
  dateKey,
  monthKeyOf,
  parseDateKey,
  weekdayCN,
  isWeekend,
  fmtClock,
  fmtDur,
  fmtMoney,
  perSecond,
  hhmm,
  pad2,
  countWeekdays,
  isHoliday,
  isRestDay,
  daysInMonth,
  scheduleOf,
  scheduledWorkdays,
  distanceMeters,
  fmtDistance,
  complianceHint,
} from './calc.js';

const STORE_KEY = 'salary-clock-v1';
const THEMES = ['light', 'dark', 'pink'];
const THEME_META = { light: '#f5f6f8', dark: '#070a0f', pink: '#fff4f8' };
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ------------------------------------------------------------------ */
/* 状态                                                               */
/* ------------------------------------------------------------------ */

let state = loadState();
let tab = 'home';
let recordsMonth = monthKeyOf(dateKey(new Date()));
let lastDate = dateKey(new Date());
let toastTimer = null;

/* 账户 / 同步（本地 token，独立于业务数据） */
const AUTH_KEY = 'salary-clock-auth-v1';
let auth = loadAuth();
let pushTimer = null;

function defaultApiBase() {
  if (location.port === '8788') return '';
  if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') return 'http://127.0.0.1:8788';
  return '';
}

function loadAuth() {
  try {
    const saved = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    if (saved && saved.token) {
      return {
        token: saved.token,
        username: saved.username || '',
        apiBase: saved.apiBase != null ? saved.apiBase : defaultApiBase(),
        autoSync: saved.autoSync !== false,
        lastSync: saved.lastSync || 0,
      };
    }
  } catch (err) {
    /* ignore */
  }
  return { token: '', username: '', apiBase: defaultApiBase(), autoSync: true, lastSync: 0 };
}

function saveAuth() {
  try {
    localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  } catch (err) {
    /* ignore */
  }
}

function apiUrl(path) {
  return (auth.apiBase || '').replace(/\/$/, '') + path;
}

async function apiFetch(path, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
  if (auth.token) headers.authorization = `Bearer ${auth.token}`;
  const res = await fetch(apiUrl(path), { ...opts, headers });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (err) {
    body = null;
  }
  if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`);
  return body;
}

function schedulePush() {
  if (!auth.token || !auth.autoSync) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    syncPush().catch(() => {});
  }, 2500);
}

function mergeData(local, remote) {
  const r = remote || {};
  return {
    settings: { ...(r.settings || {}), ...(local.settings || {}) },
    days: { ...(r.days || {}), ...(local.days || {}) },
    months: { ...(r.months || {}), ...(local.months || {}) },
  };
}

async function syncPush() {
  const res = await apiFetch('/api/sync', {
    method: 'PUT',
    body: JSON.stringify({
      data: { settings: state.settings, days: state.days, months: state.months },
      updatedAt: Date.now(),
    }),
  });
  auth.lastSync = (res && res.updatedAt) || Date.now();
  saveAuth();
  return auth.lastSync;
}

async function syncPull() {
  return apiFetch('/api/sync');
}

async function syncNow(showToast) {
  if (!auth.token) return;
  try {
    const cloud = await syncPull();
    if (cloud && cloud.data) {
      state = mergeData(state, cloud.data);
      save();
    }
    await syncPush();
    render();
    if (showToast) toast('已同步到云端');
  } catch (err) {
    toast(`同步失败：${err.message}`);
  }
}

function loadState() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  } catch (err) {
    raw = null;
  }
  const settings = { ...DEFAULT_SETTINGS, ...(raw && raw.settings ? raw.settings : {}) };
  if (!THEMES.includes(settings.theme)) settings.theme = DEFAULT_SETTINGS.theme;
  if (settings.company && typeof settings.company.lat !== 'number') settings.company = null;
  const days = raw && raw.days && typeof raw.days === 'object' ? raw.days : {};
  const months = raw && raw.months && typeof raw.months === 'object' ? raw.months : {};
  return { settings, days, months };
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('保存失败', err);
  }
  if (auth && auth.token && auth.autoSync) schedulePush();
}

/** 应用主题：html[data-theme] + 浏览器状态栏颜色 */
function applyTheme(theme) {
  const next = THEMES.includes(theme) ? theme : DEFAULT_SETTINGS.theme;
  document.documentElement.setAttribute('data-theme', next);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_META[next]);
  const apple = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (apple) apple.setAttribute('content', next === 'dark' ? 'black-translucent' : 'default');
}

function ensureDay(k) {
  if (!state.days[k]) state.days[k] = { date: k, segments: [] };
  return state.days[k];
}

/** 找到进行中的计时段（全局最多一段） */
function findActive() {
  const keys = Object.keys(state.days).sort();
  for (let i = keys.length - 1; i >= 0; i -= 1) {
    const day = state.days[keys[i]];
    const segs = day.segments || [];
    for (let j = segs.length - 1; j >= 0; j -= 1) {
      if (segs[j].e == null) return { day, seg: segs[j] };
    }
  }
  return null;
}

/** 跨天兜底：进行中的时段不属于今天 → 结算到当天 23:59:59 */
function normalize() {
  const tk = dateKey(new Date());
  const active = findActive();
  if (!active || active.day.date === tk) return;
  const end = parseDateKey(active.day.date).getTime() + 86400000 - 1000;
  active.seg.e = Math.max(active.seg.s + 1000, end);
  save();
  toast(`${active.day.date} 忘记下班打卡，已按 23:59 自动结算`);
}

/* ------------------------------------------------------------------ */
/* 渲染                                                               */
/* ------------------------------------------------------------------ */

function render(opts = {}) {
  const y = window.scrollY;
  const view = $('#view');
  if (tab === 'home') view.innerHTML = homeHTML();
  else if (tab === 'records') view.innerHTML = recordsHTML();
  else view.innerHTML = settingsHTML();

  $$('.tab').forEach((el) => el.classList.toggle('active', el.dataset.tab === tab));
  updateClockText();
  if (opts.top) window.scrollTo(0, 0);
  else window.scrollTo(0, y);
  refreshLive();
}

function segRow(seg, dayDate) {
  const live = seg.e == null;
  const name = seg.t === 'overtime' ? '加班' : '正常';
  const pay = segmentPay(seg, state.settings, dayDate);
  return `<div class="tl-item">
      <span class="tl-dot ${seg.t}${live ? ' live' : ''}"></span>
      <div class="tl-main">
        <div class="tl-name">${name}${live ? '<small>进行中</small>' : ''}</div>
        <div class="tl-time">${hhmm(seg.s)} – ${live ? '现在' : hhmm(seg.e)}</div>
      </div>
      <div class="tl-right">
        <div class="tl-dur">${fmtClock(segmentMs(seg))}</div>
        <div class="tl-pay">¥${fmtMoney(pay)}</div>
      </div>
    </div>`;
}

function homeHTML() {
  const s = state.settings;
  const tk = dateKey(new Date());
  const day = state.days[tk];
  const active = findActive();
  const mode = active ? active.seg.t : 'idle';
  const rate = mode === 'idle' ? baseHourly(s) : rateFor(s, mode, active.day.date);
  const ds = daySummary(day, s);
  const m = monthSummary(state.days, s, monthKeyOf(tk));
  const pct = s.monthlySalary > 0 ? Math.min(100, (m.pay / s.monthlySalary) * 100) : 0;
  const segs = day ? [...day.segments].sort((a, b) => a.s - b.s) : [];
  const tSch = s.shiftMode ? scheduleOf(s, tk) : null;
  const restToday = s.shiftMode ? isRestDay(s, tk) : false;

  const heroClass = mode === 'overtime' ? 'is-ot' : mode === 'normal' ? 'is-normal' : 'is-idle';
  const pillClass = mode === 'overtime' ? 'is-ot' : mode === 'normal' ? 'is-normal' : 'is-idle';
  const pillLabel = mode === 'overtime' ? '加班计时中' : mode === 'normal' ? '正常工作' : '未打卡';

  const actions =
    mode === 'idle'
      ? `<button class="btn primary block" data-act="clockin">打卡上班</button>
         <div class="hint-line">${locationHintText()}</div>`
      : mode === 'normal'
        ? `<button class="btn ot block" data-act="ot-start">开始加班</button>
           <button class="btn primary block" data-act="clockout">下班打卡</button>`
        : `<button class="btn primary block" data-act="clockout">下班打卡</button>
           <button class="btn ghost block" data-act="ot-stop">结束加班，恢复普通计时</button>`;

  return `
  <section class="hero ${heroClass}" id="hero">
    <div class="hero-top">
      <span class="pill ${pillClass}" id="hero-pill"><span class="dot"></span><span id="hero-pill-label">${pillLabel}</span></span>
      <span class="rate-chip">时薪 <b id="live-rate">¥${fmtMoney(rate)}</b>/h</span>
    </div>

    <div class="hero-label">今日已赚</div>
    <div class="hero-amount">
      <span class="cur">¥</span>
      <span class="amt"><span id="live-int">${fmtMoney(ds.pay).split('.')[0]}</span><span class="cents" id="live-cents">.${fmtMoney(ds.pay).split('.')[1]}</span></span>
    </div>

    <div class="hero-meta">
      <span>已工作 <b id="live-clock">${fmtClock(ds.totalMs)}</b></span>
      <span class="sep"></span>
      <span>本月 <b id="live-month">¥${fmtMoney(m.pay)}</b></span>
    </div>
    <div class="per-sec" id="live-per-sec">≈ 每秒 ¥${perSecond(rate)}</div>

    <div class="bar-wrap">
      <div class="bar"><i id="live-bar" style="width:${pct.toFixed(2)}%"></i></div>
      <div class="bar-cap">
        <span>月薪进度 <b id="live-pct">${pct.toFixed(1)}%</b></span>
        <span>目标 ¥${fmtMoney(s.monthlySalary)}</span>
      </div>
    </div>
  </section>

  <div class="actions">${actions}</div>

  ${
    s.shiftMode
      ? `<section class="card tight">
           <div class="loc">
             <div class="loc-ico">🗓</div>
             <div class="loc-main">
               <b>今日${restToday ? '休息' : '上班'}</b>
               <small>${restToday ? '排班日历里标记为休息日' : `上班时间 ${s.shiftStart} – ${s.shiftEnd}`}</small>
             </div>
           </div>
         </section>`
      : ''
  }

  <div class="stats">
    <div class="stat"><span>今日工时</span><b>${fmtDur(ds.totalMs)}</b></div>
    <div class="stat"><span>今日加班</span><b>${fmtDur(ds.otMs)}</b></div>
    <div class="stat"><span>本月出勤</span><b>${m.dayCount}<small>天</small></b></div>
  </div>

  <section class="card">
    <div class="card-head">
      <div class="card-title">今日明细</div>
      <button class="btn ghost sm" data-act="backfill">补录</button>
    </div>
    ${segs.length ? `<div class="tl">${segs.map((seg) => segRow(seg, tk)).join('')}</div>` : '<div class="tl-empty">还没有记录 · 打卡后这里会出现每段工时与金额</div>'}
  </section>
  `;
}

function locationHintText() {
  const s = state.settings;
  if (s.geofenceMode === 'off') return '位置校验已关闭 · 点击即可开始计时';
  if (!s.company) return '首次打卡可记录公司位置，之后到公司才能打卡';
  const radius = Number(s.company.radius) || 200;
  return `到公司 ${radius}m 范围内才能打卡 · 可在设置中调整`;
}

function recordsHTML() {
  const s = state.settings;
  const mk = recordsMonth;
  const m = monthSummary(state.days, s, mk);
  const days = Object.values(state.days)
    .filter((d) => d.date.startsWith(mk) && d.segments && d.segments.length)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const actual = state.months[mk]?.actualPay;
  const totalHours = m.totalMs / 3600000;
  const diff = actual != null ? actual - m.pay : 0;
  const realHourly = actual != null && totalHours > 0 ? actual / totalHours : null;

  return `
  <div class="month-nav">
    <button class="icon-btn" data-act="prev-month" aria-label="上个月">‹</button>
    <div class="label">${monthLabel(mk)}<small>${m.dayCount} 天</small></div>
    <button class="icon-btn" data-act="next-month" aria-label="下个月">›</button>
  </div>

  <section class="card">
    <div class="month-total">
      <div>
        <div class="card-title">本月已赚</div>
        <div class="big">¥${fmtMoney(m.pay)}</div>
      </div>
      <div class="side">正常 <b>${fmtDur(m.normalMs)}</b><br>加班 <b>${fmtDur(m.otMs)}</b></div>
    </div>
  </section>

  <section class="card calc adjust">
    <div class="card-head"><div class="card-title">实发校准</div><span class="tag">仅对比</span></div>
    ${
      actual == null
        ? `<p class="adjust-hint">记下这个月实际到账的工资，和 App 估算对比；还能反推你真正到手的时薪。</p>
           <button class="btn ghost block" data-act="calib" data-month="${mk}">记下本月实发工资</button>`
        : `<div class="row"><span>实发到账</span><b>¥${fmtMoney(actual)}</b></div>
           <div class="row"><span>App 估算</span><b>¥${fmtMoney(m.pay)}</b></div>
           <div class="row"><span>差额</span><b class="diff ${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '+' : '−'}¥${fmtMoney(Math.abs(diff))}</b></div>
           <div class="row"><span>反推税后时薪</span><b>${realHourly != null ? `¥${fmtMoney(realHourly)}/h` : '—'}</b></div>
           <div class="row"><span>本月总工时</span><b>${fmtDur(m.totalMs)}</b></div>
           <div class="hint">差额主要来自个税、社保、补贴、扣款或漏打卡；建议下月发薪后回来校准上月。</div>
           <div class="loc-actions">
             <button class="btn ghost sm" data-act="calib" data-month="${mk}">修改</button>
             <button class="btn ghost sm" data-act="calib-clear" data-month="${mk}">清除</button>
           </div>`
    }
  </section>

  <button class="btn ghost block" data-act="backfill">＋ 补录漏打卡</button>

  ${
    days.length
      ? `<div style="display:flex;flex-direction:column;gap:10px">${days.map((d) => dayCardHTML(d)).join('')}</div>`
      : `<div class="empty"><span class="em">🗓</span>这个月还没有打卡记录</div>`
  }
  `;
}

function dayCardHTML(day) {
  const s = state.settings;
  const d = daySummary(day, s);
  const segs = [...day.segments].sort((a, b) => a.s - b.s);
  const sch = s.shiftMode ? scheduleOf(s, day.date) : null;
  const rest = s.shiftMode ? isRestDay(s, day.date) : false;
  const schedTxt = s.shiftMode ? (rest ? '休息日' : `上班 ${s.shiftStart}–${s.shiftEnd}`) : '';
  return `<details class="card day-card">
    <summary>
      <div class="day-date"><b>${day.date.slice(5)}</b><span>${weekdayCN(day.date)}</span></div>
      <div class="day-mid">${fmtDur(d.normalMs)}${d.otMs ? ` · <span class="ot">加班 ${fmtDur(d.otMs)}</span>` : ''}${schedTxt ? ` · <span class="sched">${schedTxt}</span>` : ''}</div>
      <div class="day-pay">¥${fmtMoney(d.pay)}</div>
    </summary>
    <div class="day-body">
      <div class="tl">${segs.map((seg) => segRow(seg, day.date)).join('')}</div>
      <div class="day-tools">
        <button class="btn danger sm" data-act="rm-day" data-day="${day.date}">删除这天</button>
      </div>
    </div>
  </details>`;
}

function settingsHTML() {
  const s = state.settings;
  const c = s.company;
  const bh = baseHourly(s);
  const ot = overtimeHourly(s);
  const hint = complianceHint(s);
  const now = new Date();
  const monthWorkdays = countWeekdays(now.getFullYear(), now.getMonth());
  const schedCount = s.shiftMode
    ? scheduledWorkdays(s.schedule, monthKeyOf(dateKey(now)))
    : 0;
  const restToday = s.shiftMode ? isRestDay(s, dateKey(now)) : false;
  const isCustomDays =
    Math.abs(s.workDaysPerMonth - 21.75) > 0.001 &&
    Math.abs(s.workDaysPerMonth - monthWorkdays) > 0.001;
  const legal1 = bh * 1.5;

  return `
  <section class="card calc">
    <div class="card-head"><div class="card-title">你的时薪</div><span class="tag">实时换算</span></div>
    <div class="row"><span>标准时薪</span><b class="accent" id="derived-hourly">¥${fmtMoney(bh)}</b></div>
    <div class="row"><span>加班时薪</span><b id="derived-ot">¥${fmtMoney(ot)}</b></div>
    <div class="hint" id="derived-breakdown">${fmtMoney(s.monthlySalary)} ÷ ${s.workDaysPerMonth} 天 ÷ ${s.hoursPerDay} 小时 = ¥${fmtMoney(bh)}/h</div>
    ${hint ? `<div class="warn" id="compliance">${hint}</div>` : '<div class="warn" id="compliance" hidden></div>'}
  </section>

  <section class="card">
    <div class="card-head"><div class="card-title">外观</div><span class="tag">立即生效</span></div>
    <div class="theme-row">
      <button class="theme-opt ${s.theme === 'light' ? 'active' : ''}" data-act="set-theme" data-value="light">
        <span class="swatch swatch-light"></span>
        <span class="theme-name">白色简洁</span>
      </button>
      <button class="theme-opt ${s.theme === 'dark' ? 'active' : ''}" data-act="set-theme" data-value="dark">
        <span class="swatch swatch-dark"></span>
        <span class="theme-name">夜间</span>
      </button>
      <button class="theme-opt ${s.theme === 'pink' ? 'active' : ''}" data-act="set-theme" data-value="pink">
        <span class="swatch swatch-pink"></span>
        <span class="theme-name">粉色可爱</span>
      </button>
    </div>
    <div class="hint" style="margin-top:8px">只切换配色，打卡与金额数据不受影响。</div>
  </section>

  <section class="card">
    <div class="card-head"><div class="card-title">账户与同步</div><span class="tag">${auth.token ? '已登录' : '可选'}</span></div>
    ${
      auth.token
        ? `<div class="loc">
             <div class="loc-ico">👤</div>
             <div class="loc-main">
               <b>${escapeHTML(auth.username)}</b>
               <small>${auth.lastSync ? `上次同步 ${new Date(auth.lastSync).toLocaleString('zh-CN', { hour12: false })}` : '尚未同步'}</small>
             </div>
           </div>
           <div class="loc-actions">
             <button class="btn ghost sm" data-act="sync-now">立即同步</button>
             <button class="btn ghost sm" data-act="logout">退出登录</button>
           </div>
           <div class="field">
             <label><span class="lab">自动同步</span></label>
             <div class="seg">
               <button data-act="autosync" data-value="on" class="${auth.autoSync ? 'active' : ''}">开</button>
               <button data-act="autosync" data-value="off" class="${!auth.autoSync ? 'active' : ''}">关</button>
             </div>
           </div>`
        : `<p class="adjust-hint">登录后可把打卡记录同步到自己的服务器，多设备共用；不登录也能纯本地使用。</p>
           <div class="loc-actions">
             <button class="btn primary sm" data-act="login">登录</button>
             <button class="btn ghost sm" data-act="register">注册</button>
           </div>`
    }
    <div class="field">
      <label><span class="lab">服务器地址<em>留空=同源</em></span></label>
      <input class="input wide" data-field="apiBase" value="${escapeHTML(auth.apiBase)}" placeholder="http://127.0.0.1:8788" spellcheck="false" />
      <div class="hint">本地运行 <code>node server/index.mjs</code> 后填 http://127.0.0.1:8788；APK 内填你部署的地址。</div>
    </div>
  </section>

  <section class="card">
    <div class="card-head"><div class="card-title">收入口径</div></div>
    <div class="field">
      <label><span class="lab">月薪</span><span class="input-wrap"><input class="input" type="number" inputmode="decimal" data-field="monthlySalary" value="${s.monthlySalary}" min="0" step="100" /><span class="unit">元</span></span></label>
    </div>
    <div class="field">
      <label><span class="lab">月计薪天数<em>时薪换算口径</em></span></label>
      <div class="chip-row">
        <button class="chip ${Math.abs(s.workDaysPerMonth - 21.75) < 0.001 ? 'active' : ''}" data-act="preset-days" data-value="21.75">法定 21.75 天</button>
        <button class="chip ${Math.abs(s.workDaysPerMonth - monthWorkdays) < 0.001 ? 'active' : ''}" data-act="preset-days" data-value="${monthWorkdays}">本月工作日 ${monthWorkdays} 天</button>
        <button class="chip ${isCustomDays ? 'active' : ''}" data-act="preset-days" data-value="custom">自定义</button>
        ${schedCount > 0 ? `<button class="chip ${Math.abs(s.workDaysPerMonth - schedCount) < 0.001 ? 'active' : ''}" data-act="preset-days" data-value="${schedCount}">按排班 ${schedCount} 天</button>` : ''}
      </div>
      <div class="input-line end">
        <span class="input-wrap"><input class="input" type="number" inputmode="decimal" data-field="workDaysPerMonth" value="${s.workDaysPerMonth}" min="0.5" step="0.25" /><span class="unit">天</span></span>
      </div>
      <div class="hint">法定 21.75 = (365 − 104) ÷ 12；「本月工作日」只排除周末，未扣法定节假日。</div>
    </div>
    <div class="field">
      <label><span class="lab">每日标准工时</span><span class="input-wrap"><input class="input" type="number" inputmode="decimal" data-field="hoursPerDay" value="${s.hoursPerDay}" min="1" step="0.5" /><span class="unit">时</span></span></label>
      <div class="hint">时薪 = 月薪 ÷ 月计薪天数 ÷ 每日工时。改天数即可切换"法定口径 / 真实出勤口径"。</div>
    </div>
  </section>

  <section class="card">
    <div class="card-head"><div class="card-title">加班计费</div></div>
    <div class="field">
      <div class="seg">
        <button data-act="ot-mode" data-value="fixed" class="${s.otMode === 'fixed' ? 'active' : ''}">固定时薪</button>
        <button data-act="ot-mode" data-value="multiplier" class="${s.otMode === 'multiplier' ? 'active' : ''}">按倍率</button>
      </div>
      <div class="hint">${s.otMode === 'fixed' ? '固定时薪：平日晚间与周六日加班同价，按你的合同填写。' : '按倍率：以标准时薪为基数，工作日/周末分别计算。'}</div>
    </div>
    ${
      s.otMode === 'fixed'
        ? `<div class="field">
             <label><span class="lab">加班时薪<em>周末同价</em></span><span class="input-wrap"><input class="input" type="number" inputmode="decimal" data-field="otFixedRate" value="${s.otFixedRate}" min="0" step="10" /><span class="unit">元/h</span></span></label>
             <div class="chip-row">
               <button class="chip" data-act="ot-fill" data-value="${legal1.toFixed(2)}">按 1.5 倍填入 ¥${legal1.toFixed(2)}</button>
             </div>
           </div>
           <div class="field">
             <label><span class="lab">节假日加班时薪</span><span class="input-wrap"><input class="input" type="number" inputmode="decimal" data-field="otHolidayRate" value="${s.otHolidayRate}" min="0" step="10" /><span class="unit">元/h</span></span></label>
             <div class="chip-row">
               <button class="chip" data-act="ot-fill" data-field="otHolidayRate" data-value="${(baseHourly(s) * 3).toFixed(2)}">按 3 倍填入 ¥${(baseHourly(s) * 3).toFixed(2)}</button>
             </div>
           </div>`
        : `<div class="field"><label><span class="lab">平日加班倍率</span><span class="input-wrap"><input class="input" type="number" inputmode="decimal" data-field="otMultiplier" value="${s.otMultiplier}" min="1" step="0.1" /><span class="unit">×</span></span></label></div>
           <div class="field"><label><span class="lab">周末加班倍率</span><span class="input-wrap"><input class="input" type="number" inputmode="decimal" data-field="otWeekendMultiplier" value="${s.otWeekendMultiplier}" min="1" step="0.1" /><span class="unit">×</span></span></label></div>
           <div class="field"><label><span class="lab">节假日加班倍率</span><span class="input-wrap"><input class="input" type="number" inputmode="decimal" data-field="otHolidayMultiplier" value="${s.otHolidayMultiplier}" min="1" step="0.5" /><span class="unit">×</span></span></label>
             <div class="chip-row">
               <button class="chip" data-act="ot-preset" data-normal="1.5" data-weekend="2" data-holiday="3">法定基准 1.5× / 2× / 3×</button>
               <button class="chip" data-act="ot-preset" data-normal="1.5" data-weekend="1.5" data-holiday="1.5">统一 1.5×</button>
             </div>
           </div>`
    }
  </section>

  <section class="card">
    <div class="card-head"><div class="card-title">法定节假日</div><span class="tag">加班费率更高</span></div>
    ${
      s.holidays.length
        ? `<div class="chip-row">${s.holidays
            .map((d) => `<button class="chip" data-act="rm-holiday" data-date="${d}">${d.slice(5)} ×</button>`)
            .join('')}</div>`
        : '<div class="hint">还没有添加节假日。添加后，这一天的加班按节假日费率计算。</div>'
    }
    <div class="loc-actions">
      <input type="date" id="holiday-date" class="input date" />
      <button class="btn ghost sm" data-act="add-holiday">添加节假日</button>
    </div>
    <div class="loc-actions">
      <button class="btn ghost sm" data-act="sync-holidays">联网同步今年日历</button>
      <span class="hint">当前 ${s.holidays.length} 个日期</span>
    </div>
    <div class="hint">节假日来自联网日历或手动添加；只影响加班金额，不影响打卡。</div>
  </section>

  <section class="card">
    <div class="card-head"><div class="card-title">排班制</div><span class="tag">${s.shiftMode ? '已开启' : '固定工时'}</span></div>
    <div class="seg">
      <button data-act="shift-mode" data-value="off" class="${!s.shiftMode ? 'active' : ''}">固定工时</button>
      <button data-act="shift-mode" data-value="on" class="${s.shiftMode ? 'active' : ''}">排班制</button>
    </div>
    ${
      s.shiftMode
        ? `<div class="loc" style="margin-top:10px">
             <div class="loc-ico">🗓</div>
             <div class="loc-main">
               <b>今日${restToday ? '休息' : '上班'}</b>
               <small>${restToday ? '在排班日历里被标记为休息日' : `上班时间 ${s.shiftStart} – ${s.shiftEnd}`}</small>
             </div>
           </div>
           <div class="input-line end">
             <input type="time" class="input time" data-field="shiftStart" value="${s.shiftStart}" />
             <input type="time" class="input time" data-field="shiftEnd" value="${s.shiftEnd}" />
           </div>
           <div class="loc-actions">
             <button class="btn primary sm" data-act="shift-calendar">打开排班日历</button>
             <button class="btn ghost sm" data-act="import-shift">导入 CSV/JSON</button>
             <input type="file" id="shift-file" accept=".csv,.json,text/csv,application/json" hidden />
           </div>
           <div class="hint">点一下日期 = 休息日，再点一下 = 上班日；不点的默认上班。本月上班 ${schedCount} 天。</div>
           <div class="loc-actions">
             <button class="btn ghost sm" data-act="clear-schedule">清空本月休息标记</button>
           </div>`
        : '<div class="hint">开启后打开排班日历，点击日期即可标记休息；未标记的日期默认上班。</div>'
    }
  </section>

  <section class="card">
    <div class="card-head"><div class="card-title">公司位置</div><span class="tag">仅存本机</span></div>
    <div class="loc">
      <div class="loc-ico" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/></svg></div>
      <div class="loc-main">
        ${
          c
            ? `<b>${escapeHTML(c.label || '公司')}</b><small>${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}</small>`
            : '<b>未设置公司位置</b><small>不设置也能手动计时</small>'
        }
      </div>
    </div>
    <div class="loc-actions">
      <button class="btn ghost sm" data-act="set-here">${c ? '更新为当前位置' : '用当前位置设为公司'}</button>
      ${c ? '<button class="btn ghost sm" data-act="clear-company">清除位置</button>' : ''}
    </div>
    <div class="field">
      <label><span class="lab">打卡范围</span><span class="input-wrap"><input class="input" type="number" inputmode="numeric" data-field="companyRadius" value="${c ? c.radius : 200}" min="30" step="10" /><span class="unit">m</span></span></label>
    </div>
    <div class="field">
      <div class="seg">
        <button data-act="geo-mode" data-value="off" class="${s.geofenceMode === 'off' ? 'active' : ''}">关闭</button>
        <button data-act="geo-mode" data-value="loose" class="${s.geofenceMode === 'loose' ? 'active' : ''}">提醒</button>
        <button data-act="geo-mode" data-value="strict" class="${s.geofenceMode === 'strict' ? 'active' : ''}">严格</button>
      </div>
      <div class="hint">提醒：不在范围内可确认后打卡；严格：不在范围内直接拦截。定位只在本地计算，不会上传。</div>
    </div>
  </section>

  <section class="card">
    <div class="card-head"><div class="card-title">打卡方式</div><span class="tag">${s.checkInMode === 'auto' ? '自动' : '手动'}</span></div>
    <div class="seg">
      <button data-act="checkin-mode" data-value="manual" class="${s.checkInMode !== 'auto' ? 'active' : ''}">手动打卡</button>
      <button data-act="checkin-mode" data-value="auto" class="${s.checkInMode === 'auto' ? 'active' : ''}">自动打卡</button>
    </div>
    ${
      s.checkInMode === 'auto'
        ? `<div class="field">
             <label><span class="lab">进入公司范围自动打卡</span></label>
             <div class="seg">
               <button data-act="auto-geofence" data-value="on" class="${s.autoGeofence ? 'active' : ''}">开</button>
               <button data-act="auto-geofence" data-value="off" class="${!s.autoGeofence ? 'active' : ''}">关</button>
             </div>
           </div>
           <div class="field">
             <label><span class="lab">连接指定 WiFi 自动打卡</span></label>
             <div class="seg">
               <button data-act="auto-wifi" data-value="on" class="${s.autoWifi ? 'active' : ''}">开</button>
               <button data-act="auto-wifi" data-value="off" class="${!s.autoWifi ? 'active' : ''}">关</button>
             </div>
           </div>
           <div class="field">
             <label><span class="lab">WiFi 名称</span></label>
             <input class="input wide" data-field="wifiSsid" value="${escapeHTML(s.wifiSsid)}" placeholder="Office-5G" />
           </div>
           <div class="hint">自动打卡需 App 在前台；浏览器读不到 WiFi 名称，仅 Android 壳支持。定位每 60 秒检查一次，当天已有记录不会重复打卡。</div>`
        : '<div class="hint">到公司后手动点「打卡上班」；切到自动后，进入公司范围或连上指定 WiFi 会自动开始计时。</div>'
    }
  </section>

  <section class="card">
    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="btn ghost block" data-act="export">导出 JSON 备份</button>
      <button class="btn ghost block" data-act="demo">载入演示数据（今天 + 8 个工作日）</button>
      <button class="btn danger block" data-act="wipe">清空全部数据</button>
    </div>
  </section>

  <section class="card">
    <div class="card-head"><div class="card-title">关于</div><span class="tag">v0.3.0</span></div>
    <div class="about">
      <b>时薪时钟 SalaryClock</b> — 把月薪换算成看得见的每秒收入。<br>
      数据默认只保存在本机；登录后会同步到你配置的服务器。<br>
      加班费计算仅为个人记录工具，不构成法律意见。
    </div>
  </section>
  `;
}

/* ------------------------------------------------------------------ */
/* 实时刷新                                                           */
/* ------------------------------------------------------------------ */

const setText = (id, text) => {
  const el = document.getElementById(id);
  if (el && el.textContent !== text) el.textContent = text;
};

function setAmount(v) {
  const [int, cents] = fmtMoney(v).split('.');
  setText('live-int', int);
  setText('live-cents', `.${cents}`);
}

function refreshLive() {
  if (tab !== 'home' || !$('#live-int')) return;
  const s = state.settings;
  const tk = dateKey(new Date());
  const day = state.days[tk];
  const active = findActive();
  const ds = daySummary(day, s);
  const m = monthSummary(state.days, s, monthKeyOf(tk));
  const mode = active ? active.seg.t : 'idle';
  const rate = mode === 'idle' ? baseHourly(s) : rateFor(s, mode, active.day.date);
  const pct = s.monthlySalary > 0 ? Math.min(100, (m.pay / s.monthlySalary) * 100) : 0;

  setAmount(ds.pay);
  setText('live-clock', fmtClock(ds.totalMs));
  setText('live-month', `¥${fmtMoney(m.pay)}`);
  setText('live-pct', `${pct.toFixed(1)}%`);
  setText('live-rate', `¥${fmtMoney(rate)}`);
  setText('live-per-sec', `≈ 每秒 ¥${perSecond(rate)}`);

  const bar = $('#live-bar');
  if (bar) bar.style.width = `${pct.toFixed(2)}%`;

  const hero = $('#hero');
  if (hero) {
    hero.classList.toggle('is-ot', mode === 'overtime');
    hero.classList.toggle('is-normal', mode === 'normal');
    hero.classList.toggle('is-idle', mode === 'idle');
  }
  const pill = $('#hero-pill');
  if (pill) {
    const cls = mode === 'overtime' ? 'is-ot' : mode === 'normal' ? 'is-normal' : 'is-idle';
    const label = mode === 'overtime' ? '加班计时中' : mode === 'normal' ? '正常工作' : '未打卡';
    if (!pill.classList.contains(cls)) {
      pill.className = `pill ${cls}`;
    }
    setText('hero-pill-label', label);
  }
  const dot = $('#live-dot');
  if (dot) dot.hidden = mode === 'idle';
}

function updateClockText() {
  const now = new Date();
  setText('clock-now', `${pad2(now.getHours())}:${pad2(now.getMinutes())}`);
}

function tick() {
  updateClockText();
  const tk = dateKey(new Date());
  if (tk !== lastDate) {
    lastDate = tk;
    normalize();
    render();
    return;
  }
  refreshLive();
}

/* ------------------------------------------------------------------ */
/* 弹层 / 提示                                                        */
/* ------------------------------------------------------------------ */

function openSheet({ title, body = '', actions = [] }) {
  return new Promise((resolve) => {
    const root = $('#modal-root');
    root.innerHTML = `<div class="overlay"><div class="sheet" role="dialog" aria-modal="true">
      <h3>${title}</h3>
      ${body ? `<div class="sheet-body">${body}</div>` : ''}
      <div class="sheet-actions">
        ${actions
          .map((a, i) => `<button class="btn ${a.variant || 'ghost'}" data-idx="${i}">${a.label}</button>`)
          .join('')}
      </div>
    </div></div>`;
    const overlay = root.firstElementChild;
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      root.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') finish(null);
    };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) return finish(null);
      const btn = e.target.closest('[data-idx]');
      if (!btn) return;
      finish({ value: actions[Number(btn.dataset.idx)].value });
    });
  });
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

/* ------------------------------------------------------------------ */
/* 定位                                                               */
/* ------------------------------------------------------------------ */

function locate(timeout = 9000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ error: '当前浏览器不支持定位' });
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ pos: pos.coords }),
      (err) => resolve({ error: geoErrorText(err) }),
      { enableHighAccuracy: true, timeout, maximumAge: 30000 },
    );
  });
}

function geoErrorText(err) {
  if (!err) return '定位失败';
  if (err.code === 1) return '定位权限被拒绝，请在浏览器设置中允许位置权限';
  if (err.code === 2) return '无法获取位置（需要 HTTPS 或 localhost，且允许定位）';
  if (err.code === 3) return '定位超时，请重试';
  return err.message || '定位失败';
}

async function locationGate() {
  const s = state.settings;
  if (s.geofenceMode === 'off') return { ok: true };

  if (!s.company) {
    const r = await openSheet({
      title: '先记录公司位置',
      body: '开启位置校验后需要公司坐标。可以现在用当前位置设为公司，或本次先不校验。',
      actions: [
        { label: '用当前位置设为公司', value: 'here', variant: 'primary' },
        { label: '本次不校验，直接打卡', value: 'skip' },
        { label: '取消', value: null },
      ],
    });
    if (!r) return { ok: false };
    if (r.value === 'skip') return { ok: true };
    if (r.value === 'here') {
      const loc = await locate();
      if (!loc.pos) {
        toast(`定位失败：${loc.error}`);
        return { ok: false };
      }
      state.settings.company = {
        lat: loc.pos.latitude,
        lng: loc.pos.longitude,
        radius: 200,
        label: '公司',
      };
      save();
      toast('公司位置已记录');
      return { ok: true };
    }
    return { ok: false };
  }

  const loc = await locate();
  const radius = Number(s.company.radius) || 200;

  if (!loc.pos) {
    if (s.geofenceMode === 'strict') {
      const r = await openSheet({
        title: '无法获取当前位置',
        body: `${loc.error}<br><br>严格模式下需要定位成功才能打卡。`,
        actions: [
          { label: '手动打卡（会标记为手动）', value: 'manual', variant: 'primary' },
          { label: '取消', value: null },
        ],
      });
      return r && r.value === 'manual' ? { ok: true, manual: true } : { ok: false };
    }
    return { ok: true, manual: true };
  }

  const d = distanceMeters({ lat: loc.pos.latitude, lng: loc.pos.longitude }, s.company);
  if (d <= radius) return { ok: true, distance: d };

  if (s.geofenceMode === 'loose') {
    const r = await openSheet({
      title: '好像不在公司附近',
      body: `当前位置距公司约 <b>${fmtDistance(d)}</b>，超出 ${radius}m 的校验范围。仍要打卡吗？`,
      actions: [
        { label: '仍然打卡', value: 'go', variant: 'primary' },
        { label: '取消', value: null },
      ],
    });
    return r && r.value === 'go' ? { ok: true, manual: true, distance: d } : { ok: false };
  }

  const r = await openSheet({
    title: '不在打卡范围',
    body: `当前位置距公司约 <b>${fmtDistance(d)}</b>，超出 ${radius}m。严格模式下无法打卡。`,
    actions: [
      { label: '重新定位', value: 'retry', variant: 'primary' },
      { label: '取消', value: null },
    ],
  });
  if (r && r.value === 'retry') return locationGate();
  return { ok: false };
}

async function setCompanyHere() {
  const loc = await locate();
  if (!loc.pos) return toast(`定位失败：${loc.error}`);
  state.settings.company = {
    lat: loc.pos.latitude,
    lng: loc.pos.longitude,
    radius: Number(state.settings.company && state.settings.company.radius) || 200,
    label: '公司',
  };
  save();
  render();
  toast('公司位置已保存');
}

/* ------------------------------------------------------------------ */
/* 打卡动作                                                           */
/* ------------------------------------------------------------------ */

async function clockIn() {
  if (findActive()) return toast('已经在计时中');
  const gate = await locationGate();
  if (!gate.ok) return;
  const now = Date.now();
  const day = ensureDay(dateKey(new Date(now)));
  day.segments.push({ t: 'normal', s: now, e: null, manual: !!gate.manual });
  save();
  render();
  toast('已打卡上班 · 开始计时');
}

function startOvertime() {
  const active = findActive();
  if (!active) return toast('请先打卡上班');
  if (active.seg.t === 'overtime') return toast('已经处于加班计时');
  const now = Date.now();
  active.seg.e = Math.max(now, active.seg.s + 1000);
  ensureDay(dateKey(new Date(now))).segments.push({ t: 'overtime', s: now, e: null });
  save();
  render();
  toast(`已进入加班 · ¥${fmtMoney(overtimeHourly(state.settings, dateKey(new Date(now))))}/h`);
}

function stopOvertime() {
  const active = findActive();
  if (!active || active.seg.t !== 'overtime') return;
  const now = Date.now();
  active.seg.e = Math.max(now, active.seg.s + 1000);
  ensureDay(dateKey(new Date(now))).segments.push({ t: 'normal', s: now, e: null });
  save();
  render();
  toast('已结束加班，恢复普通计时');
}

async function clockOut() {
  const active = findActive();
  if (!active) return toast('当前没有进行中的打卡');
  const now = Date.now();
  active.seg.e = Math.max(now, active.seg.s + 1000);
  save();
  const tk = dateKey(new Date(now));
  const ds = daySummary(state.days[tk], state.settings);
  const m = monthSummary(state.days, state.settings, monthKeyOf(tk));
  render();
  await openSheet({
    title: '下班打卡成功',
    body: `<div class="sum-grid">
        <div><span>今日已赚</span><b class="lime">¥${fmtMoney(ds.pay)}</b></div>
        <div><span>本月已赚</span><b>¥${fmtMoney(m.pay)}</b></div>
        <div><span>今日工时</span><b>${fmtDur(ds.totalMs)}</b></div>
        <div><span>其中加班</span><b>${fmtDur(ds.otMs)}</b></div>
      </div>`,
    actions: [{ label: '好的', value: 'ok', variant: 'primary' }],
  });
}

/* ------------------------------------------------------------------ */
/* 记录 / 设置动作                                                    */
/* ------------------------------------------------------------------ */

function shiftMonth(delta) {
  const [y, m] = recordsMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  recordsMonth = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  render();
}

function monthLabel(mk) {
  const [y, m] = mk.split('-');
  return `${y}年${Number(m)}月`;
}

async function removeDay(k) {
  const r = await openSheet({
    title: '删除这天的记录？',
    body: `${k} 的打卡记录与金额会一起删除，无法恢复。`,
    actions: [
      { label: '删除', value: 'del', variant: 'danger' },
      { label: '取消', value: null },
    ],
  });
  if (r && r.value === 'del') {
    delete state.days[k];
    save();
    render();
    toast('已删除');
  }
}

function openBackfill() {
  const root = $('#modal-root');
  const today = dateKey(new Date());
  root.innerHTML = `<div class="overlay"><div class="sheet" role="dialog" aria-modal="true">
    <h3>补录一天</h3>
    <div class="sheet-body">
      <div class="form-field"><label>日期</label><input type="date" id="bf-date" value="${today}" max="${today}" /></div>
      <div class="form-row">
        <div class="form-field"><label>上班时间</label><input type="time" id="bf-start" value="09:00" /></div>
        <div class="form-field"><label>下班时间</label><input type="time" id="bf-end" value="18:30" /></div>
      </div>
      <div class="form-field"><label>加班开始（留空表示没有加班）</label><input type="time" id="bf-ot" value="" /></div>
      <div class="form-field" style="font-size:11.5px;color:var(--muted)">用于补漏打卡，只保存在本机。</div>
    </div>
    <div class="sheet-actions">
      <button class="btn primary" data-bf="save">保存</button>
      <button class="btn ghost" data-bf="close">取消</button>
    </div>
  </div></div>`;

  const overlay = root.firstElementChild;
  const close = () => {
    root.innerHTML = '';
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) return close();
    const btn = e.target.closest('[data-bf]');
    if (!btn) return;
    if (btn.dataset.bf === 'close') return close();
    const err = applyBackfill({
      date: overlay.querySelector('#bf-date').value,
      start: overlay.querySelector('#bf-start').value,
      end: overlay.querySelector('#bf-end').value,
      otStart: overlay.querySelector('#bf-ot').value,
    });
    if (err) return toast(err);
    close();
  });
}

function applyBackfill({ date, start, end, otStart }) {
  if (!date || !start || !end) return '请填写日期和上下班时间';
  const base = parseDateKey(date).getTime();
  const at = (t) => {
    const [h, m] = t.split(':').map(Number);
    return base + h * 3600000 + m * 60000;
  };
  const s1 = at(start);
  const s2 = at(end);
  if (!(s2 > s1)) return '下班时间需要晚于上班时间';

  const segs = [];
  if (otStart) {
    const o = at(otStart);
    if (o < s1 || o >= s2) return '加班开始时间需要在上、下班之间';
    segs.push({ t: 'normal', s: s1, e: o });
    segs.push({ t: 'overtime', s: o, e: s2 });
  } else {
    segs.push({ t: 'normal', s: s1, e: s2 });
  }

  const day = ensureDay(date);
  day.segments.forEach((seg) => {
    if (seg.e == null) seg.e = Math.min(s1, seg.s + 1000);
  });
  day.segments.push(...segs);
  save();
  render();
  toast(`已补录 ${date}：¥${fmtMoney(daySummary(day, state.settings).pay)}`);
  return null;
}

function openCalib(mk) {
  const root = $('#modal-root');
  const existing = state.months[mk]?.actualPay;
  const estimate = monthSummary(state.days, state.settings, mk).pay;
  root.innerHTML = `<div class="overlay"><div class="sheet" role="dialog" aria-modal="true">
    <h3>${monthLabel(mk)} · 实发校准</h3>
    <div class="sheet-body">
      <p>输入这个月实际到账的工资，用来对比 App 估算，也能反推税后时薪。</p>
      <div class="form-field"><label>实发金额（元）</label><input type="number" inputmode="decimal" id="cal-amount" value="${existing != null ? existing : ''}" placeholder="例如 13500" min="0" step="0.01" /></div>
      <div class="form-field" style="font-size:11.5px;color:var(--muted)">当前估算 ¥${fmtMoney(estimate)} · 只做对比，不改变计时金额。</div>
    </div>
    <div class="sheet-actions">
      <button class="btn primary" data-cal="save">保存</button>
      ${existing != null ? '<button class="btn danger" data-cal="clear">清除校准</button>' : ''}
      <button class="btn ghost" data-cal="close">取消</button>
    </div>
  </div></div>`;

  const overlay = root.firstElementChild;
  const close = () => {
    root.innerHTML = '';
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) return close();
    const btn = e.target.closest('[data-cal]');
    if (!btn) return;
    const act = btn.dataset.cal;
    if (act === 'close') return close();
    if (act === 'clear') {
      delete state.months[mk];
      save();
      close();
      render();
      toast('已清除实发校准');
      return;
    }
    const v = parseFloat(overlay.querySelector('#cal-amount').value);
    if (!Number.isFinite(v) || v <= 0) return toast('请输入大于 0 的实发金额');
    if (v > 10000000) return toast('金额过大，请检查');
    state.months[mk] = { actualPay: Math.round(v * 100) / 100, updatedAt: Date.now() };
    save();
    close();
    render();
    toast('已记录实发工资');
  });
}

function openAuth(mode) {
  const root = $('#modal-root');
  const isLogin = mode === 'login';
  root.innerHTML = `<div class="overlay"><div class="sheet" role="dialog" aria-modal="true">
    <h3>${isLogin ? '登录' : '注册'}</h3>
    <div class="sheet-body">
      <p>${isLogin ? '登录后会把本机记录与云端记录合并。' : '注册后数据保存在你配置的服务器，换设备登录即可取回。'}</p>
      <div class="form-field"><label>用户名</label><input id="auth-user" autocomplete="username" placeholder="3–24 位字母/数字" /></div>
      <div class="form-field"><label>密码</label><input id="auth-pass" type="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" placeholder="至少 6 位" /></div>
      <div class="form-field" id="auth-error" style="color:var(--red);font-size:12px;display:none"></div>
      <div class="form-field" style="font-size:11.5px;color:var(--muted);word-break:break-all">服务器：${escapeHTML(auth.apiBase || location.origin)}</div>
    </div>
    <div class="sheet-actions">
      <button class="btn primary" data-auth="submit">${isLogin ? '登录' : '注册并登录'}</button>
      <button class="btn ghost" data-auth="close">取消</button>
    </div>
  </div></div>`;

  const overlay = root.firstElementChild;
  const errorEl = overlay.querySelector('#auth-error');
  const close = () => {
    root.innerHTML = '';
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);

  const submit = async () => {
    const username = overlay.querySelector('#auth-user').value.trim();
    const password = overlay.querySelector('#auth-pass').value;
    errorEl.style.display = 'none';
    if (!username || !password) {
      errorEl.textContent = '请填写用户名和密码';
      errorEl.style.display = 'block';
      return;
    }
    const btn = overlay.querySelector('[data-auth="submit"]');
    btn.disabled = true;
    btn.textContent = '请稍候…';
    try {
      const res = await apiFetch(`/api/auth/${isLogin ? 'login' : 'register'}`, {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      auth = { ...auth, token: res.token, username: res.user.username, lastSync: 0 };
      saveAuth();
      close();
      await afterLogin();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = isLogin ? '登录' : '注册并登录';
    }
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) return close();
    const btn = e.target.closest('[data-auth]');
    if (!btn) return;
    if (btn.dataset.auth === 'close') return close();
    submit();
  });
  overlay.querySelector('#auth-pass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
}

async function afterLogin() {
  try {
    const cloud = await syncPull();
    if (cloud && cloud.data) {
      state = mergeData(state, cloud.data);
      save();
    }
    await syncPush();
    render();
    toast(`已登录 ${auth.username}，记录已同步`);
  } catch (err) {
    render();
    toast(`已登录，但同步失败：${err.message}`);
  }
}

function parseSchedule(text) {
  const out = {};
  const trimmed = String(text || '').trim();
  if (!trimmed) return out;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const json = JSON.parse(trimmed);
    if (Array.isArray(json)) {
      json.forEach((item) => {
        if (item && item.date && item.start) {
          out[item.date] = { start: item.start, end: item.end || '18:00' };
        }
      });
    } else {
      Object.entries(json).forEach(([key, value]) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
        if (typeof value === 'string') out[key] = { start: value, end: '18:00' };
        else if (value && value.start) out[key] = { start: value.start, end: value.end || '18:00' };
      });
    }
    return out;
  }
  trimmed.split(/\r?\n/).forEach((line) => {
    const cells = line.split(',').map((c) => c.trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cells[0] || '')) return;
    out[cells[0]] = { start: cells[1] || '09:00', end: cells[2] || '18:00' };
  });
  return out;
}

async function importScheduleFile(file) {
  if (!file) return;
  try {
    const parsed = parseSchedule(await file.text());
    const dates = Object.keys(parsed);
    if (!dates.length) return toast('没有解析到排班，请检查格式');
    Object.assign(state.settings.schedule, parsed);
    save();
    render();
    toast(`已导入 ${dates.length} 天排班`);
  } catch (err) {
    toast(`导入失败：${err.message}`);
  }
}

/* ---------------- 日历（收入视图 / 排班编辑） ---------------- */
let calMonth = monthKeyOf(dateKey(new Date()));
let calMode = 'view';

function openCalendar(mode = 'view', month) {
  calMode = mode;
  calMonth = month || monthKeyOf(dateKey(new Date()));
  renderCalendar();
}

function shiftCal(delta) {
  const [y, m] = calMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  calMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  renderCalendar();
}

function renderCalendar() {
  const root = $('#modal-root');
  const [y, m] = calMonth.split('-').map(Number);
  const offset = new Date(y, m - 1, 1).getDay();
  const total = daysInMonth(calMonth);
  const cells = [];
  for (let i = 0; i < offset; i += 1) cells.push('<span class="cal-cell blank"></span>');
  for (let d = 1; d <= total; d += 1) {
    const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const day = state.days[key];
    const ds = day ? daySummary(day, state.settings) : null;
    const pay = ds ? ds.pay : 0;
    const holiday = state.settings.holidays.includes(key);
    const rest = isRestDay(state.settings, key);
    const today = key === dateKey(new Date());
    cells.push(`<button class="cal-cell ${today ? 'today' : ''} ${holiday ? 'holiday' : ''} ${rest ? 'rest' : ''}" data-act="cal-day" data-day="${key}">
      <span class="cal-num">${d}</span>
      ${rest ? '<span class="cal-rest">休</span>' : pay > 0 ? `<span class="cal-pay">${pay >= 1000 ? `¥${(pay / 1000).toFixed(1)}k` : `¥${pay.toFixed(0)}`}</span>` : ''}
      ${holiday ? '<i class="cal-dot"></i>' : ''}
    </button>`);
  }
  root.innerHTML = `<div class="overlay"><div class="sheet cal-sheet" role="dialog" aria-modal="true">
    <div class="cal-head">
      <button class="icon-btn" data-act="cal-prev" aria-label="上个月">‹</button>
      <b>${y}年${m}月</b>
      <button class="icon-btn" data-act="cal-next" aria-label="下个月">›</button>
    </div>
    <div class="cal-week">${['日', '一', '二', '三', '四', '五', '六'].map((w) => `<span>${w}</span>`).join('')}</div>
    <div class="cal-grid">${cells.join('')}</div>
    <div class="cal-hint">${calMode === 'edit' ? '点击日期切换「休息 / 上班」，未标记默认上班' : '日期下方是当天已赚，红点表示节假日'}</div>
    <div class="sheet-actions">
      <button class="btn ghost" data-act="cal-close">关闭</button>
    </div>
  </div></div>`;
}

function showDayDetail(key) {
  const day = state.days[key];
  const ds = day ? daySummary(day, state.settings) : null;
  const holiday = state.settings.holidays.includes(key);
  const rest = state.settings.shiftMode ? isRestDay(state.settings, key) : false;
  openSheet({
    title: `${key}${holiday ? ' · 节假日' : ''}`,
    body: `<div class="sum-grid">
      <div><span>当天收入</span><b class="lime">¥${fmtMoney(ds ? ds.pay : 0)}</b></div>
      <div><span>工时</span><b>${fmtDur(ds ? ds.totalMs : 0)}</b></div>
      <div><span>加班</span><b>${fmtDur(ds ? ds.otMs : 0)}</b></div>
      <div><span>排班</span><b>${state.settings.shiftMode ? (rest ? '休息' : '上班') : '—'}</b></div>
    </div>`,
    actions: [{ label: '关闭', value: null }],
  });
}

/* ---------------- 自动打卡 ---------------- */
function autoCheckInAllowed() {
  const s = state.settings;
  if (s.checkInMode !== 'auto') return false;
  if (findActive()) return false;
  const day = state.days[dateKey(new Date())];
  return !(day && day.segments && day.segments.length);
}

async function maybeAutoCheckIn() {
  if (!autoCheckInAllowed()) return;
  const s = state.settings;

  if (s.autoWifi && s.wifiSsid) {
    let ssid = '';
    try {
      const bridge = window.SalaryClockNative;
      if (bridge && typeof bridge.getWifiSsid === 'function') ssid = String(bridge.getWifiSsid() || '');
    } catch (err) {
      ssid = '';
    }
    if (ssid && ssid === s.wifiSsid) return doAutoClockIn(`WiFi「${ssid}」`);
  }

  if (s.autoGeofence && s.company) {
    const loc = await locate(6000);
    if (loc.pos) {
      const dist = distanceMeters({ lat: loc.pos.latitude, lng: loc.pos.longitude }, s.company);
      if (dist <= (Number(s.company.radius) || 200)) return doAutoClockIn('进入公司范围');
    }
  }
}

function doAutoClockIn(reason) {
  if (findActive()) return;
  const now = Date.now();
  ensureDay(dateKey(new Date(now))).segments.push({ t: 'normal', s: now, e: null, auto: true });
  save();
  render();
  toast(`已自动打卡上班（${reason}）`);
}

window.__salaryClockAutoCheckIn = maybeAutoCheckIn;

function exportJSON() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `salary-clock-${dateKey(new Date())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('已导出 JSON 备份');
}

async function wipeAll() {
  const r = await openSheet({
    title: '清空全部数据？',
    body: '所有打卡记录、设置与公司位置都会被删除，无法恢复。建议先导出备份。',
    actions: [
      { label: '确认清空', value: 'wipe', variant: 'danger' },
      { label: '取消', value: null },
    ],
  });
  if (!r || r.value !== 'wipe') return;
  try {
    localStorage.removeItem(STORE_KEY);
  } catch (err) {
    console.warn(err);
  }
  state = loadState();
  tab = 'home';
  render({ top: true });
  toast('数据已清空');
}

function seedDemo() {
  const now = new Date();
  const days = {};
  let d = new Date(now);
  d.setDate(d.getDate() - 1);
  let made = 0;
  while (made < 8) {
    const k = dateKey(d);
    if (!isWeekend(k)) {
      const base = parseDateKey(k).getTime();
      const segs = [
        { t: 'normal', s: base + 9 * 3600000 + 12 * 60000, e: base + 18 * 3600000 + 4 * 60000 },
      ];
      if (made % 3 === 0) {
        segs.push({ t: 'overtime', s: base + 18 * 3600000 + 4 * 60000, e: base + 19 * 3600000 + 34 * 60000 });
      }
      days[k] = { date: k, segments: segs };
      made += 1;
    }
    d.setDate(d.getDate() - 1);
  }
  const todayK = dateKey(now);
  const tb = parseDateKey(todayK).getTime();
  days[todayK] = {
    date: todayK,
    segments: [
      { t: 'normal', s: tb + 9 * 3600000 + 5 * 60000, e: tb + 18 * 3600000 },
      { t: 'overtime', s: tb + 18 * 3600000, e: null },
    ],
  };
  state.days = days;
  save();
}

/* ------------------------------------------------------------------ */
/* 事件                                                               */
/* ------------------------------------------------------------------ */

const actions = {
  tab: (el) => {
    tab = el.dataset.tab;
    render({ top: true });
  },
  clockin: () => clockIn(),
  'ot-start': () => startOvertime(),
  'ot-stop': () => stopOvertime(),
  clockout: () => clockOut(),
  'prev-month': () => shiftMonth(-1),
  'next-month': () => shiftMonth(1),
  backfill: () => openBackfill(),
  'rm-day': (el) => removeDay(el.dataset.day),
  'set-here': () => setCompanyHere(),
  'clear-company': () => {
    state.settings.company = null;
    save();
    render();
    toast('已清除公司位置');
  },
  'ot-mode': (el) => {
    state.settings.otMode = el.dataset.value;
    save();
    render();
  },
  'set-theme': (el) => {
    const theme = el.dataset.value;
    if (!THEMES.includes(theme)) return;
    state.settings.theme = theme;
    save();
    applyTheme(theme);
    render();
  },
  'preset-days': (el) => {
    if (el.dataset.value === 'custom') {
      const inp = document.querySelector('[data-field="workDaysPerMonth"]');
      if (inp) {
        inp.focus();
        inp.select();
      }
      toast('可直接修改下面的天数');
      return;
    }
    state.settings.workDaysPerMonth = Number(el.dataset.value);
    save();
    render();
  },
  'ot-fill': (el) => {
    const v = Number(el.dataset.value);
    const field = el.dataset.field || 'otFixedRate';
    state.settings[field] = v;
    save();
    render();
    toast(`已填入 ¥${fmtMoney(v)}/h`);
  },
  'ot-preset': (el) => {
    state.settings.otMultiplier = Number(el.dataset.normal);
    state.settings.otWeekendMultiplier = Number(el.dataset.weekend);
    if (el.dataset.holiday) state.settings.otHolidayMultiplier = Number(el.dataset.holiday);
    save();
    render();
    toast(`倍率已填入 ${el.dataset.normal}× / ${el.dataset.weekend}×`);
  },
  'add-holiday': () => {
    const input = document.getElementById('holiday-date');
    const date = input && input.value;
    if (!date) return toast('请先选择日期');
    if (!state.settings.holidays.includes(date)) state.settings.holidays.push(date);
    state.settings.holidays.sort();
    save();
    render();
    toast(`已添加节假日 ${date}`);
  },
  'rm-holiday': (el) => {
    state.settings.holidays = state.settings.holidays.filter((d) => d !== el.dataset.date);
    save();
    render();
  },
  'shift-mode': (el) => {
    state.settings.shiftMode = el.dataset.value === 'on';
    save();
    render();
  },
  'set-shift': () => {
    const date = document.getElementById('shift-date')?.value;
    const start = document.getElementById('shift-start')?.value;
    const end = document.getElementById('shift-end')?.value;
    if (!date || !start || !end) return toast('请填写日期与上下班时间');
    if (!(start < end)) return toast('下班时间需要晚于上班时间');
    state.settings.schedule[date] = { start, end };
    save();
    render();
    toast(`已排班 ${date} ${start}–${end}`);
  },
  'clear-shift': () => {
    const date = document.getElementById('shift-date')?.value;
    if (!date) return toast('请先选择日期');
    delete state.settings.schedule[date];
    save();
    render();
    toast(`已将 ${date} 设为休息日`);
  },
  'import-shift': () => document.getElementById('shift-file')?.click(),
  'clear-schedule': async () => {
    const mk = monthKeyOf(dateKey(new Date()));
    const r = await openSheet({
      title: '清空本月排班？',
      body: `${monthLabel(mk)} 的排班记录会被删除，打卡记录不受影响。`,
      actions: [
        { label: '清空', value: 'ok', variant: 'danger' },
        { label: '取消', value: null },
      ],
    });
    if (!r || r.value !== 'ok') return;
    Object.keys(state.settings.schedule).forEach((k) => {
      if (k.startsWith(mk)) delete state.settings.schedule[k];
    });
    save();
    render();
    toast('已清空本月排班');
  },
  login: () => openAuth('login'),
  register: () => openAuth('register'),
  logout: async () => {
    const r = await openSheet({
      title: '退出登录？',
      body: '本机打卡记录会保留，只是不再自动同步。',
      actions: [
        { label: '退出', value: 'ok', variant: 'danger' },
        { label: '取消', value: null },
      ],
    });
    if (!r || r.value !== 'ok') return;
    auth = { ...auth, token: '', username: '', lastSync: 0 };
    saveAuth();
    render();
    toast('已退出登录');
  },
  'sync-now': () => syncNow(true),
  autosync: (el) => {
    auth.autoSync = el.dataset.value === 'on';
    saveAuth();
    render();
  },
  calib: (el) => openCalib(el.dataset.month || recordsMonth),
  'calib-clear': async (el) => {
    const mk = el.dataset.month || recordsMonth;
    const r = await openSheet({
      title: '清除这个月的实发校准？',
      body: `${monthLabel(mk)} 的实发金额与对比数据会被删除，打卡记录不受影响。`,
      actions: [
        { label: '清除', value: 'ok', variant: 'danger' },
        { label: '取消', value: null },
      ],
    });
    if (!r || r.value !== 'ok') return;
    delete state.months[mk];
    save();
    render();
    toast('已清除校准');
  },
  'geo-mode': (el) => {
    state.settings.geofenceMode = el.dataset.value;
    save();
    render();
  },
  calendar: () => openCalendar('view'),
  'shift-calendar': () => openCalendar('edit'),
  'cal-prev': () => shiftCal(-1),
  'cal-next': () => shiftCal(1),
  'cal-close': () => {
    $('#modal-root').innerHTML = '';
    if (calMode === 'edit') render();
  },
  'cal-day': (el) => {
    const key = el.dataset.day;
    if (!key) return;
    if (calMode === 'edit') {
      const entry = state.settings.schedule[key];
      if (entry && entry.rest) delete state.settings.schedule[key];
      else state.settings.schedule[key] = { rest: true };
      save();
      renderCalendar();
      return;
    }
    showDayDetail(key);
  },
  'sync-holidays': async () => {
    const year = new Date().getFullYear();
    try {
      const data = await apiFetch(`/api/holidays?year=${year}`);
      const dates = (data.holidays || []).map((h) => h.date);
      if (!dates.length) return toast('日历里没有节假日数据');
      state.settings.holidays = [...new Set([...state.settings.holidays, ...dates])].sort();
      save();
      render();
      toast(`已同步 ${dates.length} 个节假日（${data.source === 'remote' ? '网络' : '缓存'}）`);
    } catch (err) {
      toast(`同步失败：${err.message}`);
    }
  },
  'checkin-mode': (el) => {
    state.settings.checkInMode = el.dataset.value === 'auto' ? 'auto' : 'manual';
    save();
    render();
  },
  'auto-geofence': (el) => {
    state.settings.autoGeofence = el.dataset.value === 'on';
    save();
    render();
  },
  'auto-wifi': (el) => {
    state.settings.autoWifi = el.dataset.value === 'on';
    save();
    render();
  },
  export: () => exportJSON(),
  wipe: () => wipeAll(),
  demo: () => {
    seedDemo();
    tab = 'home';
    render({ top: true });
    toast('演示数据已载入（今天是加班进行中）');
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  fn(el);
});

const STRING_FIELDS = ['apiBase', 'wifiSsid', 'shiftStart', 'shiftEnd'];

document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-field]');
  if (!el || tab !== 'settings') return;
  const field = el.dataset.field;
  if (STRING_FIELDS.includes(field)) {
    if (field === 'apiBase') auth.apiBase = el.value.trim();
    else state.settings[field] = el.value;
    saveAuth();
    save();
    return;
  }
  let v = parseFloat(el.value);
  if (!Number.isFinite(v)) v = 0;

  if (field === 'companyRadius') {
    if (state.settings.company) state.settings.company.radius = Math.round(v);
    save();
    return;
  }
  state.settings[field] = v;
  save();
  updateDerived();
});

document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'shift-file') {
    importScheduleFile(e.target.files && e.target.files[0]);
    e.target.value = '';
    return;
  }
  const changedField = e.target && e.target.dataset ? e.target.dataset.field : '';
  if (changedField === 'apiBase' || changedField === 'wifiSsid') return;
  if (changedField === 'shiftStart' || changedField === 'shiftEnd') {
    save();
    render();
    return;
  }
  const el = e.target.closest('[data-field]');
  if (!el || tab !== 'settings') return;
  const s = state.settings;
  if (s.workDaysPerMonth <= 0) {
    s.workDaysPerMonth = 21.75;
    toast('月计薪天数需大于 0，已重置');
  }
  if (s.hoursPerDay <= 0) {
    s.hoursPerDay = 8;
    toast('每日工时需大于 0，已重置');
  }
  if (s.monthlySalary < 0) s.monthlySalary = 0;
  if (s.otFixedRate < 0) s.otFixedRate = 0;
  if (s.company && (s.company.radius < 30 || !Number.isFinite(s.company.radius))) {
    s.company.radius = 200;
  }
  save();
  render();
});

function updateDerived() {
  const s = state.settings;
  const bh = baseHourly(s);
  setText('derived-hourly', `¥${fmtMoney(bh)}`);
  setText('derived-ot', `¥${fmtMoney(overtimeHourly(s))}`);
  setText('derived-breakdown', `${fmtMoney(s.monthlySalary)} ÷ ${s.workDaysPerMonth} 天 ÷ ${s.hoursPerDay} 小时 = ¥${fmtMoney(bh)}/h`);
  const hint = complianceHint(s);
  setText('compliance', hint);
  const warn = document.getElementById('compliance');
  if (warn) warn.hidden = !hint;
}

/* ------------------------------------------------------------------ */
/* 启动                                                               */
/* ------------------------------------------------------------------ */

function init() {
  const q = new URLSearchParams(location.search);
  if (q.get('demo')) seedDemo();
  const t = q.get('tab');
  if (['home', 'records', 'settings'].includes(t)) tab = t;

  applyTheme(state.settings.theme);
  normalize();
  render({ top: true });
  setInterval(tick, 500);

  if (state.settings.checkInMode === 'auto') {
    setTimeout(maybeAutoCheckIn, 1500);
    setInterval(maybeAutoCheckIn, 60000);
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) maybeAutoCheckIn();
  });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();
