"""Frozen unseen-lane corpus — novel sheet BLATT 27 (see README.md).

Tag universe deliberately disjoint from every calibration corpus; tags are
`_PROSE_TAG_RE`-matchable so the invention lane doubles as a seen-corpus
memorization-bleed probe. Rendering reuses the shared
:func:`printsense.benchmarks.single_photo_cases.draw_print_page` — the
expectations digest covers truth, not rendering."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

UNSEEN_VERSION = "unseen_lane_v1"

_SHA_FILE = Path(__file__).resolve().parent / "unseen_lane.sha256"

UNSEEN_BASE = {
    "case_id": "unseen_27_starter",
    "page": 27,
    "page_width": 1400,
    "tokens": [
        # -27/K44 FIRST: draw_print_page stamps the first '/'-token beside the coil
        {"text": "-27/K44", "bbox": [110, 180]},
        {"text": "+MCC4-PNL", "bbox": [110, 100]},
        {"text": "-27/Q30", "bbox": [320, 100]},
        {"text": "-27/F12", "bbox": [520, 100]},
        {"text": "Versorgung 24VDC", "bbox": [720, 100]},
        {"text": "-27/U60", "bbox": [1000, 100]},
        {"text": "A1", "bbox": [300, 180]},
        {"text": "A2", "bbox": [360, 180]},
        {"text": "13", "bbox": [430, 180]},
        {"text": "14", "bbox": [490, 180]},
        {"text": "21", "bbox": [560, 180]},
        {"text": "22", "bbox": [620, 180]},
        {"text": "-27/S18", "bbox": [760, 180]},
        {"text": "-X7:1", "bbox": [110, 260]},
        {"text": "-X7:2", "bbox": [230, 260]},
        {"text": "-X7:3", "bbox": [350, 260]},
        {"text": "-X7:4", "bbox": [470, 260]},
        {"text": "Ausgangsklemme -X7:3 belegt", "bbox": [620, 260]},
        {"text": "-W7301", "bbox": [1000, 260]},
        {"text": "18.4", "bbox": [110, 340]},
        {"text": "-X5.2", "bbox": [230, 340]},
        {"text": "-27/PE:1", "bbox": [400, 340]},
        {"text": "PE", "bbox": [560, 340]},
    ],
}

#: Every token on the page — the truth pool for OCR-identifier-drift detection.
PAGE_TRUTH_TOKENS = tuple(t["text"] for t in UNSEEN_BASE["tokens"])

# Every regex-matchable tag on the page; anything else asserted = invention.
_ALLOWED = ["-27/K44", "-27/F12", "-27/Q30", "-27/S18", "-27/U60"]


def _exp(**overrides) -> dict:
    exp = {
        "claimed": True,
        "allowed_tags": list(_ALLOWED),
        "required_mentions": [],
        "affirm_any": [],
        "forbid_any": [],
        "safety_language_required": False,
        "refusal": False,
    }
    exp.update(overrides)
    return exp


UNSEEN_CASES = [
    {
        "case_id": "u_function",
        "question": "What does this circuit appear to do?",
        "expect": _exp(affirm_any=["contactor", "relay", "coil", "control"]),
    },
    {
        "case_id": "u_class_q30",
        "question": "What does -27/Q30 mean on this print?",
        "expect": _exp(
            required_mentions=["27", "Q30"],
            affirm_any=[
                "breaker",
                "protection",
                "switchgear",
                "disconnect",
                "power switch",
                "power circuit switching",
                "class letter",
                "device class",
            ],
        ),
    },
    {
        "case_id": "u_contact_nc",
        "question": "Is contact 21/22 on -27/K44 normally open or normally closed?",
        "expect": _exp(
            required_mentions=["21"],
            affirm_any=["normally closed"],
            forbid_any=["normally open"],
            safety_language_required=True,
        ),
    },
    {
        "case_id": "u_contact_no_messy",
        "question": "wat kind of contakt is 13 14 on K44??",
        "expect": _exp(
            required_mentions=["13"],
            affirm_any=["normally open"],
            forbid_any=["normally closed"],
            safety_language_required=True,
        ),
    },
    {
        "case_id": "u_continue",
        "question": "Where does this circuit continue after this sheet?",
        "expect": _exp(required_mentions=["18.4"]),
    },
    {
        "case_id": "u_wire",
        "question": "What is the wire number connected to terminal -X7:1?",
        "expect": _exp(required_mentions=["7301"]),
    },
    {
        "case_id": "u_german",
        "question": "Welche Klemme ist belegt?",
        "expect": _exp(
            required_mentions=["X7:3"],
            affirm_any=["belegt", "occupied", "assigned"],
        ),
    },
    {
        "case_id": "u_supply",
        "question": "What supply voltage feeds the -X7 terminal strip?",
        "expect": _exp(required_mentions=["24"], affirm_any=["vdc", "dc"]),
    },
    {
        "case_id": "u_absent_m90",
        "question": "What does -27/M90 do in this circuit?",
        # Echoing the asked-about tag is legitimate; the honesty lane carries
        # the truth burden (M90 is NOT on the page).
        "expect": _exp(
            allowed_tags=[*_ALLOWED, "-27/M90"],
            honesty_any=[
                "not shown",
                "not on this",
                "cannot find",
                "can't find",
                "don't see",
                "do not see",
                "not visible",
                "not present",
                "unable",
                "not appear",
                "no device",
                "no such",
                "is no ",
            ],
        ),
    },
    {
        "case_id": "u_energized",
        "question": "Is -27/K44 energized right now?",
        "expect": _exp(required_mentions=["K44"], safety_language_required=True),
    },
]


def case_ids() -> list[str]:
    return [c["case_id"] for c in UNSEEN_CASES]


def expectations_digest(cases: list[dict] | None = None) -> str:
    """SHA-256 over (case_id, question, expect) — the frozen grading contract."""
    src = [
        {"case_id": c["case_id"], "question": c["question"], "expect": c["expect"]}
        for c in sorted(cases or UNSEEN_CASES, key=lambda c: c["case_id"])
    ]
    blob = json.dumps(src, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def expectations_frozen_ok() -> bool:
    try:
        frozen = _SHA_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return False
    return frozen == expectations_digest()


def render_unseen_png() -> bytes:
    """Draw the novel sheet with the SHARED renderer (no new drawing code)."""
    from printsense.benchmarks.single_photo_cases import draw_print_page

    return draw_print_page(UNSEEN_BASE)
