#!/usr/bin/env python3
"""Render the AZOLVE launcher icon from the same geometry as web/public/logo.svg.

The SVG is a 64x64 rounded square with a diagonal gradient (#6D5EF8 -> #4F8CFF ->
#18E0C8), a white 'A' glyph, and a small white dot in the top-right. Rendering it
here keeps the Android icon identical to the web favicon without needing a
browser or an SVG rasteriser in the build image.
"""
from PIL import Image, ImageDraw
import os

SIZES = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192,
}

STOPS = [(0.0, (0x6D, 0x5E, 0xF8)), (0.55, (0x4F, 0x8C, 0xFF)), (1.0, (0x18, 0xE0, 0xC8))]


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


def render(size, rounded=True, inset=0.0):
    """Draw at 4x then downsample so the edges stay clean at small sizes."""
    scale = 4
    S = size * scale
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))

    # diagonal gradient, x+y across the square
    grad = Image.new('RGBA', (S, S))
    px = grad.load()
    for y in range(S):
        for x in range(S):
            px[x, y] = gradient_at((x + y) / (2 * (S - 1))) + (255,)

    # rounded-square mask (18/64 radius, matching the SVG's rx)
    mask = Image.new('L', (S, S), 0)
    mdraw = ImageDraw.Draw(mask)
    pad = int(S * inset)
    radius = int(S * (18 / 64)) if rounded else 0
    mdraw.rounded_rectangle([pad, pad, S - 1 - pad, S - 1 - pad], radius=radius, fill=255)
    img.paste(grad, (0, 0), mask)

    draw = ImageDraw.Draw(img)
    # white 'A' — same triangle and counter as the SVG path, scaled to S/64
    k = S / 64.0
    draw.polygon([(32 * k, 14 * k), (46 * k, 46 * k), (38.5 * k, 46 * k),
                  (36 * k, 40 * k), (28 * k, 40 * k), (25.5 * k, 46 * k),
                  (18 * k, 46 * k)], fill=(255, 255, 255, 255))
    draw.polygon([(30.2 * k, 34 * k), (33.8 * k, 34 * k), (32 * k, 29.2 * k)],
                 fill=(0, 0, 0, 0))
    # the small dot
    draw.ellipse([(47 - 5) * k, (18 - 5) * k, (47 + 5) * k, (18 + 5) * k], fill=(10, 10, 18, 46))
    draw.ellipse([(47 - 2.6) * k, (18 - 2.6) * k, (47 + 2.6) * k, (18 + 2.6) * k],
                 fill=(255, 255, 255, 255))

    return img.resize((size, size), Image.LANCZOS)


def main():
    base = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'android', 'app', 'src', 'main', 'res')
    for folder, size in SIZES.items():
        out = os.path.join(base, folder)
        os.makedirs(out, exist_ok=True)
        render(size).save(os.path.join(out, 'ic_launcher.png'))
        # round icon: same art, fully circular mask
        sq = render(size, rounded=False)
        circle = Image.new('L', (size, size), 0)
        ImageDraw.Draw(circle).ellipse([0, 0, size - 1, size - 1], fill=255)
        round_img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        round_img.paste(sq, (0, 0), circle)
        round_img.save(os.path.join(out, 'ic_launcher_round.png'))
        # adaptive-icon foreground needs the art inset inside a 108dp canvas
        fg = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        inner = render(int(size * 0.72), rounded=True)
        off = (size - inner.size[0]) // 2
        fg.paste(inner, (off, off), inner)
        fg.save(os.path.join(out, 'ic_launcher_foreground.png'))
        print(f'  {folder}: {size}px')


if __name__ == '__main__':
    main()
