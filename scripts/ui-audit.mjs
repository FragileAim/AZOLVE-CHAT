/* UI audit: screenshots every main surface at several widths in both themes and
   measures the things that actually make a UI feel broken — horizontal overflow,
   text that is unreadable against its own background, tap targets that are too
   small, and elements that stay dark while the rest of the page goes light.

   Run: node scripts/ui-audit.mjs            (uses TOKEN if provided)
        BASE=... TOKEN=... node scripts/ui-audit.mjs */
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import fs from 'node:fs';

const CHROME = '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome';
const PORT = 9341;
const OUT = '/workspace/.screenshots/audit';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-color-profile=srgb',
  '--user-data-dir=/tmp/cdp-audit', 'about:blank'], { stdio: 'ignore' });

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const p = (await r.json()).find(t => t.type === 'page');
      if (p) return p;
    } catch { }
    await sleep(250);
  }
  throw new Error('chrome did not start');
}
const page = await target();
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise(r => ws.on('open', r));
let id = 0; const waiting = new Map();
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id;
  waiting.set(mid, (m) => m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result));
  ws.send(JSON.stringify({ id: mid, method, params }));
});
await send('Page.enable'); await send('Runtime.enable');

const BASE = process.env.BASE || 'http://localhost:4500';
const TOKEN = process.env.TOKEN || '';
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) return { error: r.exceptionDetails.text };
  return r.result?.value;
};
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'));
};

/* Runs in the page. Reports the measurable defects for whatever is on screen. */
const PROBE = `(() => {
  const parse = (c) => {
    const m = String(c).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map(x => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
    return .2126 * f(r) + .7152 * f(g) + .0722 * f(b);
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05); };

  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      /* A gradient (or image) paints the real background but reports a
         transparent backgroundColor, so any contrast ratio measured against an
         ancestor further up would be fiction. Bail out instead. */
      if (getComputedStyle(n).backgroundImage !== 'none') return null;
      if (c && c.a > 0.55) return c;
      n = n.parentElement;
    }
    const b = parse(getComputedStyle(document.body).backgroundColor);
    return b && b.a > .5 ? b : { r: 255, g: 255, b: 255, a: 1 };
  };

  const lowContrast = [];
  const tiny = [];
  const darkInLight = [];
  const overflowers = [];
  const theme = document.documentElement.dataset.theme;
  const vw = innerWidth;

  const els = [...document.querySelectorAll('body *')];
  for (const el of els) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.bottom < -200 || r.top > innerHeight + 2000) continue;

    /* Only a real overflow if nothing between the element and the page clips or
       scrolls it. Decorative glows inside overflow:hidden heroes, and chips in a
       horizontal scroll rail, are intentional and must not be reported. */
    if (r.right > vw + 1.5 && cs.position !== 'fixed') {
      let clipped = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const o = getComputedStyle(a).overflowX;
        if (o === 'hidden' || o === 'auto' || o === 'scroll') { clipped = true; break; }
      }
      if (!clipped) overflowers.push({ sel: el.className?.toString?.().slice(0, 40) || el.tagName, right: Math.round(r.right) });
    }

    if (vw < 700) {
      const isBtn = el.matches('button, a, [role="button"], input[type="checkbox"], .seg button, .tab');
      if (isBtn && (r.height < 30 || r.width < 26)) {
        tiny.push({ text: (el.textContent || '').trim().slice(0, 22), w: Math.round(r.width), h: Math.round(r.height) });
      }
    }

    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (hasText) {
      const fg = parse(cs.color);
      if (fg && fg.a > .35) {
        const bg = bgOf(el);
        const cr = bg ? ratio(fg, bg) : null;
        if (cr !== null && cr < 3.0) {
          lowContrast.push({
            text: (el.textContent || '').trim().slice(0, 30),
            cls: el.className?.toString?.().slice(0, 34) || el.tagName,
            ratio: Math.round(cr * 100) / 100,
          });
        }
      }
    }

    if (theme === 'light') {
      const bg = parse(cs.backgroundColor);
      if (bg && bg.a > .6 && r.width > 60 && r.height > 26 && lum(bg) < 0.10) {
        darkInLight.push({ cls: el.className?.toString?.().slice(0, 40) || el.tagName, lum: Math.round(lum(bg) * 100) / 100, w: Math.round(r.width) });
      }
    }
  }

  const dedupe = (arr, key) => {
    const seen = new Set(); const out = [];
    for (const x of arr) { const k = key(x); if (!seen.has(k)) { seen.add(k); out.push(x); } }
    return out;
  };

  return {
    theme,
    vw,
    docW: document.documentElement.scrollWidth,
    hOverflow: document.documentElement.scrollWidth > vw + 1,
    lowContrast: dedupe(lowContrast, x => x.cls + x.text).slice(0, 12),
    tinyTargets: dedupe(tiny, x => x.text + x.w).slice(0, 10),
    darkInLight: dedupe(darkInLight, x => x.cls).slice(0, 10),
    overflowers: dedupe(overflowers, x => x.sel).slice(0, 8),
  };
})()`;

const SIZES = [
  { name: 'phone', w: 390, h: 844 },
  { name: 'phone-sm', w: 360, h: 780 },
  { name: 'tablet', w: 834, h: 1112 },
  { name: 'desktop', w: 1440, h: 900 },
];
const PAGES = TOKEN
  ? ['chats', 'people', 'moments', 'social', 'calls', 'ai', 'communities', 'profile', 'settings']
  : [''];

/* Establish the origin once, then drive the theme through localStorage + a real
   navigation. Page.addScriptToEvaluateOnNewDocument accumulates across
   navigations and silently let the first theme win for every later page, which
   made earlier runs report fiction. Writing localStorage on the live origin and
   doing a full load is deterministic. */
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: `${BASE}/?splash=0` });
await sleep(2000);

const report = {};
for (const theme of ['light', 'dark']) {
  for (const size of SIZES) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: size.w, height: size.h, deviceScaleFactor: 1, mobile: size.w < 700,
    });
    for (const pg of PAGES) {
      await evaluate(`try{
        localStorage.setItem('azolve.theme', ${JSON.stringify(theme)});
        ${TOKEN ? `localStorage.setItem('azolve.token', ${JSON.stringify(TOKEN)});` : ''}
        localStorage.setItem('azolve.splashDone', '1');
      }catch(e){}`);
      /* The cache-busting query forces a real document load. A hash-only change
         would keep the same document and React would never re-read the theme. */
      await send('Page.navigate', { url: `${BASE}/?splash=0&t=${theme}#/${pg}` });
      await sleep(pg ? 2600 : 2200);
      const key = `${theme}/${size.name}/${pg || 'auth'}`;
      await shot(key.replace(/\//g, '-'));
      report[key] = await evaluate(PROBE);
    }
  }
}

const summary = {};
for (const [k, v] of Object.entries(report)) {
  if (!v || v.error) { summary[k] = { error: v?.error }; continue; }
  const issues = {};
  if (v.hOverflow) issues.overflow = `${v.docW} > ${v.vw}`;
  if (v.overflowers?.length) issues.overflowers = v.overflowers;
  if (v.lowContrast?.length) issues.lowContrast = v.lowContrast;
  if (v.tinyTargets?.length) issues.tinyTargets = v.tinyTargets;
  if (v.darkInLight?.length) issues.darkInLight = v.darkInLight;
  if (Object.keys(issues).length) summary[k] = issues;
}
console.log(JSON.stringify(summary, null, 1));
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
process.exit(0);
