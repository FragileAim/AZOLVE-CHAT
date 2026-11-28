"""Smoke test: chat page loads, tap-to-hear does not throw, no page errors."""
import json, time
from playwright.sync_api import sync_playwright

T = json.load(open('/tmp/tok2.json'))
BASE = 'http://localhost:3000'
A = T['ada@azolve.io']

errs = []
with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2,
                        is_mobile=True, has_touch=True)
    ctx.add_init_script(f"localStorage.setItem('azolve.token', {json.dumps(A)})")
    p = ctx.new_page()
    p.on('pageerror', lambda e: errs.append(str(e)[:300]))
    p.goto(f'{BASE}/?r=smoke{int(time.time())}#/chats', wait_until='domcontentloaded')
    p.wait_for_timeout(3500)

    p.get_by_text('Grace Hopper', exact=False).first.evaluate('el=>el.click()')
    p.wait_for_timeout(2000)

    # find a "Hear in ..." control
    hear = None
    for sel in ['.ux-bubble button', '.ux-bubble .hear', 'button[title*="Hear"]']:
        for x in p.query_selector_all(sel):
            t = ((x.get_attribute('title') or '') + ' ' + (x.inner_text() or '')).lower()
            if 'hear' in t:
                hear = x
                break
        if hear:
            break
    print('hear control:', bool(hear), hear.get_attribute('title') if hear else None)
    if hear:
        hear.evaluate('el=>el.click()')
        p.wait_for_timeout(1500)

    # any toast?
    toast = p.query_selector('.toast, .ux-toast, [role="alert"]')
    print('toast:', (toast.inner_text()[:160] if toast else None))
    print('speechSupported (web):', p.evaluate("() => ('speechSynthesis' in window)"))
    print('voices:', p.evaluate("() => (window.speechSynthesis?.getVoices()||[]).length"))
    p.screenshot(path='/tmp/shots/smoke-hear.png')
    b.close()

print('PAGE ERRORS:', errs if errs else 'none')
