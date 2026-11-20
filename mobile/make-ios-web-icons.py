#!/usr/bin/env python3
"""Generate the iOS "Add to Home Screen" assets for the web app.

iOS ignores the web manifest's `icons` for the home-screen tile and uses
`apple-touch-icon` instead. It also wants a 180x180 PNG with **no** transparency
and no rounded corners (iOS applies its own mask), plus optional startup images
so the launch does not flash white.

Art is rendered from the same geometry as web/public/logo.svg so the installed
tile is identical to the Android launcher icon and the favicon.
"""
from PIL import Image, ImageDraw
import os

STOPS = [(0.0, (0x6D, 0x5E, 0xF8)), (0.55, (0x4F, 0x8C, 0xFF)), (1.0, (0x18, 0xE0, 0xC8))]
BG = (0x0A, 0x0A, 0x12)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient_at(t):
    t = max(0.0, min(1.0, t))
    for i in range(len(STOPS) - 1):
        t0, c0 = STOPS[i]
        t1, c1 = STOPS[i + 1]
        if t <= t1:
            span = t1 - t0
            return lerp(c0, c1, 0 if span == 0 else (t - t0) / span)
    return STOPS[-1][1]


def draw_mark(size, rounded=True, inset=0.0, background=None):
    """The AZOLVE mark: gradient tile + white 'A' + dot."""
    scale = 4
    S = size * scale
    img = Image.new('RGBA', (S, S), background + (255,) if background else (0, 0, 0, 0))

    grad = Image.new('RGBA', (S, S))
    px = grad.load()
    for y in range(S):
        for x in range(S):
            px[x, y] = gradient_at((x + y) / (2 * (S - 1))) + (255,)

    mask = Image.new('L', (S, S), 0)
    mdraw = ImageDraw.Draw(mask)
    pad = int(S * inset)
    radius = int(S * (18 / 64)) if rounded else 0
    mdraw.rounded_rectangle([pad, pad, S - 1 - pad, S - 1 - pad], radius=radius, fill=255)
    img.paste(grad, (0, 0), mask)

    draw = ImageDraw.Draw(img)
    k = S / 64.0
    draw.polygon([(32 * k, 14 * k), (46 * k, 46 * k), (38.5 * k, 46 * k),
                  (36 * k, 40 * k), (28 * k, 40 * k), (25.5 * k, 46 * k),
                  (18 * k, 46 * k)], fill=(255, 255, 255, 255))
    draw.polygon([(30.2 * k, 34 * k), (33.8 * k, 34 * k), (32 * k, 29.2 * k)],
                 fill=(0, 0, 0, 0))
    draw.ellipse([(47 - 5) * k, (18 - 5) * k, (47 + 5) * k, (18 + 5) * k], fill=(10, 10, 18, 46))
    draw.ellipse([(47 - 2.6) * k, (18 - 2.6) * k, (47 + 2.6) * k, (18 + 2.6) * k],
                 fill=(255, 255, 255, 255))
    return img.resize((size, size), Image.LANCZOS)


def icon(size):
    """apple-touch-icon: opaque, square, full-bleed. iOS rounds it itself."""
    return draw_mark(size, rounded=False, background=BG).convert('RGB')


def splash(w, h):
    """Launch image: brand mark centred on the app's dark background."""
    img = Image.new('RGB', (w, h), BG)
    mark_size = int(min(w, h) * 0.30)
    mark = draw_mark(mark_size, rounded=True)
    img.paste(mark, ((w - mark_size) // 2, (h - mark_size) // 2), mark)
    return img


# iPhone portrait sizes (pixels) that iOS asks for at launch.
SPLASHES = [
    (1290, 2796), (1179, 2556), (1284, 2778), (1170, 2532),
    (1125, 2436), (1242, 2688), (828, 1792), (750, 1334), (640, 1136),
]


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, '..', 'web', 'public', 'ios')
    os.makedirs(out, exist_ok=True)

    # iOS reads apple-touch-icon at 180x180; ship 152/167 for iPad too.
    for s in (180, 167, 152, 120):
        icon(s).save(os.path.join(out, f'apple-touch-icon-{s}.png'))
        print(f'  apple-touch-icon-{s}.png')

    for w, h in SPLASHES:
        splash(w, h).save(os.path.join(out, f'splash-{w}x{h}.png'))
        print(f'  splash-{w}x{h}.png')

    # PWA manifest icons (Android/Chrome + desktop install)
    for s in (192, 512):
        icon(s).save(os.path.join(out, f'icon-{s}.png'))
        print(f'  icon-{s}.png')


if __name__ == '__main__':
    main()
