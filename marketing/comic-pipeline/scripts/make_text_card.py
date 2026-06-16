#!/usr/bin/env python3
"""
Generate 1920x1080 text cards for promo videos under the playbook's
"single declarative statement" rule. Used for Pain and CTA frames where
no real screenshot fits.

Usage:
    python make_text_card.py <output.png> "<line 1>" ["<line 2>" "<line 3>"]
    python make_text_card.py --bg "#0a0e1a" --color "#ffffff" --pt 96 out.png "line"
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WIDTH = 1920
HEIGHT = 1080
DEFAULT_BG = "#0a0e1a"
DEFAULT_COLOR = "#ffffff"
DEFAULT_PT = 88
LINE_SPACING = 1.35

FONT_CANDIDATES = [
    "C:/Windows/Fonts/segoeuib.ttf",   # Segoe UI Bold
    "C:/Windows/Fonts/arialbd.ttf",    # Arial Bold
    "/System/Library/Fonts/SFNSDisplay.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def load_font(pt: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, pt)
    return ImageFont.load_default()


def render(lines: list[str], output: Path, bg: str, color: str, pt: int) -> None:
    img = Image.new("RGB", (WIDTH, HEIGHT), bg)
    draw = ImageDraw.Draw(img)
    font = load_font(pt)

    line_height = int(pt * LINE_SPACING)
    total_h = line_height * len(lines)
    y = (HEIGHT - total_h) // 2 + (line_height - pt) // 2

    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        w = bbox[2] - bbox[0]
        x = (WIDTH - w) // 2
        draw.text((x, y), line, fill=color, font=font)
        y += line_height

    output.parent.mkdir(parents=True, exist_ok=True)
    img.save(output, format="PNG")
    print(f"[OK] {output} ({len(lines)} lines, {pt}pt)")


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate a 1920x1080 text card")
    ap.add_argument("output", help="Output PNG path")
    ap.add_argument("lines", nargs="+", help="Lines of text (one per frame)")
    ap.add_argument("--bg", default=DEFAULT_BG, help=f"Background hex (default {DEFAULT_BG})")
    ap.add_argument("--color", default=DEFAULT_COLOR, help=f"Text color hex (default {DEFAULT_COLOR})")
    ap.add_argument("--pt", type=int, default=DEFAULT_PT, help=f"Font size in points (default {DEFAULT_PT})")
    args = ap.parse_args()

    render(args.lines, Path(args.output), args.bg, args.color, args.pt)
    return 0


if __name__ == "__main__":
    sys.exit(main())
