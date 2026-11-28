"""Two-user call test: ring, then ACCEPT, for both video and voice.

The report is "when it's picked it goes blank", so this test does not stop at
the ring screen — it taps Accept and inspects what the callee actually renders.
"""
import json, sys, time
from playwright.sync_api import sync_playwright

T = json.load(open('/tmp/tok2.json'))
BASE = 'http://localhost:3000'
A = T['ada@azolve.io']
B = T['grace@azolve.io']

CALLTYPE = sys.argv[1] if len(sys.argv) > 1 else 'video'
TAG = f'{CALLTYPE}'
SHOTS = '/tmp/shots'


def mk(b, tok, name):
    ctx = b.new_context(
        viewport={'width': 390, 'height': 844}, device_scale_factor=2,
        is_mobile=True, has_touch=True,
        permissions=['microphone', 'camera'],
    )
    ctx.add_init_script(f"localStorage.setItem('azolve.token', {json.dumps(tok)})")
    p = ctx.new_page()
    p.on('pageerror', lambda e: print(f'[{name}] PAGEERROR', str(e)[:400]))
    p.on('console', lambda m: print(f'[{name}] CONSOLE-ERR', m.text[:250]) if m.type == 'error' else None)
    p.goto(f'{BASE}/?r={name}{int(time.time())}#/chats', wait_until='domcontentloaded')
    p.wait_for_timeout(3400)
    return ctx, p


def stage_state(p):
    """Describe what the call layer is currently showing."""
    return p.evaluate("""() => {
        const root = document.querySelector('.ux-call, .ux-call-incoming, .ux-call-ended');
        if (!root) return { present: false };
        const q = s => root.querySelector(s);
        const txt = el => el ? (el.innerText || '').trim().slice(0, 80) : null;
        return {
            present: true,
            cls: root.className,
            phase: txt(q('.ux-call-phase')),
            head: txt(q('.ux-call-id')),
            videoEl: !!q('video'),
            audioEl: !!q('audio'),
            remoteAudioSrc: (() => { const a = q('audio'); return a && a.srcObject ? 'stream' : (a ? 'none' : null); })(),
            remoteVideoSrc: (() => { const v = q('video'); return v && v.srcObject ? 'stream' : (v ? 'none' : null); })(),
            bodyLen: document.body.innerText.trim().length,
            liveBadge: txt(q('.ux-call-live')),
        };
    }""")


with sync_playwright() as pw:
    b = pw.chromium.launch(args=[
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
    ])
    ca, pa = mk(b, A, f'caller-{TAG}')
    cb, pb = mk(b, B, f'callee-{TAG}')

    # caller opens the DM with Grace
    pa.get_by_text('Grace Hopper', exact=False).first.evaluate('el=>el.click()')
    pa.wait_for_timeout(1800)

    # click the right header call button
    want = 'Video call' if CALLTYPE == 'video' else 'Voice call'
    btn = None
    for x in pa.query_selector_all('.ux-cv-head button'):
        if (x.get_attribute('title') or '') == want:
            btn = x
            break
    print(f'[{TAG}] header button found:', bool(btn))
    btn.evaluate('el=>el.click()')
    pa.wait_for_timeout(2600)

    print(f'[{TAG}] CALLER after dial:', json.dumps(stage_state(pa)))
    pa.screenshot(path=f'{SHOTS}/{TAG}-1-caller-ringing.png')

    print(f'[{TAG}] CALLEE at ring:', json.dumps(stage_state(pb)))
    pb.screenshot(path=f'{SHOTS}/{TAG}-2-callee-ringing.png')

    # ---- the important bit: ACCEPT ----
    acc = pb.query_selector('.ux-call-big.accept')
    print(f'[{TAG}] accept button present:', bool(acc))
    if acc:
        acc.evaluate('el=>el.click()')
    pb.wait_for_timeout(1200)
    print(f'[{TAG}] CALLEE +1.2s after accept:', json.dumps(stage_state(pb)))
    pb.screenshot(path=f'{SHOTS}/{TAG}-3-callee-accepting.png')

    pb.wait_for_timeout(3000)
    print(f'[{TAG}] CALLEE +4.2s after accept:', json.dumps(stage_state(pb)))
    pb.screenshot(path=f'{SHOTS}/{TAG}-4-callee-active.png')

    print(f'[{TAG}] CALLER +4.2s after accept:', json.dumps(stage_state(pa)))
    pa.screenshot(path=f'{SHOTS}/{TAG}-5-caller-active.png')

    pb.wait_for_timeout(3000)
    print(f'[{TAG}] CALLEE +7s:', json.dumps(stage_state(pb)))
    print(f'[{TAG}] CALLER +7s:', json.dumps(stage_state(pa)))
    pb.screenshot(path=f'{SHOTS}/{TAG}-6-callee-final.png')

    b.close()
