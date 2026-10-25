"""Draws the app icons (the same four hold rings as the Android app) into site/icons.

    SprayWall\\tools\\.venv\\Scripts\\python.exe tools\\make_icons.py        (any Python with Pillow works)

The art is on a 108 x 108 grid, the same numbers as the Android icon: start (green), hand (blue), finish (purple) and
foot (orange, the smallest) rings on a dark square. The phone rounds the corners itself, so the pictures are full square.
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "site" / "icons"
BACKGROUND = (0x14, 0x16, 0x1A)
STROKE = 4.0
RINGS = [  # centre x, centre y, radius, colour (on the 108 grid)
    (42.75, 40.0, 9.0, (0x2B, 0xD8, 0x4B)),
    (63.0, 48.0, 9.0, (0x29, 0xB6, 0xF6)),
    (65.25, 32.0, 7.0, (0xE0, 0x40, 0xFB)),
    (47.25, 74.0, 5.5, (0xFF, 0xA7, 0x26)),
]


def draw(size: int, scale: float = 1.0) -> Image.Image:
    """The icon at `size` pixels. scale < 1 shrinks the art towards the middle (for the maskable icon's safe zone)."""
    big = size * 4  # draw large and shrink, for smooth edges
    image = Image.new("RGB", (big, big), BACKGROUND)
    d = ImageDraw.Draw(image)
    unit = big / 108.0 * scale
    shift = big * (1 - scale) / 2
    for cx, cy, r, colour in RINGS:
        x, y = cx * unit + shift, cy * unit + shift
        outer = (r + STROKE / 2) * unit
        inner = (r - STROKE / 2) * unit
        d.ellipse([x - outer, y - outer, x + outer, y + outer], fill=colour)
        d.ellipse([x - inner, y - inner, x + inner, y + inner], fill=BACKGROUND)
    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    draw(512).save(OUT / "icon-512.png", optimize=True)
    draw(192).save(OUT / "icon-192.png", optimize=True)
    draw(180).save(OUT / "apple-touch-icon.png", optimize=True)
    draw(512, scale=0.92).save(OUT / "icon-maskable-512.png", optimize=True)
    for path in sorted(OUT.glob("*.png")):
        print(path.name, path.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
