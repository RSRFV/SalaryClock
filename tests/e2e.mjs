/**
 * 端到端冒烟测试：用 Chrome DevTools Protocol 驱动真实页面
 * 运行前提：本地静态服务 + 带 --remote-debugging-port=9222 的 Chrome
 * 用法：node tests/e2e.mjs
 */
const PORT = 9222;
const APP = 'http://127.0.0.1:8787/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  → ${detail}`}`);
}

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('没有找到页面目标');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let id = 0;
const pending = new Map();
const exceptions = [];
const consoleErrors = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
    else p.resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    exceptions.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    consoleErrors.push(msg.params.entry.text);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || 'eval error');
  return res.result.value;
}

async function waitApp(timeout = 8000) {
  return evaluate(`new Promise((resolve) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (document.querySelector('#live-int')) { clearInterval(iv); resolve(true); }
      else if (Date.now() - t0 > ${timeout}) { clearInterval(iv); resolve(false); }
    }, 50);
  })`);
}

async function reload() {
  await send('Page.reload', { ignoreCache: true });
  await sleep(300);
  const ok = await waitApp();
  if (!ok) throw new Error('页面未渲染');
}

const readState = async () => JSON.parse(await evaluate(`localStorage.getItem('salary-clock-v1') || '{}'`));
const activeSeg = (st) =>
  Object.values(st.days || {}).flatMap((d) => d.segments || []).find((s) => s.e == null);

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Page.navigate', { url: APP });
await sleep(500);
check('首屏渲染', await waitApp());

// 干净环境 + 关闭定位校验，避免无头浏览器没有定位
await evaluate(`localStorage.clear(); localStorage.setItem('salary-clock-v1', JSON.stringify({ settings: { geofenceMode: 'off' }, days: {} })); 1`);
await reload();
check('首屏为空（未打卡）', (await evaluate(`document.getElementById('hero-pill-label').textContent`)) === '未打卡');

// 1. 打卡上班
await evaluate(`document.querySelector('[data-act="clockin"]').click(); 1`);
await sleep(400);
let st = await readState();
const active1 = activeSeg(st);
check('打卡上班创建进行中时段', !!active1 && active1.t === 'normal', JSON.stringify(active1));
check('首页切到正常工作状态', (await evaluate(`document.getElementById('hero-pill-label').textContent`)) === '正常工作');
check('时薪显示 ¥91.95', (await evaluate(`document.getElementById('live-rate').textContent`)) === '¥91.95');
check('显示每秒收益', (await evaluate(`document.getElementById('live-per-sec').textContent`)).includes('0.0255'));

// 2. 实时累加
const before = await evaluate(`document.getElementById('live-int').textContent + document.getElementById('live-cents').textContent`);
await sleep(2200);
const after = await evaluate(`document.getElementById('live-int').textContent + document.getElementById('live-cents').textContent`);
const toNum = (s) => Number(String(s).replace(/[¥,\s]/g, ''));
check('2 秒内金额增长', toNum(after) > toNum(before), `${before} → ${after}`);

// 3. 开始加班
await evaluate(`document.querySelector('[data-act="ot-start"]').click(); 1`);
await sleep(400);
st = await readState();
const active2 = activeSeg(st);
check('开始加班切换到加班时段', !!active2 && active2.t === 'overtime', JSON.stringify(active2));
check('加班模式为 ¥100.00/h', (await evaluate(`document.getElementById('live-rate').textContent`)) === '¥100.00');
check('首页切到加班状态', (await evaluate(`document.getElementById('hero-pill-label').textContent`)) === '加班计时中');
const segs = Object.values(st.days).flatMap((d) => d.segments);
check('当天共两段（正常 + 加班）', segs.length === 2, JSON.stringify(segs.map((s) => [s.t, s.e == null])));

// 4. 下班打卡 → 汇总弹层
await evaluate(`document.querySelector('[data-act="clockout"]').click(); 1`);
await sleep(500);
const sheetTitle = await evaluate(`document.querySelector('.sheet h3')?.textContent || ''`);
check('弹出下班汇总', sheetTitle.includes('下班打卡成功'), sheetTitle);
const sheetText = await evaluate(`document.querySelector('.sheet-body')?.textContent || ''`);
check('汇总含今日/本月金额', sheetText.includes('今日已赚') && sheetText.includes('本月已赚'), sheetText.slice(0, 80));
await evaluate(`document.querySelector('[data-idx="0"]').click(); 1`);
await sleep(300);
st = await readState();
check('下班后无进行中时段', !activeSeg(st));

// 5. 补录
const yKey = await evaluate(`(() => { const d = new Date(); d.setDate(d.getDate() - 1); const p = n => String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); })()`);
await evaluate(`document.querySelector('[data-act="backfill"]').click(); 1`);
await sleep(200);
await evaluate(`
  document.querySelector('#bf-date').value = ${JSON.stringify(yKey)};
  document.querySelector('#bf-start').value = '09:30';
  document.querySelector('#bf-end').value = '20:00';
  document.querySelector('#bf-ot').value = '18:30';
  document.querySelector('[data-bf="save"]').click(); 1`);
await sleep(400);
st = await readState();
const ySegs = st.days[yKey]?.segments || [];
check('补录写入昨天记录', ySegs.length === 2, JSON.stringify(ySegs));
const yNormalH = (ySegs[0].e - ySegs[0].s) / 3600000;
const yOtH = (ySegs[1].e - ySegs[1].s) / 3600000;
check('补录工时正确（9h 正常 + 1.5h 加班）', Math.abs(yNormalH - 9) < 0.01 && Math.abs(yOtH - 1.5) < 0.01, `${yNormalH}/${yOtH}`);

// 6. 记录页
await evaluate(`document.querySelector('[data-act="tab"][data-tab="records"]').click(); 1`);
await sleep(300);
const recTitle = await evaluate(`document.querySelector('.month-nav .label')?.textContent || ''`);
check('记录页显示当月', recTitle.includes('年'), recTitle);
const dayCards = await evaluate(`document.querySelectorAll('.day-card').length`);
check('记录页有日期卡片', dayCards >= 1, String(dayCards));

// 6.1 实发校准
const mk = await evaluate(`(() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1); })()`);
await evaluate(`document.querySelector('[data-act="calib"]').click(); 1`);
await sleep(250);
await evaluate(`document.querySelector('#cal-amount').value = '13500'; document.querySelector('[data-cal="save"]').click(); 1`);
await sleep(400);
st = await readState();
check('实发校准写入', Math.abs((st.months?.[mk]?.actualPay || 0) - 13500) < 0.001, JSON.stringify(st.months));
const calText = await evaluate(`document.querySelector('.adjust')?.textContent || ''`);
check('校准卡展示差额与反推时薪', calText.includes('实发到账') && calText.includes('反推税后时薪'), calText.slice(0, 60));
const calDiff = await evaluate(`document.querySelector('.adjust .diff')?.textContent || ''`);
check('差额有正负号与格式', /^[+−]¥[\d,]+\.\d{2}$/.test(calDiff.trim()), calDiff);

await evaluate(`document.querySelector('[data-act="calib-clear"]').click(); 1`);
await sleep(250);
await evaluate(`document.querySelector('[data-idx="0"]').click(); 1`);
await sleep(350);
st = await readState();
check('清除实发校准', !st.months?.[mk], JSON.stringify(st.months));

// 7. 设置：主题 → 口径预设 → 改月薪
await evaluate(`document.querySelector('[data-act="tab"][data-tab="settings"]').click(); 1`);
await sleep(300);

// 7.0 主题切换（默认白色简洁）
check('默认主题为 light', (await evaluate(`document.documentElement.getAttribute('data-theme')`)) === 'light');
for (const [theme, metaColor] of [['pink', '#fff4f8'], ['dark', '#070a0f'], ['light', '#f5f6f8']]) {
  await evaluate(`document.querySelector('[data-act="set-theme"][data-value="${theme}"]').click(); 1`);
  await sleep(250);
  const applied = await evaluate(`document.documentElement.getAttribute('data-theme')`);
  check(`主题切换 ${theme} 生效`, applied === theme, applied);
  const themeMeta = await evaluate(`document.querySelector('meta[name="theme-color"]').getAttribute('content')`);
  check(`主题 ${theme} 更新状态栏颜色`, themeMeta.toLowerCase() === metaColor, themeMeta);
  const themeState = await readState();
  check(`主题 ${theme} 持久化`, themeState.settings.theme === theme, String(themeState.settings.theme));
}

// 自定义背景图
await evaluate(`(async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
  const blob = await (await fetch(png)).blob();
  const file = new File([blob], 'bg.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const input = document.getElementById('bg-file');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 1;
})()`);
await sleep(1000);
check('上传背景图', (await evaluate(`document.body.classList.contains('has-bg')`)) === true);
check('背景图本地持久化', (await evaluate(`!!localStorage.getItem('salary-clock-bg-v1')`)) === true);
await evaluate(`document.querySelector('[data-act="remove-bg"]').click(); 1`);
await sleep(300);
check('移除背景图', (await evaluate(`!document.body.classList.contains('has-bg')`)) === true);

// 月计薪天数：法定 / 不固定 / 自定义
check('默认按法定 21.75', (await evaluate(`document.querySelector('[data-act="workdays-mode"][data-value="legal"]').classList.contains('active')`)) === true);
await evaluate(`document.querySelector('[data-act="workdays-mode"][data-value="auto"]').click(); 1`);
await sleep(300);
st = await readState();
const autoDays = st.settings.workDaysPerMonth;
check('不固定天数按本月工作日', autoDays >= 20 && autoDays <= 23, String(autoDays));
check('不固定模式隐藏天数输入', (await evaluate(`!document.querySelector('[data-field="workDaysPerMonth"]')`)) === true);
check('时薪按不固定天数重算', (await evaluate(`document.getElementById('derived-hourly').textContent`)) === `¥${(16000 / autoDays / 8).toFixed(2)}`);
await evaluate(`document.querySelector('[data-act="workdays-mode"][data-value="custom"]').click(); 1`);
await sleep(300);
check('自定义模式显示天数输入', (await evaluate(`!!document.querySelector('[data-field="workDaysPerMonth"]')`)) === true);
await evaluate(`
  (() => {
    const el = document.querySelector('[data-field="workDaysPerMonth"]');
    el.value = '20';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 1;
  })()`);
await sleep(300);
check('自定义天数生效 ¥100.00', (await evaluate(`document.getElementById('derived-hourly').textContent`)) === '¥100.00');
await evaluate(`document.querySelector('[data-act="workdays-mode"][data-value="legal"]').click(); 1`);
await sleep(300);
st = await readState();
check('切回法定 21.75', st.settings.workDaysPerMonth === 21.75, String(st.settings.workDaysPerMonth));

await evaluate(`
  (() => {
    const el = document.querySelector('[data-field="monthlySalary"]');
    el.value = '20000';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 1;
  })()`);
await sleep(300);
check('改月薪后时薪实时重算 = ¥114.94', (await evaluate(`document.getElementById('derived-hourly').textContent`)) === '¥114.94', await evaluate(`document.getElementById('derived-hourly').textContent`));
st = await readState();
check('设置已持久化', st.settings.monthlySalary === 20000, String(st.settings.monthlySalary));

// 固定工时：上下班时间同步每日标准工时
await evaluate(`
  (() => {
    const start = document.querySelector('[data-field="workStart"]');
    start.value = '09:00';
    start.dispatchEvent(new Event('input', { bubbles: true }));
    start.dispatchEvent(new Event('change', { bubbles: true }));
    return 1;
  })()`);
await sleep(250);
await evaluate(`
  (() => {
    const end = document.querySelector('[data-field="workEnd"]');
    end.value = '18:00';
    end.dispatchEvent(new Event('input', { bubbles: true }));
    end.dispatchEvent(new Event('change', { bubbles: true }));
    return 1;
  })()`);
await sleep(350);
st = await readState();
check('固定工时同步每日工时 9 小时', st.settings.hoursPerDay === 9, String(st.settings.hoursPerDay));
check('时薪按 9 小时重算 ¥102.17', (await evaluate(`document.getElementById('derived-hourly').textContent`)) === '¥102.17');
await evaluate(`
  (() => {
    const end = document.querySelector('[data-field="workEnd"]');
    end.value = '17:00';
    end.dispatchEvent(new Event('input', { bubbles: true }));
    end.dispatchEvent(new Event('change', { bubbles: true }));
    return 1;
  })()`);
await sleep(350);
st = await readState();
check('还原每日工时 8 小时', st.settings.hoursPerDay === 8, String(st.settings.hoursPerDay));

// 8. 倍率模式 + 法定基准预设（今天若是周末则按周末倍率）
await evaluate(`document.querySelector('[data-act="ot-mode"][data-value="multiplier"]').click(); 1`);
await sleep(300);
await evaluate(`document.querySelector('[data-act="ot-preset"][data-normal="1.5"][data-weekend="2"]').click(); 1`);
await sleep(300);
st = await readState();
check('倍率预设写入 1.5 / 2', st.settings.otMultiplier === 1.5 && st.settings.otWeekendMultiplier === 2, JSON.stringify([st.settings.otMultiplier, st.settings.otWeekendMultiplier]));
const otRate = await evaluate(`document.getElementById('derived-ot').textContent`);
const expectedMult = (await evaluate(`[0, 6].includes(new Date().getDay()) ? 2 : 1.5`));
const baseNow = 20000 / 21.75 / 8;
const expectedOtRate = `¥${(baseNow * expectedMult).toFixed(2)}`;
check(`倍率模式加班时薪 = ${expectedMult} 倍（${expectedOtRate}）`, otRate === expectedOtRate, otRate);

// 9. 日历 / 节假日 / 排班 / 账号同步
await evaluate(`document.querySelector('[data-act="tab"][data-tab="settings"]').click(); 1`);
await sleep(300);
const todayKey = await evaluate(
  `(() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); })()`,
);

// 日历：收入视图
await evaluate(`document.querySelector('[data-act="calendar"]').click(); 1`);
await sleep(400);
const calCells = await evaluate(`document.querySelectorAll('.cal-grid .cal-cell:not(.blank)').length`);
check('日历打开并渲染当月', calCells >= 28, String(calCells));
const calPay = await evaluate(`document.querySelectorAll('.cal-pay:not(.none)').length`);
check('日历显示每日收入', calPay >= 1, String(calPay));
await evaluate(`document.querySelector('[data-act="cal-close"]').click(); 1`);
await sleep(250);

// 自动读取节假日（无原生日历时回退服务器）
await evaluate(`window.__salaryClockSyncHolidays(true); 1`);
await sleep(1200);
st = await readState();
check('自动读取节假日（服务器回退）', (st.settings.holidays || []).includes('2026-10-01'), JSON.stringify(st.settings.holidays));
check('记录节假日来源', st.settings.holidaySource === 'server', String(st.settings.holidaySource));

// 工时计算：班次类型 + 排班日历选择班次
await evaluate(`document.querySelector('[data-act="shift-mode"][data-value="on"]').click(); 1`);
await sleep(300);
check('默认班次类型 3 个', (await evaluate(`document.querySelectorAll('.shift-row').length`)) === 3);
await evaluate(`document.querySelector('[data-act="add-shift-type"]').click(); 1`);
await sleep(300);
check('添加班次类型', (await evaluate(`document.querySelectorAll('.shift-row').length`)) === 4);
await evaluate(`
  (() => {
    const inputs = [...document.querySelectorAll('.shift-row .shift-name')];
    const el = inputs[inputs.length - 1];
    el.value = '测试班';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 1;
  })()`);
await sleep(250);
st = await readState();
const lastType = st.settings.shiftTypes[st.settings.shiftTypes.length - 1];
check('修改班次名称', lastType.name === '测试班', lastType.name);

await evaluate(`document.querySelector('[data-act="calendar"]').click(); 1`);
await sleep(300);
await evaluate(`document.querySelector('[data-act="cal-mode"][data-value="edit"]').click(); 1`);
await sleep(300);
check(
  '打开排班日历',
  (await evaluate(`document.querySelectorAll('.cal-grid .cal-cell:not(.blank)').length`)) >= 28,
);
const workCells = await evaluate(`document.querySelectorAll('.cal-grid .cal-cell.work').length`);
check('上班日蓝色底', workCells >= 28, String(workCells));

await evaluate(`document.querySelector('[data-act="cal-day"][data-day="${todayKey}"]').click(); 1`);
await sleep(250);
check('点击日期弹出班次选择', (await evaluate(`!document.getElementById('cal-picker').hidden`)) === true);
const options = await evaluate(`[...document.querySelectorAll('#cal-options [data-act="cal-pick"]')].map((b) => b.textContent.trim())`);
check('班次选项含休息与自定义班次', options.includes('休息') && options.some((t) => t.includes('测试班')), JSON.stringify(options));
await evaluate(`[...document.querySelectorAll('#cal-options [data-act="cal-pick"]')].find((b) => b.textContent.includes('测试班')).click(); 1`);
await sleep(300);
st = await readState();
check('选择班次写入排班', !!st.settings.schedule?.[todayKey]?.shift, JSON.stringify(st.settings.schedule));
check('日历显示班次标记', (await evaluate(`document.querySelector('[data-act="cal-day"][data-day="${todayKey}"] .cal-tag')?.textContent || ''`)) === '测');

await evaluate(`document.querySelector('[data-act="cal-day"][data-day="${todayKey}"]').click(); 1`);
await sleep(250);
await evaluate(`[...document.querySelectorAll('#cal-options [data-act="cal-pick"]')].find((b) => b.textContent === '休息').click(); 1`);
await sleep(300);
st = await readState();
check('选择休息日', st.settings.schedule?.[todayKey]?.rest === true, JSON.stringify(st.settings.schedule));
check('休息日青色底（class=rest）', (await evaluate(`document.querySelector('[data-act="cal-day"][data-day="${todayKey}"]').classList.contains('rest')`)) === true);

await evaluate(`document.querySelector('[data-act="cal-day"][data-day="${todayKey}"]').click(); 1`);
await sleep(250);
await evaluate(`[...document.querySelectorAll('#cal-options [data-act="cal-pick"]')].find((b) => b.textContent === '年假').click(); 1`);
await sleep(300);
st = await readState();
check('请假写入排班', st.settings.schedule?.[todayKey]?.leave === '年假', JSON.stringify(st.settings.schedule));
check('请假显示黄色底（class=leave）', (await evaluate(`document.querySelector('[data-act="cal-day"][data-day="${todayKey}"]').classList.contains('leave')`)) === true);
check('请假标记「年」', (await evaluate(`document.querySelector('[data-act="cal-day"][data-day="${todayKey}"] .cal-tag')?.textContent || ''`)) === '年');

await evaluate(`document.querySelector('[data-act="cal-day"][data-day="${todayKey}"]').click(); 1`);
await sleep(250);
await evaluate(`[...document.querySelectorAll('#cal-options [data-act="cal-pick"]')].find((b) => b.textContent === '默认班次').click(); 1`);
await sleep(300);
st = await readState();
check('恢复默认班次', !st.settings.schedule?.[todayKey], JSON.stringify(st.settings.schedule));
check('恢复后蓝色底', (await evaluate(`document.querySelector('[data-act="cal-day"][data-day="${todayKey}"]').classList.contains('work')`)) === true);
await evaluate(`document.querySelector('[data-act="cal-close"]').click(); 1`);
await sleep(300);

// 账户同步（后端需运行在 8788）
await evaluate(`
  const api = document.querySelector('[data-field="apiBase"]');
  api.value = 'http://127.0.0.1:8788';
  api.dispatchEvent(new Event('input', { bubbles: true }));
  api.dispatchEvent(new Event('change', { bubbles: true }));
  1`);
await sleep(200);
await evaluate(`document.querySelector('[data-act="register"]').click(); 1`);
await sleep(300);
const uname = `e2e${Date.now().toString().slice(-6)}`;
await evaluate(`
  document.querySelector('#auth-user').value = '${uname}';
  document.querySelector('#auth-pass').value = 'pass123';
  document.querySelector('[data-auth="submit"]').click();
  1`);
await sleep(1800);
const authObj = await evaluate(`(() => { try { return JSON.parse(localStorage.getItem('salary-clock-auth-v1') || 'null'); } catch { return null; } })()`);
check('注册并登录成功', !!(authObj && authObj.token && authObj.username), JSON.stringify(authObj && { u: authObj.username }));
const token = authObj && authObj.token;
if (token) {
  const remote = await evaluate(
    `fetch('http://127.0.0.1:8788/api/sync', { headers: { authorization: 'Bearer ${token}' } }).then((r) => r.json()).then((j) => ({ hasData: !!j.data, days: Object.keys((j.data && j.data.days) || {}).length }))`,
  );
  check('登录后已推送记录到云端', remote.hasData === true && remote.days >= 1, JSON.stringify(remote));

  await evaluate(`document.getElementById('holiday-date').value = '2026-01-01'; document.querySelector('[data-act="add-holiday"]').click(); 1`);
  await sleep(3800);
  const remote2 = await evaluate(
    `fetch('http://127.0.0.1:8788/api/sync', { headers: { authorization: 'Bearer ${token}' } }).then((r) => r.json()).then((j) => (j.data && j.data.settings && j.data.settings.holidays) || [])`,
  );
  check('自动同步把节假日推送到云端', remote2.includes('2026-01-01'), JSON.stringify(remote2));

  await evaluate(`document.querySelector('[data-act="logout"]').click(); 1`);
  await sleep(300);
  await evaluate(`document.querySelector('[data-idx="0"]').click(); 1`);
  await sleep(300);
  const afterLogout = await evaluate(`localStorage.getItem('salary-clock-auth-v1')`);
  check('退出登录清除 token', !JSON.parse(afterLogout || '{}').token, afterLogout);
}

// 10. 清空数据（含确认弹层）
await evaluate(`document.querySelector('[data-act="wipe"]').click(); 1`);
await sleep(300);
await evaluate(`document.querySelector('[data-idx="0"]').click(); 1`);
await sleep(400);
const wiped = await readState();
check('清空后数据为空', Object.keys(wiped.days || {}).length === 0, JSON.stringify(wiped));

// 11. 自动打卡（模拟 Android WiFi 桥）
await evaluate(`(() => {
  const raw = JSON.parse(localStorage.getItem('salary-clock-v1') || '{}');
  raw.settings = Object.assign({}, raw.settings, {
    checkInMode: 'auto',
    autoWifi: true,
    autoGeofence: false,
    wifiSsid: 'Office-5G',
  });
  localStorage.setItem('salary-clock-v1', JSON.stringify(raw));
  return 1;
})()`);
await reload();
await evaluate(`window.SalaryClockNative = { getWifiSsid: () => 'Office-5G' }; window.__salaryClockAutoCheckIn(); 1`);
await sleep(600);
const promptTitle = await evaluate(`document.querySelector('.sheet h3')?.textContent || ''`);
check('WiFi 自动打卡先弹确认', promptTitle.includes('已连接指定 WiFi'), promptTitle);
await evaluate(`document.querySelector('[data-idx="0"]').click(); 1`);
await sleep(700);
st = await readState();
const autoSeg = Object.values(st.days || {}).flatMap((d) => d.segments || []).find((s) => s.auto);
check('确认后执行自动打卡', !!autoSeg, JSON.stringify(autoSeg || null));
check('自动打卡后进入正常计时', (await evaluate(`document.getElementById('hero-pill-label').textContent`)) === '正常工作');
await evaluate(`window.__salaryClockAutoCheckIn(); 1`);
await sleep(400);
check('同一天不再重复弹窗', !(await evaluate(`!!document.querySelector('.sheet h3')`)));

// 10. 无脚本异常
check('运行时无未捕获异常', exceptions.length === 0, exceptions.join(' | '));
check('无 console.error', consoleErrors.length === 0, consoleErrors.join(' | '));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
ws.close();
process.exit(failed.length ? 1 : 0);
