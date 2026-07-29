"""Committed synthetic North-American homoglyph corpus (designation regression).

Every case is 100% FICTIONAL — panel ``PNL-99``, sheet 99, ``X9…`` / ``P9…`` /
``MTR-99`` tags, fictional title text. No customer, project, site, drawing or
person content; ``truth_status: "synthetic"`` on every case.

WHY A SEPARATE CORPUS. ``golden_corpus.py`` is truth-frozen against a committed
``golden_corpus.sha256`` and is IEC-flavoured. This corpus covers the North
American / Rockwell convention and the homoglyph error class, and carries its
OWN frozen digest so the two never entangle.

WHAT IT GUARDS. A vision model that reads an alphanumeric designation may
collapse a letter into its look-alike digit — measured on a real acceptance
corpus as a PLC I/O wire number losing a character in 16 of 16 cases. The cases
below place BOTH members of each required homoglyph pair on the same sheet:

    I/1   X9I1-A   alongside   X911-F
    O/0   X9O0-B   alongside   X900-G
    S/5   X9S5-C   alongside   X955-H
    B/8   X9B8-D   alongside   X988-J
    Z/2   X9Z2-E   alongside   X922-K

That pairing is the point. A fixture containing only ``X9I1-A`` could be passed
by a model that blindly prefers letters; a fixture containing only ``X911-F``
could be passed by one that blindly prefers digits. Both must be read correctly
on the same page, so the ONLY way through is transcribing what is printed.

OCR-confusion policy (same doctrine as ``golden_corpus``): confusable readings
are encoded as ``known_misreads`` — wrong forms whose ASSERTION is a hard
failure — never as accept-sets. Digit/letter drift is the error being measured.

Cases are OCR-decoupled ``{"text","bbox","line"}`` token streams, so grading is
hermetic (no Tesseract, no rendering, no network). :func:`render_page` can draw
a case deterministically from these committed tokens for an authorized live run
— the image is generated, never stored.
"""

from __future__ import annotations

import hashlib
import json

CORPUS_VERSION = "homoglyph_corpus_v1"

#: The five pairs the directive requires, each as (letter_form, digit_form).
REQUIRED_PAIRS = (
    ("X9I1-A", "X911-F"),
    ("X9O0-B", "X900-G"),
    ("X9S5-C", "X955-H"),
    ("X9B8-D", "X988-J"),
    ("X9Z2-E", "X922-K"),
)


def _tok(text: str, x: int, y: int, w: int = 60, h: int = 18, group: int = 0) -> dict:
    return {"text": text, "bbox": [x, y, x + w, y + h], "line": (group, y)}


def _row(y: int, *parts: tuple[str, int], group: int = 0) -> list[dict]:
    return [_tok(t, x, y, group=group) for t, x in parts]


def _homoglyph_tokens() -> list[dict]:
    """Both members of every pair, one pair per row, plus the PLC I/O run."""
    toks: list[dict] = []
    y = 120
    for letter_form, digit_form in REQUIRED_PAIRS:
        toks += _row(y, (letter_form, 90), ("BLU", 300), ("#18", 360), (digit_form, 520))
        y += 60
    # The measured defect shape: a DI (digital input) letter run inside a wire
    # number, with its cross-reference. Fictional panel/channel numbers.
    toks += _row(y, ("P9DI900-0", 90), ("BLU", 300), ("#18", 360), ("PLC", 520), ("P9-DI9-00", 580))
    return toks


CASES: list[dict] = [
    {
        "case_id": "na_homoglyph_wire_numbers",
        "kind": "north_american_wire_list",
        "description": (
            "Fictional NA panel wire list. Both members of each homoglyph pair "
            "appear on the same sheet, plus a PLC I/O wire number with a DI run."
        ),
        "truth_status": "synthetic",
        "page": 99,
        "page_width": 1400,
        "tokens": _homoglyph_tokens(),
        "truth": {
            "wire_designations": [
                *[f for pair in REQUIRED_PAIRS for f in pair],
                "P9DI900-0",
            ],
            # Asserting any of these is a hard failure: each is the homoglyph
            # collapse (or expansion) of a designation actually printed above.
            "known_misreads": [
                "X911-A",  # I -> 1
                "X900-B",  # O -> 0
                "X955-C",  # S -> 5
                "X988-D",  # B -> 8
                "X922-E",  # Z -> 2
                "X9I1-F",  # 1 -> I  (the reverse error)
                "X9O0-G",  # 0 -> O
                "X9S5-H",  # 5 -> S
                "X9B8-J",  # 8 -> B
                "X9Z2-K",  # 2 -> Z
                "P9D900-0",  # the DI run collapsed
            ],
        },
    },
    {
        "case_id": "na_rockwell_addressing",
        "kind": "north_american_io_map",
        "description": "Fictional Rockwell address forms — punctuation is part of the tag.",
        "truth_status": "synthetic",
        "page": 99,
        "page_width": 1400,
        "tokens": _row(120, ("I:9/0", 90), ("O:9/7", 260), ("B93:0/1", 430), ("N97:20", 620))
        + _row(180, ("T94:1.DN", 90), ("MTR-99", 260), ("CR9-13", 430), ("PB9-START", 620)),
        "truth": {
            "wire_designations": [],
            "device_designations": [
                "I:9/0",
                "O:9/7",
                "B93:0/1",
                "N97:20",
                "T94:1.DN",
                "MTR-99",
                "CR9-13",
                "PB9-START",
            ],
            "known_misreads": [
                "I:9/O",  # 0 -> O in an address
                "B93:O/1",
                "N97:2O",
                "T94:1.ON",  # DN -> ON
                "MTR-99A",  # invented suffix
            ],
        },
    },
]


def get_case(case_id: str) -> dict:
    """One case by id."""
    for c in CASES:
        if c["case_id"] == case_id:
            return c
    raise KeyError(f"no such case: {case_id!r}")


def expected_wire_rubric(case_id: str) -> dict:
    """A rubric in the shape :func:`printsense.designation_metrics.measure` consumes."""
    truth = get_case(case_id)["truth"]
    return {
        "categories": {
            "wire": {
                "expected": list(truth.get("wire_designations") or []),
                "known_misreads": list(truth.get("known_misreads") or []),
            }
        }
    }


def truth_digest(cases: list[dict] | None = None) -> str:
    """Stable SHA-256 over every case's truth — the freeze.

    Covers case_id + truth only (never bboxes or descriptions), so cosmetic
    layout edits do not churn the digest but a truth change is always loud.
    """
    payload = [
        {"case_id": c["case_id"], "truth": c["truth"]}
        for c in (cases if cases is not None else CASES)
    ]
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def render_page(case_id: str) -> bytes:
    """Render a case deterministically from its committed tokens (PIL, lazy).

    For an authorized LIVE acceptance run only — CI grades the token stream and
    never needs an image, so no PNG is ever committed. Verified byte-identical
    across calls.

    Cosmetic caveat: ``draw_print_page`` stamps a fixed ``BLATT <n>`` header, so
    a rendered NA sheet carries a German sheet label. It sits outside the token
    band and does not touch the graded truth. Left as-is deliberately —
    ``single_photo_cases.py`` is an import-only, never-edited guarded file.
    """
    from printsense.benchmarks.single_photo_cases import draw_print_page  # noqa: PLC0415

    case = get_case(case_id)
    return draw_print_page(
        {
            "page": case["page"],
            "page_width": case["page_width"],
            "tokens": case["tokens"],
        }
    )
