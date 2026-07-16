"""Phase-2 single-photo cases — the six canonical technician questions over the
frozen Phase-1 golden corpus (testing-program Phase 2).

Each case binds ONE question to ONE golden-corpus page and declares exact,
deterministic expectations about the answer's PROPERTIES (never its prose):
which device tags may appear (anything else is invention), what must be
mentioned, which affirmations a contact-convention verdict requires, which
phrases are forbidden (wrong verdict, unsupported energization claims), and
whether the honest outcome is a refusal or a ladder fall-through.

Two run modes share these cases:

* HERMETIC — ``scripted`` supplies the vision classification, OCR items, and a
  canned model reply, so CI grades the real Telegram rung end-to-end with the
  same monkeypatch seams the existing bot tests use ($0, offline).
* LIVE — ``render_case_png`` draws the page from the golden-corpus token
  stream and the real providers answer; the SAME expectations grade the reply.

Expectations are frozen (``expectations_digest`` vs ``single_photo_cases.sha256``)
— editing them is a loud, deliberate two-file diff, exactly like Phase 1.
All content is fictional (sheets 9x, K9xx); ``truth_status: synthetic``.
"""

from __future__ import annotations

import hashlib
import io
import json

from . import golden_corpus

PHASE2_VERSION = "single_photo_cases_v1"

_BY_ID = {c["case_id"]: c for c in golden_corpus.CASES}


def _base(case_id: str) -> dict:
    return _BY_ID[case_id]


def _ocr_items(case_id: str) -> list[str]:
    return [t["text"] for t in _base(case_id)["tokens"]]


CASES: list[dict] = [
    {
        "case_id": "q_circuit_function",
        "base": "iec_contactor_control",
        "question": "What does this circuit do?",
        "truth_status": "synthetic",
        "scripted": {
            "classification": "ELECTRICAL_PRINT",
            "ocr_items": _ocr_items("iec_contactor_control"),
            "reply": (
                "This is a contactor control circuit. Coil A1/A2 of -91/K01 is "
                "the operating coil, and 13/14 is its normally open auxiliary "
                "contact. The circuit continues on sheet 92 at reference "
                "92.1 / K911. Verify against the physical panel before working "
                "on it — the print cannot show the current contact state."
            ),
        },
        "expect": {
            "claimed": True,
            "allowed_tags": ["-91/K01", "K911"],
            "required_mentions": ["K01"],
            "affirm_any": [],
            "forbid_any": [],
            "safety_language_required": False,
            "refusal": False,
        },
    },
    {
        "case_id": "q_designation_meaning",
        "base": "iec_contactor_control",
        "question": "What does -91/K01 mean?",
        "truth_status": "synthetic",
        "scripted": {
            "classification": "ELECTRICAL_PRINT",
            "ocr_items": _ocr_items("iec_contactor_control"),
            "reply": (
                "-91/K01 is an IEC device designation: sheet 91, device K01. "
                "The K class letter is conventionally a contactor or relay, but "
                "the project legend on the cover sheet is the authority for "
                "what K means in this drawing set."
            ),
        },
        "expect": {
            "claimed": True,
            "allowed_tags": ["-91/K01", "K911"],
            "required_mentions": ["91", "K01"],
            "affirm_any": ["contactor", "relay", "class letter", "device class"],
            "forbid_any": [],
            "safety_language_required": False,
            "refusal": False,
        },
    },
    {
        "case_id": "q_contact_convention",
        "base": "iec_contactor_control",
        "question": "Is 13/14 normally open?",
        "truth_status": "synthetic",
        "scripted": {
            "classification": "ELECTRICAL_PRINT",
            "ocr_items": _ocr_items("iec_contactor_control"),
            "reply": (
                "Yes — by IEC convention the 13/14 terminal pair is a normally "
                "open auxiliary contact (function digits 3-4 mean a make "
                "contact). The marking is a naming convention only: it does not "
                "tell you the contact's present position, so verify with a "
                "meter before relying on it."
            ),
        },
        "expect": {
            "claimed": True,
            "allowed_tags": ["-91/K01", "K911"],
            "required_mentions": ["13"],
            "affirm_any": ["normally open"],
            "forbid_any": ["normally closed"],
            "safety_language_required": True,
            "refusal": False,
        },
    },
    {
        "case_id": "q_where_continue",
        "base": "partial_crop_missing_context",
        "question": "Where does this continue?",
        "truth_status": "synthetic",
        "scripted": {
            "classification": "ELECTRICAL_PRINT",
            "ocr_items": _ocr_items("partial_crop_missing_context"),
            "reply": (
                "The reference 89.2 / K891 points to sheet 89, but sheet 89 is "
                "not in what you've sent, so I can't confirm the far side. "
                "Photograph sheet 89 to resolve it."
            ),
        },
        "expect": {
            "claimed": True,
            "allowed_tags": ["K891"],
            "required_mentions": ["89"],
            "affirm_any": [],
            "forbid_any": [],
            "honesty_any": ["not in", "missing", "can't", "cannot", "unresolved"],
            "safety_language_required": False,
            "refusal": False,
        },
    },
    {
        "case_id": "q_photograph_next",
        "base": "partial_crop_missing_context",
        "question": "What should I photograph next?",
        "truth_status": "synthetic",
        "scripted": {
            "classification": "ELECTRICAL_PRINT",
            "ocr_items": _ocr_items("partial_crop_missing_context"),
            "reply": (
                "Photograph sheet 89 next — the visible reference 89.2 / K891 "
                "continues there and nothing else on this crop is unresolved."
            ),
        },
        "expect": {
            "claimed": True,
            "allowed_tags": ["K891"],
            "required_mentions": ["89"],
            "affirm_any": [],
            "forbid_any": [],
            "safety_language_required": False,
            "refusal": False,
        },
    },
    {
        "case_id": "q_not_energize",
        "base": "estop_safety_chain",
        "question": "Why would this contactor not energize?",
        "truth_status": "synthetic",
        "scripted": {
            "classification": "ELECTRICAL_PRINT",
            "ocr_items": _ocr_items("estop_safety_chain"),
            "reply": (
                "On this sheet the coil A1/A2 of -93/K02 is fed through the "
                "normally closed 21/22 contact of -93/S01 (an e-stop style "
                "chain). If -93/S01 is operated or its 21/22 path is broken, "
                "the coil circuit is open. The print can't show live state — "
                "measure the chain with a meter to find the actual break."
            ),
        },
        "expect": {
            "claimed": True,
            "allowed_tags": ["-93/S01", "-93/K02"],
            "required_mentions": ["-93/K02"],
            "affirm_any": [],
            "forbid_any": [],
            "safety_language_required": True,
            "refusal": False,
        },
    },
    {
        "case_id": "q_unreadable_refusal",
        "base": "unreadable_page",
        "question": "What does this circuit do?",
        "truth_status": "synthetic",
        "scripted": {
            "classification": "ELECTRICAL_PRINT",
            "ocr_items": [],
            "reply": (
                "I can't read this capture — no labels are legible, so I won't "
                "guess at devices or connections. Retake the photo squarely "
                "with the whole sheet in frame and better light."
            ),
        },
        "expect": {
            "claimed": "either",
            "allowed_tags": [],
            "required_mentions": [],
            "affirm_any": [],
            "forbid_any": [],
            "refusal": True,
            "safety_language_required": False,
        },
    },
    {
        "case_id": "q_nonprint_falls_through",
        "base": "iec_contactor_control",
        "question": "What does this circuit do?",
        "truth_status": "synthetic",
        "scripted": {
            "classification": "EQUIPMENT_PHOTO",
            "ocr_items": [],
            "reply": "(never reached — the rung must fall through)",
        },
        "expect": {
            "claimed": False,
            "allowed_tags": [],
            "required_mentions": [],
            "affirm_any": [],
            "forbid_any": [],
            "refusal": False,
            "safety_language_required": False,
        },
    },
]


def case_ids() -> list[str]:
    return [c["case_id"] for c in CASES]


def expectations_digest(cases: list[dict] | None = None) -> str:
    """SHA-256 over (case_id, question, expect) — the frozen grading contract.
    Scripted replies are NOT part of the freeze: they are hermetic-mode inputs,
    not truth."""
    src = [
        {"case_id": c["case_id"], "question": c["question"], "expect": c["expect"]}
        for c in sorted(cases or CASES, key=lambda c: c["case_id"])
    ]
    blob = json.dumps(src, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def render_case_png(case: dict) -> bytes:
    """Deterministically draw the case's live-mode image (PNG).

    Print cases draw the base golden-corpus page from its token stream (same
    pattern as provider_qualification.render_synthetic_xref_sheet — PIL default
    font, fixed layout, nothing random). A case that expects the rung to FALL
    THROUGH gets a genuinely non-schematic image instead: rendering the print
    page for it would make `expected claimed=False` unachievable, since a
    correct classifier will (rightly) call a drawn schematic a print."""
    from PIL import Image, ImageDraw  # lazy: hermetic mode never needs PIL

    if case["expect"].get("claimed") is False:
        img = Image.new("RGB", (1024, 768), (118, 118, 122))
        draw = ImageDraw.Draw(img)
        for y in range(0, 768, 8):  # flat photo-like gradient, no line work
            shade = 96 + (y * 48 // 768)
            draw.line([(0, y), (1024, y)], fill=(shade, shade, shade), width=8)
        draw.ellipse([362, 234, 662, 534], fill=(84, 84, 88))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    base = _base(case["base"])
    width = base.get("page_width", 1400)
    img = Image.new("RGB", (width, 900), "white")
    draw = ImageDraw.Draw(img)
    draw.rectangle([40, 40, width - 40, 860], outline="black", width=3)
    draw.text((60, 55), f"BLATT {base['page']}  (synthetic test sheet)", fill="black")
    for tok in base["tokens"]:
        x0, y0 = tok["bbox"][0], tok["bbox"][1]
        draw.text((x0, y0 + 60), tok["text"], fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
