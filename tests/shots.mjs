/** 用 CDP 以 iPhone 尺寸 390x844@2x 截取交付图 */
import fs from 'node:fs';

const PORT = 9222;
const APP = 'http://127.0.0.1:8787/';
const OUT = 'E:/WorkSpace/salary-clock/docs/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

async function shot(name, url, action) {
  await send('Page.navigate', { url });
  await sleep(500);
  await evaluate(
    `new Promise((r) => { const t0 = Date.now(); const iv = setInterval(() => { if (document.querySelector('#live-int') || Date.now() - t0 > 6000) { clearInterval(iv); r(1); } }, 50); })`,
  );
  if (action) await evaluate(action);
  await sleep(700);
  const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(OUT + name, Buffer.from(data, 'base64'));
  console.log('saved', name, Buffer.from(data, 'base64').length, 'bytes');
}

await shot('home.png', `${APP}?demo=1`);
await shot('records.png', `${APP}?demo=1&tab=records`);
await shot('settings.png', `${APP}?tab=settings`);
await shot('settings-ot.png', `${APP}?tab=settings`, `
  document.querySelector('[data-act="ot-mode"][data-value="multiplier"]').click();
  setTimeout(() => {
    const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('加班计费'));
    if (card) card.scrollIntoView({ block: 'start' });
  }, 200);
  1`);
await shot('checkout.png', `${APP}?demo=1`, `document.querySelector('[data-act="clockout"]').click(); 1`);
await evaluate(`localStorage.clear(); 1`);
await shot('empty.png', `${APP}?tab=home`);

ws.close();
process.exit(0);
