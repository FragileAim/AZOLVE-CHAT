"""Prove tap-to-hear works inside the Android shell.

Simulates the real WebView condition: speechSynthesis is absent, and the native
AzolveTts bridge is injected. Before the fix this combination produced
"This browser has no speech engine. Try Chrome, Edge, Safari or Firefox."
"""
import json, time
from playwright.sync_api import sync_playwright

T = json.load(open('/tmp/tok2.json'))
BASE = 'http://localhost:3000'
A = T['ada@azolve.io']

MOCK = """
// --- pretend to be the Android shell ---
Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true });
Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: undefined, configurable: true });
window.__ttsCalls = [];
window.AzolveTts = {
  isReady: () => true,
  status: () => 'ready',
  error: () => '',
  hasLanguage: () => true,
  platform: () => 'android',
  stop: () => { window.__ttsStopped = (window.__ttsStopped||0)+1; },
  speak: (text, lang, rate, pitch, id) => {
    window.__ttsCalls.push({ text: String(text).slice(0,60), lang, rate, pitch, id });
    setTimeout(() => { if (window.__azolveTtsDone) window.__azolveTtsDone(id, true); }, 120);
    return id;
  },
};
window.AzolvePush = { getToken: () => Promise.resolve(''), platform: () => 'android' };
"""

errs = []
with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2,
                        is_mobile=True, has_touch=True)
    ctx.add_init_script(f"localStorage.setItem('azolve.token', {json.dumps(A)})")
    ctx.add_init_script(MOCK)
    p = ctx.new_page()
    p.on('pageerror', lambda e: errs.append(str(e)[:300]))
    p.goto(f'{BASE}/?r=shell{int(time.time())}#/chats', wait_until='domcontentloaded')
    p.wait_for_timeout(3800)

    print('shell detected:', p.evaluate("() => !!window.AzolvePush"))
    print('speechSynthesis present:', p.evaluate("() => 'speechSynthesis' in window && !!window.speechSynthesis"))

    p.get_by_text('Grace Hopper', exact=False).first.evaluate('el=>el.click()')
    p.wait_for_timeout(2200)

    allh = p.query_selector_all('[class*="hear"]')
    print('hear-ish elements:', [(x.get_attribute('class'), (x.inner_text() or '')[:30]) for x in allh][:6])
    btn = p.query_selector('.hear-inline') or p.query_selector('.hear-chip') or p.query_selector('.hear-icon')
    if btn:
        btn.evaluate('el=>el.click()')
        p.wait_for_timeout(1400)

    calls = p.evaluate("() => window.__ttsCalls || []")
    print('native speak calls:', len(calls), calls[:2])

    toast = p.query_selector('.toast, .ux-toast, [role="alert"]')
    print('toast:', (toast.inner_text()[:180] if toast else None))
    p.screenshot(path='/tmp/shots/shell-hear.png')
    b.close()

print('PAGE ERRORS:', errs if errs else 'none')
