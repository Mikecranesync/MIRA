"""Layer 2 — metamorphic image transforms + a no-invention comparator.

The metamorphic property: a degraded or re-photographed image may LOSE facts or
LOWER confidence, but must NEVER reveal a NEW exact designation, terminal, wire,
voltage, destination, or device that the clean original did not have — that would
be fabrication under degradation. This module supplies the transforms (PIL only)
and the deterministic comparator; the paid pytest driver interprets the
transformed image and compares it to the frozen golden graph.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field

from printsense.harness import asserts
from printsense.models import PrintSynthGraph

# Full IEC-style designation extractor. Captures the WHOLE token — optional prefix,
# optional page ("18/", "15.7 / "), a letter-digit code that MAY carry glued trailing
# letters (W5497, WK902, X2KL, A13, X24V, DA6), and an optional point suffix (:2, .41, .9)
# — so distinct designations stay distinct and a fabricated `-WK902`, `-18/X2KL:8`, `-21/A14`,
# or off-page `15.7 / -X3.9` is VISIBLE. A bare number alone never matches (a letter code is
# required), so confidence values / sheet numbers in prose don't manufacture false facts.
_DESIG = re.compile(
    r"[-+=]?"                       # IEC prefix
    r"(?:\d+(?:\.\d+)?\s*/\s*)?"     # optional page ("18/", "15.7 / ")
    r"[-+=]?"                        # optional prefix right after a page separator
    r"[A-Z]{1,3}\d+[A-Z]*"           # code: letters + digits + optional glued trailing letters
    r"(?:[:.]\d+)?",                # optional point suffix (:2, .41)
    re.I,
)
_RAIL_ID = re.compile(r"X(\d+)V")  # a BARE rail-voltage id (X24V) — folds to its rail (X24)


_PAGE = re.compile(r"^\d+(?:\.\d+)?/[-+=]*")  # a leading page/location locator: "18/", "4.4/", "15.7/-"


def _canon_desig(desig: str) -> str:
    """Canonicalize ONE full designation to its CODE identity for comparison: upper-case,
    strip whitespace, drop the leading IEC prefix (``-X24`` == ``+X24`` == ``X24``), and drop
    the leading PAGE/location locator (``21/A13`` == ``A13``, ``4.4/X24V.3`` == ``X24V.3``) —
    the page is where a designation is *referenced*, not its identity, so a degraded read that
    omits it is lost locator detail, not a new designation. The ONLY value-folding is the PROVEN
    rail equivalence: a BARE rail-voltage id folds to its rail (``X24V`` == ``X24``); a suffixed
    form (``X24V.41``) is NOT bare and stays distinct. Nothing else is collapsed — ``WK902`` !=
    ``W5497``, ``X2KL:1`` != ``X2KL:8``, ``X24V.41`` != ``X24V.42``, ``A13`` != ``A14`` all
    survive, so the no-invention gate keeps full strictness on the code that matters."""
    s = re.sub(r"\s+", "", desig).upper()
    s = re.sub(r"^[-+=]+", "", s)
    s = _PAGE.sub("", s)  # drop the leading page/location locator, keep code + suffix
    m = _RAIL_ID.fullmatch(s)
    return f"X{m.group(1)}" if m else s


def _classify_desig(canon: str) -> str:
    """Bucket a canonical (code-only) designation for REPORTING only (the gate uses the union)."""
    if canon.startswith("W"):
        return "wire"
    if canon.startswith("X"):
        return "terminal"
    if canon.startswith("DA"):
        return "xref"
    return "device"


# ── transforms: bytes -> bytes (PIL only) ────────────────────────────────────


def _pil(data: bytes, fn, quality: int = 88) -> bytes:
    from PIL import Image

    im = Image.open(io.BytesIO(data))
    im.load()
    im = fn(im).convert("RGB")
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def rotate(deg: float):
    return lambda b: _pil(b, lambda im: im.rotate(deg, expand=True, fillcolor="white"))


def downscale(long_px: int):
    def fn(im):
        from PIL import Image

        w, h = im.size
        if max(w, h) <= long_px:
            return im
        s = long_px / max(w, h)
        return im.resize((max(1, int(w * s)), max(1, int(h * s))), Image.LANCZOS)

    return lambda b: _pil(b, fn)


def jpeg(quality: int):
    return lambda b: _pil(b, lambda im: im, quality=quality)


def blur(radius: float):
    from PIL import ImageFilter

    return lambda b: _pil(b, lambda im: im.filter(ImageFilter.GaussianBlur(radius)))


def crop_border(frac: float):
    def fn(im):
        w, h = im.size
        dx, dy = int(w * frac), int(h * frac)
        return im.crop((dx, dy, w - dx, h - dy))

    return lambda b: _pil(b, fn)


def perspective(shift: float):
    """A mild keystone — the top edge is squeezed inward by `shift` of the width."""

    def fn(im):
        from PIL import Image

        w, h = im.size
        dx = int(w * shift)
        quad = (dx, 0, 0, h, w, h, w - dx, 0)  # UL, LL, LR, UR source points
        return im.transform((w, h), Image.QUAD, quad, resample=Image.BILINEAR, fillcolor="white")

    return lambda b: _pil(b, fn)


def shadow(strength: float = 0.45):
    """Darken across a diagonal gradient — a hand/overhead shadow on the sheet."""

    def fn(im):
        from PIL import Image, ImageChops

        w, h = im.size
        grad = Image.new("L", (w, 1))
        lo = int(255 * (1 - strength))
        grad.putdata([int(lo + (255 - lo) * (x / max(1, w - 1))) for x in range(w)])
        grad = grad.resize((w, h))
        return ImageChops.multiply(im.convert("RGB"), Image.merge("RGB", (grad, grad, grad)))

    return lambda b: _pil(b, fn)


def document_clean():
    """A cleaner 'scan-like' variant — autocontrast + light sharpen (the photo→document axis)."""

    def fn(im):
        from PIL import ImageFilter, ImageOps

        return ImageOps.autocontrast(im.convert("RGB"), cutoff=1).filter(ImageFilter.SHARPEN)

    return lambda b: _pil(b, fn)


# The default metamorphic matrix (name -> transform). These are MODERATE, realistic
# capture variations — the invariance gate expects facts to survive them. Severe,
# sub-legibility degradation (heavy downscale/blur) is deliberately NOT here: it is
# covered by the `blurred_sheet20` corpus case, which tests uncertainty discipline
# (degrade to unresolved) rather than fact-invariance.
TRANSFORMS: dict = {
    "rotate_90": rotate(90),
    "rotate_7": rotate(7),
    "downscale_1400": downscale(1400),
    "jpeg_55": jpeg(55),
    "blur_0_7": blur(0.7),
    "crop_8pct": crop_border(0.08),
    "perspective_6pct": perspective(0.06),
    "shadow": shadow(0.4),
    "document_clean": document_clean(),
}


# ── comparator: no invention under degradation ───────────────────────────────


def _mean_conf(g: PrintSynthGraph) -> float:
    cs = [e.confidence for e in g.all_entities() if isinstance(e.confidence, (int, float))]
    return sum(cs) / len(cs) if cs else 0.0


def _designations(g: PrintSynthGraph) -> set[str]:
    """ALL canonical designations the graph ASSERTS — wires, terminals, devices, and
    off-page cross-refs — extracted from every entity tag + connect target and the brief's
    signal tag/terminal/destination. Restricted to these STRUCTURED fields (never free-text
    ``evidence``/``detail``, where a gate-demoted guess is parked) so a bare number in prose
    can't manufacture a false fact."""
    out: set[str] = set()
    srcs: list[str] = []
    for e in g.all_entities():
        srcs.append(e.tag or "")
        srcs += list(e.connects or [])
    if g.brief:
        for s in g.brief.key_signals:
            srcs += [s.tag or "", s.terminal or "", s.destination or ""]
    for src in srcs:
        for m in _DESIG.finditer(src):
            c = _canon_desig(m.group(0))
            if c:
                out.add(c)
    return out


@dataclass
class MetaResult:
    new_facts: set = field(default_factory=set)  # ALL new canonical designations — the gate
    new_voltages: set = field(default_factory=set)
    new_wires: set = field(default_factory=set)  # classified subsets of new_facts, for reporting
    new_terminals: set = field(default_factory=set)
    new_devices: set = field(default_factory=set)
    new_xrefs: set = field(default_factory=set)
    overlap_ratio: float = 1.0
    conf_original: float = 0.0
    conf_transform: float = 0.0

    def no_invention(self) -> bool:
        """The HARD gate — a degraded image invented NO new designation (wire / terminal /
        device / cross-ref) and no new voltage."""
        return not (self.new_facts or self.new_voltages)

    def equivalent_or_less_confident(self) -> bool:
        """Facts materially overlap the original, OR the transform is less confident."""
        return self.overlap_ratio >= 0.6 or self.conf_transform <= self.conf_original + 1e-6


def compare(original: PrintSynthGraph, transformed: PrintSynthGraph) -> MetaResult:
    """Judge invention on CANONICAL full designations (wires, terminals, devices, off-page
    refs) + numeric voltages — notation variance is normalized out, but genuinely different
    values (WK902 vs W5497, X2KL:1 vs X2KL:8, A13 vs A14) stay distinct. Overlap is measured
    on the same canonical designation set."""
    o, t = _designations(original), _designations(transformed)
    new = t - o
    o_v = asserts.voltage_tokens(asserts.brief_text(original) + " " + asserts.evidence_text(original))
    t_v = asserts.voltage_tokens(asserts.brief_text(transformed) + " " + asserts.evidence_text(transformed))
    overlap = (len(t & o) / len(t)) if t else 1.0
    buckets: dict[str, set] = {"wire": set(), "terminal": set(), "device": set(), "xref": set()}
    for d in new:
        buckets[_classify_desig(d)].add(d)
    return MetaResult(
        new_facts=new,
        new_voltages=(t_v - o_v),
        new_wires=buckets["wire"],
        new_terminals=buckets["terminal"],
        new_devices=buckets["device"],
        new_xrefs=buckets["xref"],
        overlap_ratio=round(overlap, 3),
        conf_original=round(_mean_conf(original), 3),
        conf_transform=round(_mean_conf(transformed), 3),
    )
