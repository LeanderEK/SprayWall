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


TOP = min(cy - r - STROKE / 2 for _, cy, r, _ in RINGS)
BOTTOM = max(cy + r + STROKE / 2 for _, cy, r, _ in RINGS)
LEFT = min(cx - r - STROKE / 2 for cx, _, r, _ in RINGS)
RIGHT = max(cx + r + STROKE / 2 for cx, _, r, _ in RINGS)


def draw(size: int, fill: float) -> Image.Image:
    """The icon at `size` pixels, with the rings scaled up so that their group is `fill` of the picture's height.

    The Android icon keeps its rings small because the launcher crops and zooms the picture. A home screen icon on iOS or
    in a browser is shown whole, so here the rings are made to fill the square. The maskable icon (Android) keeps more
    space around them, as it may be cut to a circle.
    """
    big = size * 4  # draw large and shrink, for smooth edges
    image = Image.new("RGB", (big, big), BACKGROUND)
    d = ImageDraw.Draw(image)
    grow = fill * 108.0 / (BOTTOM - TOP)  # how many times bigger than on the Android grid
    unit = big / 108.0
    middle = ((LEFT + RIGHT) / 2, (TOP + BOTTOM) / 2)

    def at(grid_x: float, grid_y: float) -> tuple[float, float]:  # a point of the Android grid, moved to the middle
        return ((grid_x - middle[0]) * grow + 54) * unit, ((grid_y - middle[1]) * grow + 54) * unit

    for cx, cy, r, colour in RINGS:
        x, y = at(cx, cy)
        outer = (r + STROKE / 2) * grow * unit
        inner = (r - STROKE / 2) * grow * unit
        d.ellipse([x - outer, y - outer, x + outer, y + outer], fill=colour)
        d.ellipse([x - inner, y - inner, x + inner, y + inner], fill=BACKGROUND)
    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    draw(512, 0.80).save(OUT / "icon-512.png", optimize=True)
    draw(192, 0.80).save(OUT / "icon-192.png", optimize=True)
    draw(180, 0.80).save(OUT / "apple-touch-icon.png", optimize=True)
    draw(512, 0.64).save(OUT / "icon-maskable-512.png", optimize=True)
    for path in sorted(OUT.glob("*.png")):
        print(path.name, path.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
