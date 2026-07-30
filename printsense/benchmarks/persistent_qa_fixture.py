"""Persistent-Q&A synthetic fixture — one K17 seal-in control circuit (Package C).

The single-page drawing the persistent print-workspace golden conversation runs
against (``mira-bots/tests/test_print_workspace_golden.py``): a contactor coil
``-K17`` fed from ``24VDC`` through fuse ``-F12`` and start pushbutton ``-S1``,
sealed in by its ``13``/``14`` auxiliary contact, with terminal-strip references
``-X2:4``/``-X2:5`` and wire number ``-W412``. ``CLOSE_UP_BASE`` is a close-up
re-read of the ``-K17`` region that adds the ``21``/``22`` auxiliary pair only
legible up close — the progressive-enrichment photo that supersedes the wide
shot's K17-region evidence by tag overlap.

Shape rules:

* ``BASE``/``CLOSE_UP_BASE`` follow the golden-corpus base-dict shape
  (``case_id``, ``kind``, ``description``, ``truth_status``, ``page``,
  ``page_width``, ``tokens`` of ``{"text","bbox","line"}``) so the SHARED
  renderer ``single_photo_cases.draw_print_page`` draws them unchanged.
* 100% FICTIONAL and redistributable (``truth_status: "synthetic"``): no
  customer, project, site, drawing, or person content — same law as
  ``golden_corpus.py`` (enforced repo-wide by
  ``tests/printsense/test_privacy_guards.py``).
* Deterministic: fixed token layout, no randomness; ``vision_data`` and
  ``page_png`` are pure functions of the base dict.
"""

from __future__ import annotations

from typing import Any

from .single_photo_cases import draw_print_page

FIXTURE_VERSION = "persistent_qa_fixture_v1"


def _tok(text: str, x: int, y: int, w: int = 60, h: int = 18, group: int = 0) -> dict:
    """One word token — mirrors ``golden_corpus._tok`` exactly."""
    return {"text": text, "bbox": [x, y, x + w, y + h], "line": (group, y)}


# The wide (full-page) shot. Token order is the ledger insertion order the
# golden test's claim-projection assertions rely on — keep the seal-in pair
# (13/14) early so it stays inside the 8-claim projection cap.
BASE: dict = {
    "case_id": "k17_seal_in_control",
    "kind": "control_page",
    "description": (
        "Synthetic K17 contactor seal-in circuit: 24VDC supply, fuse -F12, start "
        "pushbutton -S1, coil -K17 (A1/A2), seal-in aux 13/14, terminal refs "
        "-X2:4/-X2:5, wire -W412."
    ),
    "truth_status": "synthetic",
    "page": "94",
    "page_width": 1400,
    "tokens": [
        _tok("24VDC", 110, 70),
        _tok("-W412", 480, 70),
        _tok("-F12", 110, 100),
        _tok("-S1", 300, 100),
        _tok("-K17", 640, 100),
        _tok("A1", 620, 140),
        _tok("A2", 680, 140),
        _tok("13", 300, 180),
        _tok("14", 360, 180),
        _tok("-X2:4", 900, 100),
        _tok("-X2:5", 900, 140),
    ],
}

# The close-up re-read of the -K17 region. Overlap tokens carry the EXACT
# same text as BASE (that identity is what drives the tag-overlap supersede in
# ``shared/print_workspace.ingest_print_photo``); ``21``/``22`` is the
# auxiliary pair only legible up close.
CLOSE_UP_BASE: dict = {
    "case_id": "k17_seal_in_closeup",
    "kind": "control_page",
    "description": (
        "Close-up re-read of the -K17 region: coil A1/A2 and seal-in 13/14 "
        "re-read at close range, plus the 21/22 auxiliary pair only legible "
        "up close."
    ),
    "truth_status": "synthetic",
    "page": "94",
    "page_width": 1100,
    "tokens": [
        _tok("-K17", 320, 90),
        _tok("A1", 300, 140),
        _tok("A2", 370, 140),
        _tok("13", 300, 200),
        _tok("14", 370, 200),
        _tok("21", 300, 260),
        _tok("22", 370, 260),
    ],
}


def vision_data(base: dict) -> dict[str, Any]:
    """A live-shaped vision payload for ``base`` — the dict the Telegram photo
    path receives from the vision worker and replays into the workspace via
    ``PrecomputedVision`` (classification + bare ``ocr_items`` + positioned
    ``ocr_tokens``). Pure and deterministic."""
    return {
        "classification": "ELECTRICAL_PRINT",
        "classification_confidence": 0.9,
        "vision_result": "a schematic drawing",
        "drawing_type": "control circuit",
        "drawing_type_confidence": 0.8,
        "tesseract_text": "",
        "ocr_items": [t["text"] for t in base["tokens"]],
        "ocr_tokens": [{"text": t["text"], "bbox": list(t["bbox"])} for t in base["tokens"]],
        "page": base["page"],
    }


def page_png(base: dict) -> bytes:
    """Deterministically render ``base`` as PNG bytes via the shared
    ``draw_print_page`` renderer (PIL default font, fixed layout)."""
    return draw_print_page(base)


__all__ = ["BASE", "CLOSE_UP_BASE", "FIXTURE_VERSION", "page_png", "vision_data"]
