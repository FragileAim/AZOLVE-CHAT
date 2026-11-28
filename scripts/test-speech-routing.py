"""Isolated test of the speech routing logic under three environments."""
from playwright.sync_api import sync_playwright

NATIVE = """
Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true });
Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: undefined, configurable: true });
window.__calls = [];
window.AzolveTts = {
  isReady: () => true, status: () => 'ready', error: () => '',
  hasLanguage: () => true, platform: () => 'android',
  stop: () => { window.__stopped = (window.__stopped||0)+1; },
  speak: (t, l, r, p, id) => {
    window.__calls.push({ t: String(t).slice(0,40), l, r, p, id });
    setTimeout(() => window.__azolveTtsDone && window.__azolveTtsDone(id, true), 60);
    return id;
  },
};
window.AzolvePush = { platform: () => 'android' };
"""

WEB = """
window.__spoken = [];
Object.defineProperty(window, 'SpeechSynthesisUtterance', {
  value: function(t){ this.text=t; }, configurable: true, writable: true });
Object.defineProperty(window, 'speechSynthesis', {
  configurable: true,
  value: {
    getVoices: () => [{ lang:'en-US', name:'Test EN' }],
    speak: (u) => { window.__spoken.push(u.text); setTimeout(()=>u.onend && u.onend(), 40); },
    cancel: () => {},
    addEventListener: () => {},
  },
});
"""

NONE = """
Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true });
Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: undefined, configurable: true });
"""


def run(b, name, script, text, lang):
    ctx = b.new_context()
    if script:
        ctx.add_init_script(script)
    p = ctx.new_page()
    errs = []
    p.on('pageerror', lambda e: errs.append(str(e)[:200]))
    p.goto('http://localhost:8471/index.html')
    p.wait_for_function('window.READY === true', timeout=8000)
    res = p.evaluate("""async ([text, lang]) => {
        const T = window.T;
        const supported = T.speechSupported();
        const native = T.nativeTtsAvailable();
        const r = await T.speak({ text, lang, id: 'test' });
        return {
            supported, native, result: r,
            nativeCalls: (window.__calls||[]).length,
            nativeText: (window.__calls||[])[0]?.t || null,
            webSpoken: (window.__spoken||[]).length,
        };
    }""", [text, lang])
    print(f'[{name}] {res}  errors={errs if errs else "none"}')
    ctx.close()


with sync_playwright() as pw:
    b = pw.chromium.launch()
    run(b, 'ANDROID SHELL (native bridge)', NATIVE, 'Hello from the native engine.', 'hi')
    run(b, 'BROWSER (web speech)', WEB, 'Hello from the web engine.', 'en')
    run(b, 'NO ENGINE', NONE, 'Hello nowhere.', 'en')
    b.close()
