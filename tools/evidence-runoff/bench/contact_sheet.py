"""Low-res contact sheet of a manual's next N candidate pages, for the table/no-table screen."""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

DATA = Path("/Users/charlienode/MIRA/.planning/evidence-runoff-data/bench")


def main(manual: str, start: int, n: int) -> None:
    c = next(x for x in json.loads((DATA / "candidates.json").read_text()) if x["manual"] == manual)
    pages = c["candidates"][start : start + n]
    tiles = []
    with tempfile.TemporaryDirectory() as td:
        for p in pages:
            out = Path(td) / f"p{p}"
            subprocess.run(
                [
                    "pdftoppm",
                    "-q",
                    "-r",
                    "36",
                    "-f",
                    str(p),
                    "-l",
                    str(p),
                    "-png",
                    "-singlefile",
                    c["pdf"],
                    str(out),
                ],
                check=True,
            )
            im = Image.open(f"{out}.png").convert("RGB")
            d = ImageDraw.Draw(im)
            d.rectangle([0, 0, 60, 16], fill="yellow")
            d.text((3, 2), f"p{p}", fill="black")
            tiles.append(im)
    w = max(t.width for t in tiles)
    h = max(t.height for t in tiles)
    cols = 5
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * w, rows * h), "white")
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * w, (i // cols) * h))
    dst = DATA / "sheets" / f"{manual}_{start}.png"
    sheet.save(dst)
    print(dst, pages)


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]))
