"""Redaction helper for the MIRA Print Pack.

Two independent redaction axes:
  1. Photo blur — driven by each intake-manifest evidence item's own
     `redact: true` flag. Applied whenever an item declares it, regardless of
     the build's --redact CLI flag (a photographic-content decision made once
     at intake time).
  2. Customer-identity blanking — driven by the build's --redact CLI flag
     (a build-invocation decision: publish an example vs. deliver to the
     actual customer named in the manifest).

Deterministic: Pillow's GaussianBlur + fixed-quality JPEG encode produce the
same bytes for the same input, every time, on the same machine/library
version. No EXIF/ICC is carried into the redacted copy.
"""

from __future__ import annotations

import copy
from pathlib import Path


def redact_image(src: Path, dst: Path, blur_radius: int = 22) -> None:
    from PIL import Image, ImageFilter

    with Image.open(src) as im:
        rgb = im.convert("RGB")
        blurred = rgb.filter(ImageFilter.GaussianBlur(radius=blur_radius))
    dst.parent.mkdir(parents=True, exist_ok=True)
    # Explicit save args only -- no exif=/icc_profile=, so no source metadata
    # (which could carry a capture timestamp) survives into the redacted copy.
    blurred.save(dst, format="JPEG", quality=85)


def copy_image_unredacted(src: Path, dst: Path) -> None:
    from PIL import Image

    with Image.open(src) as im:
        rgb = im.convert("RGB")
    dst.parent.mkdir(parents=True, exist_ok=True)
    rgb.save(dst, format="JPEG", quality=92)


def process_evidence_photos(
    evidence_items: list[dict], package_dir: Path, out_photos_dir: Path
) -> dict:
    """For every kind=='photo' evidence item, produce a copy (redacted per the
    item's own `redact` flag) in out_photos_dir, keyed by basename so citation
    text ("photo review/photos/wire_2.jpg") can look it up by basename alone.
    Returns {basename: item} for the items actually processed."""
    processed = {}
    for item in evidence_items:
        if item.get("kind") != "photo":
            continue
        src = (
            package_dir / item["path"]
            if not Path(item["path"]).is_absolute()
            else Path(item["path"])
        )
        # intake paths may already be package-relative (typical) or repo-relative;
        # try package_dir first, then treat as already-resolved.
        if not src.exists():
            src = Path(item["path"])
        if not src.exists():
            continue
        basename = Path(item["path"]).name
        dst = out_photos_dir / basename
        if item.get("redact", False):
            redact_image(src, dst)
        else:
            copy_image_unredacted(src, dst)
        processed[basename] = item
    return processed


def redact_manifest_customer_fields(manifest: dict) -> dict:
    """Blank customer.name/site (SPEC.md redaction rule). Returns a deep copy —
    never mutates the caller's manifest."""
    out = copy.deepcopy(manifest)
    customer = out.get("customer")
    if isinstance(customer, dict):
        customer["name"] = ""
        customer["site"] = ""
    return out


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Redact a single photo (standalone utility).")
    ap.add_argument("src", type=Path)
    ap.add_argument("dst", type=Path)
    ap.add_argument("--blur-radius", type=int, default=22)
    args = ap.parse_args()
    redact_image(args.src, args.dst, blur_radius=args.blur_radius)
    print(f"wrote {args.dst}")
