#!/usr/bin/env python3
"""Generate web/icon-192.png / icon-512.png / icon-maskable-192.png /
icon-maskable-512.png from icon.svg's vector shapes.

Stage 1 (Brett 2026-09-22): Android's WebAPK mint refuses installs with
only an SVG icon - PNG 192 + 512 are the floor. Rasterizing a third-party
SVG lib was rejected (supply chain); instead this draws the SAME rounded
square, four panes and green status dot with Pillow primitives, measured
on a 1024-unit canvas then scaled - so the launcher icon matches the
in-app SVG mark (dark hull, four blue panes, one filled, green dot).

    python gen_icons.py      # needs Pillow; writes 4 PNGs here
"""
from __future__ import annotations

from PIL import Image, ImageDraw

SIZES = {"icon-{}.png": 0, "icon-maskable-{}.png": 1}
CANVAS = 1024  # master coordinates; scaled to 192/512
# Fractions of the master canvas (from icon.svg's 100-unit viewBox).
PANE_BOX = 0.20   # pane square size (26/100 of viewBox + margin fudge)
PANE_GAP = 0.14   # spacing between panes
CORNER = 0.16     # rounded-square radius fraction
BG = (14, 17, 22, 255)        # #0e1116
PANE = (77, 163, 255, 255)    # #4da3ff
DOT = (62, 207, 142, 255)     # #3ecf8e


def draw_mark(maskable: bool) -> Image.Image:
    img = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Maskable needs the mark inside the middle 80% (safe zone), so the
    # background square fills the WHOLE canvas and the mark shrinks.
    if maskable:
        d.rounded_rectangle((0, 0, CANVAS, CANVAS), radius=int(CORNER * CANVAS), fill=BG)
        inset = int(0.10 * CANVAS)
    else:
        d.rounded_rectangle((0, 0, CANVAS, CANVAS), radius=int(CORNER * CANVAS), fill=BG)
        inset = 0
    area = CANVAS - 2 * inset
    pane = int(area * 0.28)
    gap = int(area * 0.07)
    x0 = y0 = inset + (area - 2 * pane - gap) // 2
    radius = pane // 5
    stroke = max(3, pane // 8)
    for i, (x, y) in enumerate([(x0, y0), (x0 + pane + gap, y0),
                                (x0, y0 + pane + gap),
                                (x0 + pane + gap, y0 + pane + gap)]):
        if i == 3:  # bottom-right pane: filled (the active square)
            d.rounded_rectangle((x, y, x + pane, y + pane), radius=radius, fill=PANE)
        else:
            d.rounded_rectangle((x, y, x + pane, y + pane), radius=radius,
                                outline=PANE, width=stroke)
    # Status dot, centered in the filled pane's corner gap like the SVG.
    r = pane // 5
    cx = x0 + pane + gap + pane // 2
    cy = y0 + pane + gap + pane // 2
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=DOT)
    return img


def main() -> int:
    for name_fmt, maskable in SIZES.items():
        master = draw_mark(bool(maskable))
        for size in (192, 512):
            out = name_fmt.format(size)
            master.resize((size, size), Image.LANCZOS).save(out, "PNG")
            print(f"wrote {out} ({size}x{size})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
