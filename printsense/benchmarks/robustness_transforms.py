"""Phase-4 deterministic image transforms — technician photography, simulated.

Every transform is a pure function ``png_bytes -> image_bytes`` built from
FIXED constants (no randomness — reruns are byte-identical), so a robustness
regression names the exact transformation that caused it. Two families, kept
separate because the goal doc grades them separately:

* ROTATION_TRANSFORMS — orientation only (meaning-invariant by definition).
* QUALITY_TRANSFORMS  — degradation (may honestly lose facts, never invent).

``crop_partial`` deliberately removes the right-hand reference region of the
Phase-2/3 pages (where the off-page xref token sits) so the metamorphic
"removed facts become unresolved" rule is exercised for real.
"""

from __future__ import annotations

import io

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter


def _open(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data)).convert("RGB")


def _png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def rot90(data: bytes) -> bytes:
    return _png(_open(data).transpose(Image.Transpose.ROTATE_90))


def rot180(data: bytes) -> bytes:
    return _png(_open(data).transpose(Image.Transpose.ROTATE_180))


def rot270(data: bytes) -> bytes:
    return _png(_open(data).transpose(Image.Transpose.ROTATE_270))


def skew_slight(data: bytes) -> bytes:
    img = _open(data)
    w, h = img.size
    return _png(
        img.transform(
            (w, h),
            Image.Transform.AFFINE,
            (1.0, 0.08, -0.04 * h, 0.0, 1.0, 0.0),
            resample=Image.Resampling.BILINEAR,
            fillcolor=(210, 210, 210),
        )
    )


def perspective(data: bytes) -> bytes:
    img = _open(data)
    w, h = img.size
    # Fixed quad: top edge pinched inward like a hand-held angled shot.
    return _png(
        img.transform(
            (w, h),
            Image.Transform.QUAD,
            (int(w * 0.06), int(h * 0.04), 0, h, w, h, int(w * 0.94), int(h * 0.02)),
            resample=Image.Resampling.BILINEAR,
            fillcolor=(210, 210, 210),
        )
    )


def blur(data: bytes) -> bytes:
    return _png(_open(data).filter(ImageFilter.GaussianBlur(radius=2.2)))


def glare(data: bytes) -> bytes:
    img = _open(data)
    w, h = img.size
    overlay = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(overlay)
    cx, cy, r = int(w * 0.68), int(h * 0.30), int(min(w, h) * 0.38)
    for i in range(r, 0, -6):  # fixed radial falloff
        d.ellipse([cx - i, cy - i, cx + i, cy + i], fill=int(235 * (1 - i / r)))
    white = Image.new("RGB", (w, h), (255, 255, 255))
    return _png(Image.composite(white, img, overlay))


def shadow(data: bytes) -> bytes:
    img = _open(data)
    w, h = img.size
    shade = Image.new("L", (w, h), 255)
    d = ImageDraw.Draw(shade)
    for x in range(0, int(w * 0.45), 4):  # fixed left-side shadow band
        d.rectangle([x, 0, x + 4, h], fill=int(120 + 135 * (x / (w * 0.45))))
    dark = Image.new("RGB", (w, h), (0, 0, 0))
    return _png(Image.composite(img, dark, shade))


def uneven_light(data: bytes) -> bytes:
    img = _open(data)
    w, h = img.size
    grad = Image.new("L", (w, h), 255)
    d = ImageDraw.Draw(grad)
    for y in range(0, h, 4):  # fixed vertical falloff
        d.rectangle([0, y, w, y + 4], fill=int(255 - 90 * (y / h)))
    dark = Image.new("RGB", (w, h), (30, 30, 30))
    return _png(Image.composite(img, dark, grad))


def lowres(data: bytes) -> bytes:
    img = _open(data)
    w, h = img.size
    small = img.resize((max(1, w // 4), max(1, h // 4)), Image.Resampling.BILINEAR)
    return _png(small.resize((w, h), Image.Resampling.NEAREST))


def jpeg_q20(data: bytes) -> bytes:
    img = _open(data)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=20)
    return buf.getvalue()


def phone_screen(data: bytes) -> bytes:
    """A photo OF a screen showing the print: dark bezel + scanline grid + dim."""
    img = _open(data)
    w, h = img.size
    dim = ImageEnhance.Brightness(img).enhance(0.82)
    d = ImageDraw.Draw(dim)
    for y in range(0, h, 7):  # fixed scanline pattern
        d.line([(0, y), (w, y)], fill=(70, 70, 78), width=1)
    frame = Image.new("RGB", (w + 120, h + 120), (18, 18, 22))
    frame.paste(dim, (60, 60))
    return _png(frame)


def crop_partial(data: bytes) -> bytes:
    """Remove the right 40% — on the corpus pages this cuts off the off-page
    reference region, so those facts must become unresolved, never guessed."""
    img = _open(data)
    w, h = img.size
    return _png(img.crop((0, 0, int(w * 0.60), h)))


def obstructed(data: bytes) -> bytes:
    """A folded corner / hand covering the lower-middle token region."""
    img = _open(data)
    w, h = img.size
    d = ImageDraw.Draw(img)
    d.polygon(
        [(int(w * 0.28), h), (int(w * 0.62), int(h * 0.55)), (int(w * 0.78), h)],
        fill=(148, 118, 96),
    )
    return _png(img)


def handwritten(data: bytes) -> bytes:
    img = _open(data)
    w, h = img.size
    d = ImageDraw.Draw(img)
    pts = [(int(w * 0.15) + i * 14, int(h * 0.52) + (18 if (i % 2) else -14)) for i in range(16)]
    d.line(pts, fill=(28, 60, 160), width=4)
    d.text((int(w * 0.16), int(h * 0.56)), "checked OK -MB", fill=(28, 60, 160))
    return _png(img)


def no_titleblock(data: bytes) -> bytes:
    """White out the header band (sheet identity gone — must not be invented)."""
    img = _open(data)
    w, _h = img.size
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w, 80], fill=(255, 255, 255))
    return _png(img)


ROTATION_TRANSFORMS: dict[str, callable] = {
    "rot90": rot90,
    "rot180": rot180,
    "rot270": rot270,
}

QUALITY_TRANSFORMS: dict[str, callable] = {
    "skew_slight": skew_slight,
    "perspective": perspective,
    "blur": blur,
    "glare": glare,
    "shadow": shadow,
    "uneven_light": uneven_light,
    "lowres": lowres,
    "jpeg_q20": jpeg_q20,
    "phone_screen": phone_screen,
    "crop_partial": crop_partial,
    "obstructed": obstructed,
    "handwritten": handwritten,
    "no_titleblock": no_titleblock,
}

ALL_TRANSFORMS: dict[str, callable] = {**ROTATION_TRANSFORMS, **QUALITY_TRANSFORMS}
