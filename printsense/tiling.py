"""Phase 2 — targeted high-resolution tiling for PrintSense (roadmap Phase 2).

The full-page pass produces an A-level graph but *honestly hedges* a few items to
``unresolved`` (a workbench photo can't resolve every 6-pt designation in one shot).
Phase 2 resolves those specific items WITHOUT re-doing the whole page:

  locate each unresolved region on the image  ->  crop it at high resolution from
  the ORIGINAL photo (with padding + upscale)  ->  blindly reread just that crop
  ->  merge back ONLY grammar-valid, evidence-supported readings.

This does NOT replace the successful full-page pass (roadmap: "do not replace the
successful full-page pass with indiscriminate tiling") — it augments it, touching
only the unresolved/low-confidence regions. Every crop keeps its bbox in the
original image, so each promoted fact is coordinate-traceable. New facts land as
``proposed`` (a single crop read is evidence, not verification — Phase 3 verifies).

Anthropic-isolated: reuses ``printsense.interpret`` building blocks; no cascade.
"""

from __future__ import annotations

import io
import json
import logging
import re

from printsense import interpret
from printsense.models import Entity, PrintSynthGraph, TrustState

logger = logging.getLogger("printsense.tiling")

CONF_GATE = interpret.CONF_GATE  # a crop reading below this is not merged

_LOCATE_SYSTEM = (
    "You locate specific items on an electrical-print image and return their pixel "
    "bounding boxes. Coordinates are pixels of THIS image: origin top-left, x to the "
    "right, y down. Return ONLY JSON, no prose:\n"
    '{"regions":[{"item":"<the item text, verbatim>","bbox":[x0,y0,x1,y1],'
    '"found":true}]}\n'
    "If an item is not visible, set found=false and bbox=null. Make each bbox a "
    "TIGHT box around just that designation/label."
)

_REREAD_SYSTEM = (
    "You are reading the exact printed text in a CROPPED region of an electrical "
    "print. Read CHARACTER BY CHARACTER; never pattern-complete a partial tag. Obey "
    "DIN/IEC 81346 grammar strictly: a wire is `-W`+digits (NEVER `-WK`); a device is "
    "`-{sheet}/{Class}{n}` (e.g. -21/A13); a cross-reference is digits.dot.digits "
    "(e.g. 20.9); a terminal is `-X{n}` or `-X{n}.{n}`; a location is `+{LOC}` "
    "verbatim. Return ONLY JSON, no prose:\n"
    '{"readings":[{"text":"<exact designation>",'
    '"kind":"device|wire|xref|terminal|type|location|other","confidence":0.0-1.0}]}\n'
    'If nothing is legible, return {"readings":[]}. Do not guess — an unreadable '
    "crop returns an empty list, which is the correct answer."
)

# Per-kind grammar guards — a merged reading must match its declared kind.
_GRAMMAR = {
    "device": re.compile(r"^-?\d+/[A-Za-z]+\d+", re.I),
    "wire": re.compile(r"^-?W\d+$", re.I),
    "xref": re.compile(r"^-?X?\d+\.\d+", re.I),
    "terminal": re.compile(r"^-?X\d+(\.\d+|:\d+)?$", re.I),
    "location": re.compile(r"^\+\S+", re.I),
    "type": re.compile(r"^[A-Za-z][\w.\-]{3,}$"),  # catalog code: letters+digits+.-
}
# Which graph section a resolved kind lands in.
_SECTION = {
    "device": "devices",
    "wire": "cables",
    "xref": "off_page_references",
    "terminal": "terminals",
    "location": "off_page_references",
    "type": "devices",
}


def _call_json(client, image_bytes: bytes, user_text: str, system: str, effort: str):
    content = [
        interpret._source_block(image_bytes, "image/jpeg"),
        {"type": "text", "text": user_text},
    ]
    with client.messages.stream(
        model=interpret.DEFAULT_MODEL,
        max_tokens=8000,
        system=system,
        thinking={"type": "adaptive"},
        output_config={"effort": effort},
        messages=[{"role": "user", "content": content}],
    ) as stream:
        msg = stream.get_final_message()
    data = json.loads(interpret._strip_fences(interpret._first_text(msg)))
    return data, msg.usage


def _crop(pil_img, bbox, pad_frac: float = 0.08, min_px: int = 800):
    """Crop the original at bbox+padding; upscale small crops so text is legible."""
    from PIL import Image

    w, h = pil_img.size
    x0, y0, x1, y1 = bbox
    x0, x1 = sorted((max(0, x0), min(w, x1)))
    y0, y1 = sorted((max(0, y0), min(h, y1)))
    pw, ph = (x1 - x0) * pad_frac, (y1 - y0) * pad_frac
    box = (max(0, int(x0 - pw)), max(0, int(y0 - ph)), min(w, int(x1 + pw)), min(h, int(y1 + ph)))
    crop = pil_img.crop(box)
    cw, ch = crop.size
    if 0 < max(cw, ch) < min_px:
        s = min_px / max(cw, ch)
        crop = crop.resize((max(1, int(cw * s)), max(1, int(ch * s))), Image.LANCZOS)
    buf = io.BytesIO()
    crop.convert("RGB").save(buf, format="JPEG", quality=95)
    return buf.getvalue(), list(box)


def enhance(image_bytes: bytes, graph: PrintSynthGraph, max_regions: int = 8) -> dict:
    """Run Phase-2 tiling over a full-page graph's unresolved items.

    Returns ``{"graph": improved_graph, "changes": [...], "usage": {...}}``. The
    improved graph is a copy with resolved items promoted to ``proposed`` entities
    (bbox-traceable) and removed from ``unresolved``. Only grammar-valid, confident,
    non-duplicate crop readings are merged.
    """
    from PIL import Image

    items = [_item_text(u) for u in (graph.unresolved or [])][:max_regions]
    if not items:
        return {"graph": graph, "changes": [], "usage": {"input_tokens": 0, "output_tokens": 0}}

    client = interpret._client()
    pil = Image.open(io.BytesIO(image_bytes))
    pil.load()
    tok_in = tok_out = 0

    located, u = _call_json(
        client,
        image_bytes,
        "Locate these items on the print:\n" + "\n".join(f"- {it}" for it in items),
        _LOCATE_SYSTEM,
        "medium",
    )
    tok_in += u.input_tokens
    tok_out += u.output_tokens

    # Existing structured tags — never merge a duplicate.
    existing = {_norm(e.tag) for e in graph.all_entities()} | {
        _norm(e.type) for e in graph.all_entities() if e.type
    }

    improved = graph.model_copy(deep=True)
    changes: list[dict] = []
    resolved_items: set[str] = set()

    for reg in (located.get("regions") or [])[:max_regions]:
        if not reg.get("found") or not reg.get("bbox"):
            continue
        item = reg.get("item", "")
        try:
            crop_bytes, box = _crop(pil, [int(v) for v in reg["bbox"]])
        except Exception as exc:  # noqa: BLE001 — a bad bbox skips this region
            logger.warning("PHASE2_CROP_SKIP item=%r err=%s", item, exc)
            continue

        readings, u = _call_json(
            client,
            crop_bytes,
            "Read every printed designation in this crop.",
            _REREAD_SYSTEM,
            "high",
        )
        tok_in += u.input_tokens
        tok_out += u.output_tokens

        for r in readings.get("readings") or []:
            text = (r.get("text") or "").strip()
            kind = (r.get("kind") or "other").lower()
            conf = float(r.get("confidence") or 0)
            if not text or text.upper() == "UNREADABLE":
                continue
            if conf < CONF_GATE:  # do not merge a low-confidence crop read (no inflation)
                continue
            pat = _GRAMMAR.get(kind)
            if pat and not pat.match(text):  # grammar guard
                continue
            if _norm(text) in existing:  # already known — no duplicate
                continue
            section = _SECTION.get(kind, "off_page_references")
            getattr(improved, section).append(
                Entity(
                    tag=text,
                    type=("module type (phase-2 crop)" if kind == "type" else None),
                    evidence=f"phase-2 hi-res crop reread @ original bbox {box}; resolves unresolved item {item!r}",
                    confidence=round(conf, 2),
                    trust=TrustState.proposed,
                )
            )
            existing.add(_norm(text))
            resolved_items.add(item)
            changes.append({"text": text, "kind": kind, "confidence": conf, "bbox": box, "resolved_item": item})

    # Drop the unresolved items we resolved.
    improved.unresolved = [
        u2 for u2 in (improved.unresolved or []) if _item_text(u2) not in resolved_items
    ]
    logger.info("PHASE2_DONE regions=%d merged=%d tok=%d/%d", len(items), len(changes), tok_in, tok_out)
    return {"graph": improved, "changes": changes, "usage": {"input_tokens": tok_in, "output_tokens": tok_out}}


def _norm(tag) -> str:
    return re.sub(r"\s+", "", str(tag).strip().upper())


def _item_text(u) -> str:
    """The ``item`` text of an unresolved entry, whether it is an ``Unresolved``
    model or a plain dict."""
    if hasattr(u, "item"):
        return str(u.item or "")
    return str((u or {}).get("item", ""))
