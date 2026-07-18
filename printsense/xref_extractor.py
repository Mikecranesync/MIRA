"""xref_extractor_v1 — deterministic cross-reference extraction (PR-C/D).

Two strictly separated layers:

1. **Lexical** (:func:`lex_page`): OCR tokens (text + bbox) → typed candidate
   references via an ordered pattern table (IEC/German sheet.column anchors,
   page-anchor refs like ``12 / DA6.1``, coil-column ``/7.6``, ``+EXT``
   externals, cable continuations, from/to-sheet phrases, NFPA grid refs).
   Raw source text and evidence bbox are always preserved; every confidence
   carries deterministic reasons. Contact-convention numbers (IEC 60947-5-1
   two-digit terminal markings such as 13/14/21/22/53/54/61/62) are NEVER
   treated as device anchors.
2. **Resolution** (:func:`resolve`): candidates + the PACKAGE PAGE INDEX
   (sheet id ↔ page id + optionally known anchors per sheet) → evidence
   records with status ``resolved | ambiguous | missing_target |
   contradictory``. A target is never invented: unknown sheets stay
   ``missing_target`` with ``target_page: null``; anchor-only references
   matching several sheets stay ``ambiguous`` with explicit candidates.

OCR itself is an adapter (:func:`ocr_tokens`) over Tesseract
``image_to_data``; when the binary/library is unavailable the caller gets an
explicit :class:`OcrUnavailable` — degraded pipelines report a skipped stage,
never a silent pass, and tokens flatten to evidence strings via
:func:`line_items`. Records serialize via :func:`stable_json` (canonical,
byte-stable). Output integrates with pageset via :func:`to_pageset_xrefs`.
"""

from __future__ import annotations

import json
import re

EXTRACTOR_VERSION = "xref_extractor_v1"

# IEC 60947-5-1 two-digit contact terminal markings — conventions, not devices.
CONTACT_CONVENTION_NUMBERS = frozenset({
    "13", "14", "21", "22", "31", "32", "43", "44",
    "53", "54", "61", "62", "63", "64", "71", "72", "81", "82", "83", "84",
    "95", "96", "97", "98", "A1", "A2",
})


class OcrUnavailable(RuntimeError):
    """Coordinate OCR is not available in this environment (explicit skip)."""


def ocr_tokens(image_bytes: bytes) -> list[dict]:
    """Tesseract word boxes: [{text, bbox:[x0,y0,x1,y1], line}] — or raise."""
    try:
        import io

        import pytesseract
        from PIL import Image

        img = Image.open(io.BytesIO(image_bytes))
        data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
    except Exception as exc:  # missing binary, missing lib, bad image
        raise OcrUnavailable(f"{type(exc).__name__}: {exc}") from exc
    out = []
    for i, text in enumerate(data["text"]):
        t = (text or "").strip()
        if not t:
            continue
        x, y = data["left"][i], data["top"][i]
        w, h = data["width"][i], data["height"][i]
        out.append({"text": t, "bbox": [x, y, x + w, y + h],
                    "line": (data["block_num"][i], data["line_num"][i])})
    return out


# --------------------------------------------------------------------------
# Lexical layer
# --------------------------------------------------------------------------

_PATTERNS: list[tuple[str, str, re.Pattern, float]] = [
    # class, relationship, pattern, base confidence
    ("SHEET_COL_ANCHOR", "CONTINUES_ON",
     re.compile(r"^(\d{1,3})\.(\d)\s*/\s*([A-Z]{1,3}\d{1,4}[A-Z]?(?:\.\d+)?)$"), 0.85),
    ("PAGE_ANCHOR", "CONTINUES_ON",
     re.compile(r"^(\d{1,3})\s*/\s*([A-Z]{1,3}\d+\.\d+)$"), 0.80),
    ("SLASH_COL", "REFERENCES",
     re.compile(r"^/(\d{1,3})\.(\d)$"), 0.75),
    ("FROM_SHEET", "CONTINUES_FROM",
     re.compile(r"^(?:von|from)\s+(?:blatt|sheet)\s+(\d{1,3})$", re.I), 0.80),
    ("TO_SHEET", "CONTINUES_ON",
     re.compile(r"^(?:nach|to)\s+(?:blatt|sheet)\s+(\d{1,3})$", re.I), 0.80),
    ("EXTERNAL", "EXTERNAL_TO",
     re.compile(r"^\+(EXT|[A-Z]{2,6}\d*)/\S+$"), 0.70),
    ("CABLE_CONT", "CABLE_CONTINUES",
     re.compile(r"^-W\d{3,5}(?:\.\d)?$"), 0.55),
    ("GRID_REF", "GRID_REFERENCE",
     re.compile(r"^([A-H])(\d{1,2})$"), 0.35),
]


def _join_lines(tokens: list[dict]) -> list[dict]:
    """Merge tokens per OCR line into candidate strings (plus singletons)."""
    lines: dict = {}
    for t in tokens:
        lines.setdefault(t.get("line", (0, 0)), []).append(t)
    joined = []
    for _key, toks in sorted(lines.items()):
        toks = sorted(toks, key=lambda t: t["bbox"][0])
        text = " ".join(t["text"] for t in toks)
        bbox = [min(t["bbox"][0] for t in toks), min(t["bbox"][1] for t in toks),
                max(t["bbox"][2] for t in toks), max(t["bbox"][3] for t in toks)]
        joined.append({"text": text, "bbox": bbox})
        joined.extend({"text": t["text"], "bbox": t["bbox"]} for t in toks)
    return joined


def line_items(tokens: list[dict]) -> list[str]:
    """OCR tokens -> flat evidence strings for ``vision_data['ocr_items']``.

    Joined per-line strings first (so multi-token labels like ``A1 A2``
    survive), then singleton tokens — the same coverage `_join_lines`
    gives the lexical layer — order-stable and deduplicated.
    """
    seen: set[str] = set()
    out: list[str] = []
    for entry in _join_lines(tokens):
        text = entry["text"].strip()
        if text and text not in seen:
            seen.add(text)
            out.append(text)
    return out


def _confidence(base: float, text: str, bbox: list, page_width: int | None) -> tuple[float, list[str]]:
    reasons = [f"pattern_base:{base:.2f}"]
    conf = base
    if "/" in text:
        conf += 0.05
        reasons.append("explicit_slash_separator:+0.05")
    if page_width and (bbox[0] < page_width * 0.12 or bbox[2] > page_width * 0.88):
        conf += 0.10
        reasons.append("margin_arrow_zone:+0.10")
    return round(min(conf, 0.99), 2), reasons


def lex_page(tokens: list[dict], source_page: int | str,
             source_anchor: str | None = None,
             page_width: int | None = None) -> list[dict]:
    """Lexical candidates from one page's OCR tokens. Never resolves targets."""
    out = []
    for tok in _join_lines(tokens):
        text = tok["text"].strip()
        for cls, rel, pat, base in _PATTERNS:
            m = pat.match(text)
            if not m:
                continue
            if cls in ("SHEET_COL_ANCHOR", "PAGE_ANCHOR"):
                anchor = m.group(3) if cls == "SHEET_COL_ANCHOR" else m.group(2)
                if anchor.upper() in CONTACT_CONVENTION_NUMBERS:
                    break  # convention marking, not a device anchor
                target_sheet = m.group(1)
            elif cls in ("SLASH_COL", "FROM_SHEET", "TO_SHEET"):
                anchor, target_sheet = None, m.group(1)
            else:
                anchor, target_sheet = None, None
            conf, reasons = _confidence(base, text, tok["bbox"], page_width)
            out.append({
                "source_page": source_page,
                "source_anchor": source_anchor,
                "raw_reference": text,
                "pattern_class": cls,
                "relationship": rel,
                "target_sheet_lexical": target_sheet,
                "target_anchor_lexical": anchor,
                "evidence_bbox": list(tok["bbox"]),
                "confidence": conf,
                "confidence_reasons": reasons,
                "status": "machine_proposed",
                "extractor_version": EXTRACTOR_VERSION,
            })
            break  # first matching pattern wins (ordered table)
    return out


# --------------------------------------------------------------------------
# Resolution layer
# --------------------------------------------------------------------------


def resolve(candidates: list[dict], page_index: dict) -> list[dict]:
    """Resolve lexical candidates against the package page index.

    ``page_index``: {"sheets": {sheet_id: page_id}, "anchors": {sheet_id:
    [anchor, ...]} (optional)}. Targets come ONLY from this index — never
    from PDF position, never invented.
    """
    sheets = {str(k): v for k, v in page_index.get("sheets", {}).items()}
    anchors = {str(k): {a.upper() for a in v}
               for k, v in page_index.get("anchors", {}).items()}
    out = []
    for c in candidates:
        r = dict(c)
        ts, ta = c.get("target_sheet_lexical"), c.get("target_anchor_lexical")
        if c["pattern_class"] in ("EXTERNAL", "CABLE_CONT", "GRID_REF"):
            r.update(resolution="unresolved_segment", target_page=None,
                     target_anchor=ta)
        elif ts is not None:
            if str(ts) not in sheets:
                r.update(resolution="missing_target", target_page=None,
                         target_anchor=ta,
                         resolution_reason=f"sheet {ts} not in package index")
            elif ta and str(ts) in anchors and ta.upper() not in anchors[str(ts)]:
                r.update(resolution="contradictory",
                         target_page=sheets[str(ts)], target_anchor=ta,
                         resolution_reason=(f"sheet {ts} is in the package but "
                                            f"does not show anchor {ta}"))
            else:
                r.update(resolution="resolved", target_page=sheets[str(ts)],
                         target_anchor=ta,
                         resolution_reason="sheet present in package index"
                         + ("; anchor verified" if ta and str(ts) in anchors
                            else "; anchor unverified (no anchor index)"))
        elif ta:
            hits = [s for s, aa in anchors.items() if ta.upper() in aa]
            if len(hits) == 1:
                r.update(resolution="resolved", target_page=sheets[hits[0]],
                         target_anchor=ta,
                         resolution_reason=f"anchor unique to sheet {hits[0]}")
            elif len(hits) > 1:
                r.update(resolution="ambiguous", target_page=None,
                         target_anchor=ta,
                         candidates=[{"sheet": s, "page": sheets[s]}
                                     for s in sorted(hits)],
                         resolution_reason="anchor present on multiple sheets")
            else:
                r.update(resolution="missing_target", target_page=None,
                         target_anchor=ta,
                         resolution_reason="anchor not found in package index")
        else:
            r.update(resolution="unresolved_segment", target_page=None,
                     target_anchor=None)
        out.append(r)
    return out


def stable_json(records: list[dict]) -> str:
    """Canonical, byte-stable serialization (sorted keys, fixed ordering)."""
    ordered = sorted(records, key=lambda r: (
        str(r.get("source_page")), r.get("evidence_bbox", [0])[0],
        r.get("raw_reference", "")))
    return json.dumps(ordered, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False)


def to_pageset_xrefs(records: list[dict]) -> list[dict]:
    """Convert evidence records to the pageset/systemgraph xref shape."""
    out = []
    for r in records:
        sig = r.get("target_anchor") or r.get("raw_reference")
        out.append({"raw": r["raw_reference"], "sig": sig,
                    "ev": "obs", "source_field": "xref_extractor_v1"})
    return out
