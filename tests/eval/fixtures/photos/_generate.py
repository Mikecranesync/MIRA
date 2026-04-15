#!/usr/bin/env python3
"""Generate synthetic nameplate fixture images using Pillow.

Run once to create the .jpg files that photo eval fixtures reference.
Safe to re-run — regenerates all images from scratch.

    python3 tests/eval/fixtures/photos/_generate.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("Pillow is required: pip install Pillow")

_OUT = Path(__file__).parent
_W, _H = 640, 480


def _make_nameplate(
    path: Path,
    lines: list[str],
    bg_color: tuple[int, int, int] = (210, 210, 210),
    text_color: tuple[int, int, int] = (20, 20, 20),
    label_color: tuple[int, int, int] = (0, 60, 120),
    border_color: tuple[int, int, int] = (80, 80, 80),
) -> None:
    """Draw a realistic equipment nameplate as a JPEG."""
    img = Image.new("RGB", (_W, _H), bg_color)
    draw = ImageDraw.Draw(img)

    # Outer border
    draw.rectangle([8, 8, _W - 8, _H - 8], outline=border_color, width=4)
    # Inner label area
    draw.rectangle([20, 20, _W - 20, _H - 20], outline=border_color, width=2)

    # Try to load a monospace font; fall back to default
    font_large = font_medium = font_small = None
    for font_path in [
        "/System/Library/Fonts/Courier.dfont",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
    ]:
        if os.path.exists(font_path):
            try:
                font_large = ImageFont.truetype(font_path, 36)
                font_medium = ImageFont.truetype(font_path, 24)
                font_small = ImageFont.truetype(font_path, 18)
                break
            except Exception:
                continue

    if font_large is None:
        font_large = font_medium = font_small = ImageFont.load_default()

    # Draw lines with alternating colours
    y = 45
    for i, line in enumerate(lines):
        color = label_color if i == 0 else text_color
        font = font_large if i == 0 else (font_medium if i < 3 else font_small)
        draw.text((40, y), line, fill=color, font=font)
        y += 55 if i == 0 else 45

    # Scratch / weathering effect (horizontal lines)
    for yy in range(30, _H - 30, 18):
        if yy % 54 == 0:
            draw.line([(22, yy), (_W - 22, yy)], fill=(190, 190, 190), width=1)

    img.save(str(path), "JPEG", quality=88)
    print(f"  wrote {path.name}  ({_W}x{_H})")


def main() -> None:
    print(f"Generating fixture images in {_OUT}/")

    # 1. Pilz PNOZ X3 — safety relay
    _make_nameplate(
        _OUT / "pilz_pnoz_x3.jpg",
        [
            "PILZ",
            "PNOZ X3",
            "Safety Relay",
            "Ub: 24VDC  Max current: 3A",
            "Cat.3  EN 954-1",
            "S/N: PX3-00214",
        ],
        bg_color=(220, 220, 215),
        label_color=(180, 0, 0),  # Pilz red
    )

    # 2. AutomationDirect GS20 — VFD
    _make_nameplate(
        _OUT / "automation_direct_gs20.jpg",
        [
            "AutomationDirect",
            "GS20-23P0",
            "AC Variable Frequency Drive",
            "Input:  3Ph 230VAC  3HP  11.2A",
            "Output: 3Ph 0-230V  60Hz  9.6A",
            "S/N: GS20-US-0031482",
        ],
        bg_color=(215, 225, 235),
        label_color=(0, 80, 160),  # AD blue
    )

    # 3. Yaskawa GA500 — VFD
    _make_nameplate(
        _OUT / "yaskawa_ga500.jpg",
        [
            "YASKAWA",
            "GA500",
            "AC Drive / Inverter",
            "Input:  3Ph 480VAC  5HP  7.6A",
            "Output: 3Ph 0-480V  60Hz  6.9A",
            "Model: CIMR-GU4A0009FAA",
        ],
        bg_color=(230, 230, 225),
        label_color=(0, 60, 100),  # Yaskawa navy
    )

    # 4. Generic distribution block — no vendor, no model
    _make_nameplate(
        _OUT / "distribution_block.jpg",
        [
            "TERMINAL BLOCK ASSEMBLY",
            "Panel: MCC-3  Row: B",
            "Rating: 600VAC  100A",
            "Fused: 30A per branch",
            "",
            "Installer: J.Torres  2024-03",
        ],
        bg_color=(200, 205, 200),
        label_color=(40, 40, 40),
        border_color=(100, 100, 100),
    )

    print("Done.")


if __name__ == "__main__":
    main()
