"""Committed synthetic golden corpus for the PrintSense capability bench (Phase 1).

Every case is 100% FICTIONAL (sheets 90-99, K9xx/Q9xx/S9xx/X9xx/-W509x tags,
fictional title text). No customer, project, site, drawing, or person content —
`truth_status: "synthetic"` on every case (enforced repo-wide by
tests/printsense/test_privacy_guards.py::test_6).

Cases are OCR-DECOUPLED token streams: each fixture is the list of
``{"text","bbox","line"}`` word tokens that ``xref_extractor.lex_page`` (and the
Telegram concierge's deterministic processing) consume, so the bench is hermetic
— no Tesseract, no rendering, no network. Rendered-image robustness is a later
phase; the truth here is exact and deterministic.

Truth is FROZEN before tuning: ``truth_digest()`` hashes the truth of every case
and must equal the committed ``golden_corpus.sha256``. Editing truth is allowed
only as a loud, deliberate diff of both files (capability_bench treats a digest
mismatch as a hard failure).

OCR-confusion policy (grading doctrine): confusable readings (O/0, I/1, S/5,
B/8) are encoded as ``known_misreads`` — wrong forms whose ASSERTION is a hard
failure — never as accept-sets. Digit/letter drift is the error being measured.
"""

from __future__ import annotations

import hashlib
import json

CORPUS_VERSION = "golden_corpus_v1"


def _tok(text: str, x: int, y: int, w: int = 60, h: int = 18, group: int = 0) -> dict:
    return {"text": text, "bbox": [x, y, x + w, y + h], "line": (group, y)}


def _line(y: int, *parts: tuple[str, int], group: int = 0) -> list[dict]:
    """One visual text line. Margin cross-references sit in their own column
    on a drawing — model them with a distinct ``group`` so the lexer sees them
    as a separate line, exactly as OCR line segmentation does."""
    return [_tok(t, x, y, group=group) for t, x in parts]


# ---------------------------------------------------------------------------
# The cases. Shape:
#   case_id, kind, description, truth_status ("synthetic"), page, page_width,
#   tokens, page_index ({"sheets","anchors"} fed to resolve()),
#   profile_samples + title_text (fed to detect_profile),
#   truth: exact deterministic expectations (see capability_bench lanes).
# ---------------------------------------------------------------------------

CASES: list[dict] = [
    {
        "case_id": "iec_contactor_control",
        "kind": "control_page",
        "description": "Clean IEC/German contactor control page: coil, NO aux, resolved cross-sheet ref.",
        "truth_status": "synthetic",
        "page": "91",
        "page_width": 1400,
        "tokens": (
            _line(100, ("-91/K01", 110))
            + _line(140, ("A1", 118), ("A2", 178))
            + _line(180, ("13", 118), ("14", 178))
            + _line(100, ("92.1", 1200), ("/", 1262), ("K911", 1272), group=1)
        ),
        "page_index": {"sheets": {"92": "pg92"}, "anchors": {"92": ["K911"]}},
        "profile_samples": ["-91/K01", "=A9+S9-91/K01", "-91/K01:13"],
        "title_text": "Stromlaufplan Blatt 91",
        "truth": {
            "devices": [{"tag": "-91/K01", "bbox": [110, 100, 170, 118]}],
            "terminals": [
                {
                    "cp": "A1",
                    "parent_class": "K",
                    "convention_role": "coil_or_control_by_convention",
                },
                {
                    "cp": "A2",
                    "parent_class": "K",
                    "convention_role": "coil_or_control_by_convention",
                },
                {"cp": "13", "parent_class": "K", "convention_role": "NO_by_convention"},
                {"cp": "14", "parent_class": "K", "convention_role": "NO_by_convention"},
            ],
            "xrefs": [
                {
                    "raw": "92.1 / K911",
                    "pattern_class": "SHEET_COL_ANCHOR",
                    "resolution": "resolved",
                    "target_page": "pg92",
                    "bbox": [1200, 100, 1330, 118],
                }
            ],
            "cables": [],
            "grid_refs": [],
            "expected_profile": {"selected_in": ["eplan_iec"], "conflicts": []},
            "known_misreads": ["-91/KO1", "-91/K0I", "-9I/K01"],
            "expected_refusal": False,
            "expected_next_pages": [],
        },
    },
    {
        "case_id": "motor_starter_overload",
        "kind": "motor_starter",
        "description": "Motor starter with overload relay: 95/96 NC overload aux, main pole 1/L1.",
        "truth_status": "synthetic",
        "page": "92",
        "page_width": 1400,
        "tokens": (
            _line(100, ("-92/Q01", 110))
            + _line(140, ("95", 118), ("96", 178))
            + _line(180, ("1/L1", 118))
        ),
        "page_index": {"sheets": {}, "anchors": {}},
        "profile_samples": ["-92/Q01", "=A9+M9-92/Q01", "-92/Q01:95"],
        "title_text": "Stromlaufplan Blatt 92 Motorabgang",
        "truth": {
            "devices": [{"tag": "-92/Q01", "bbox": [110, 100, 170, 118]}],
            "terminals": [
                {"cp": "95", "parent_class": "Q", "convention_role": "overload_NC_by_convention"},
                {"cp": "96", "parent_class": "Q", "convention_role": "overload_NC_by_convention"},
            ],
            "xrefs": [],
            "cables": [],
            "grid_refs": [],
            "expected_profile": {"selected_in": ["eplan_iec"], "conflicts": []},
            "known_misreads": ["-92/QO1", "-92/Q0I"],
            "expected_refusal": False,
            "expected_next_pages": [],
        },
    },
    {
        "case_id": "estop_safety_chain",
        "kind": "safety_circuit",
        "description": "E-stop chain: NC contacts 21/22 in series; contact state must NEVER be claimed.",
        "truth_status": "synthetic",
        "page": "93",
        "page_width": 1400,
        "tokens": (
            _line(100, ("-93/S01", 110))
            + _line(140, ("21", 118), ("22", 178))
            + _line(200, ("-93/K02", 110))
            + _line(240, ("A1", 118), ("A2", 178))
        ),
        "page_index": {"sheets": {}, "anchors": {}},
        "profile_samples": ["-93/S01", "=A9+S9-93/S01", "-93/S01:21"],
        "title_text": "Stromlaufplan Blatt 93 NOT-AUS",
        "truth": {
            "devices": [
                {"tag": "-93/S01", "bbox": [110, 100, 170, 118]},
                {"tag": "-93/K02", "bbox": [110, 200, 170, 218]},
            ],
            "terminals": [
                {"cp": "21", "parent_class": "S", "convention_role": "NC_by_convention"},
                {"cp": "22", "parent_class": "S", "convention_role": "NC_by_convention"},
                {
                    "cp": "A1",
                    "parent_class": "K",
                    "convention_role": "coil_or_control_by_convention",
                },
            ],
            "xrefs": [],
            "cables": [],
            "grid_refs": [],
            "expected_profile": {"selected_in": ["eplan_iec"], "conflicts": []},
            "known_misreads": ["-93/501", "-93/SO1"],
            "expected_refusal": False,
            "expected_next_pages": [],
        },
    },
    {
        "case_id": "source_dependent_53_54",
        "kind": "control_page",
        "description": "53/54 add-on auxiliary: NO by convention; mirror/safety-rating claims forbidden.",
        "truth_status": "synthetic",
        "page": "94",
        "page_width": 1400,
        "tokens": _line(100, ("-94/K03", 110)) + _line(140, ("53", 118), ("54", 178)),
        "page_index": {"sheets": {}, "anchors": {}},
        "profile_samples": ["-94/K03", "=A9+K9-94/K03", "-94/K03:53"],
        "title_text": "Stromlaufplan Blatt 94",
        "truth": {
            "devices": [{"tag": "-94/K03", "bbox": [110, 100, 170, 118]}],
            "terminals": [
                {"cp": "53", "parent_class": "K", "convention_role": "NO_by_convention"},
                {"cp": "54", "parent_class": "K", "convention_role": "NO_by_convention"},
            ],
            # Source-dependent meaning: convention says NO; anything beyond that
            # (mirror contact, positively driven, safety-rated) is human-confirmed
            # territory and its unprompted assertion is a hard failure.
            "forbidden_assertions": ["mirror", "positively_driven", "safety_rated"],
            "xrefs": [],
            "cables": [],
            "grid_refs": [],
            "expected_profile": {"selected_in": ["eplan_iec"], "conflicts": []},
            "known_misreads": ["-94/KO3", "-94/K03:S3"],
            "expected_refusal": False,
            "expected_next_pages": [],
        },
    },
    {
        "case_id": "plc_digital_io",
        "kind": "plc_digital_io",
        "description": "PLC digital I/O page with terminal strip and a resolved ref to the analog sheet.",
        "truth_status": "synthetic",
        "page": "95",
        "page_width": 1400,
        "tokens": (
            _line(100, ("-95/A01", 110))
            + _line(140, ("-95/X91", 110))
            + _line(100, ("96.3", 1200), ("/", 1262), ("B961", 1272), group=1)
        ),
        "page_index": {"sheets": {"96": "pg96"}, "anchors": {"96": ["B961"]}},
        "profile_samples": ["-95/A01", "=A9+A9-95/A01", "-95/A01:13"],
        "title_text": "Stromlaufplan Blatt 95 SPS Digitaleingaenge",
        "truth": {
            "devices": [
                {"tag": "-95/A01", "bbox": [110, 100, 170, 118]},
                {"tag": "-95/X91", "bbox": [110, 140, 170, 158]},
            ],
            "terminals": [],
            "xrefs": [
                {
                    "raw": "96.3 / B961",
                    "pattern_class": "SHEET_COL_ANCHOR",
                    "resolution": "resolved",
                    "target_page": "pg96",
                    "bbox": [1200, 100, 1330, 118],
                }
            ],
            "cables": [],
            "grid_refs": [],
            "expected_profile": {"selected_in": ["eplan_iec"], "conflicts": []},
            "known_misreads": ["-95/AO1", "-95/X9I", "-B5/A01"],
            "expected_refusal": False,
            "expected_next_pages": [],
        },
    },
    {
        "case_id": "plc_analog_io_comma_decimal",
        "kind": "plc_analog_io",
        "description": "Analog I/O with IEC comma decimal (4,7k) that must never split a designation.",
        "truth_status": "synthetic",
        "page": "96",
        "page_width": 1400,
        "tokens": (
            _line(100, ("-96/B01", 110)) + _line(140, ("4,7k", 118)) + _line(180, ("-96/U01", 110))
        ),
        "page_index": {"sheets": {}, "anchors": {}},
        "profile_samples": ["-96/B01", "=A9+B9-96/B01", "-96/B01:12"],
        "title_text": "Stromlaufplan Blatt 96 Analogwerte",
        "truth": {
            "devices": [
                {"tag": "-96/B01", "bbox": [110, 100, 170, 118]},
                {"tag": "-96/U01", "bbox": [110, 180, 170, 198]},
            ],
            "terminals": [],
            "xrefs": [],
            "cables": [],
            "grid_refs": [],
            "expected_profile": {"selected_in": ["eplan_iec"], "conflicts": []},
            "known_misreads": ["-96/BO1", "-96/8O1"],
            "expected_refusal": False,
            "expected_next_pages": [],
            "value_tokens_never_devices": ["4,7k"],
        },
    },
    {
        "case_id": "terminal_plan",
        "kind": "terminal_plan",
        "description": "Terminal plan page: X strips only; no cross references exist.",
        "truth_status": "synthetic",
        "page": "97",
        "page_width": 1400,
        "tokens": _line(100, ("-97/X91", 110)) + _line(140, ("-97/X92", 110)),
        "page_index": {"sheets": {}, "anchors": {}},
        "profile_samples": ["-97/X91", "-97/X92"],
        "title_text": "Klemmenplan Blatt 97",
        "truth": {
            "devices": [
                {"tag": "-97/X91", "bbox": [110, 100, 170, 118]},
                {"tag": "-97/X92", "bbox": [110, 140, 170, 158]},
            ],
            "terminals": [],
            "xrefs": [],
            "cables": [],
            "grid_refs": [],
            "expected_profile": {"selected_in": ["eplan_iec", "unknown_european"], "conflicts": []},
            "known_misreads": ["-97/X9I"],
            "expected_refusal": False,
            "expected_next_pages": [],
        },
    },
    {
        "case_id": "cable_continuation",
        "kind": "cable_page",
        "description": "Cable continuation -W5091: must surface as unresolved_segment, never a page link.",
        "truth_status": "synthetic",
        "page": "98",
        "page_width": 1400,
        "tokens": _line(100, ("-W5091", 1210)),
        "page_index": {"sheets": {"92": "pg92"}, "anchors": {}},
        "profile_samples": ["-W5091"],
        "title_text": "Kabelplan Blatt 98",
        "truth": {
            "devices": [],
            "terminals": [],
            "xrefs": [
                {
                    "raw": "-W5091",
                    "pattern_class": "CABLE_CONT",
                    "resolution": "unresolved_segment",
                    "target_page": None,
                    "bbox": [1210, 100, 1270, 118],
                }
            ],
            "cables": ["-W5091"],
            "grid_refs": [],
            "expected_profile": {"selected_in": ["eplan_iec", "unknown_european"], "conflicts": []},
            "known_misreads": ["-W509I", "-WK5091"],
            "expected_refusal": False,
            "expected_next_pages": [],
        },
    },
    {
        "case_id": "cross_sheet_von_nach",
        "kind": "control_page",
        "description": "German continuation words: 'von Blatt 90' and 'nach Blatt 92' become sheet refs.",
        "truth_status": "synthetic",
        "page": "91",
        "page_width": 1400,
        "tokens": (
            _line(80, ("von", 1150), ("Blatt", 1200), ("90", 1265))
            + _line(120, ("nach", 1150), ("Blatt", 1200), ("92", 1265))
        ),
        "page_index": {"sheets": {"90": "pg90", "92": "pg92"}, "anchors": {}},
        "profile_samples": ["-91/K01"],
        "title_text": "Stromlaufplan Blatt 91",
        "truth": {
            "devices": [],
            "terminals": [],
            "xrefs": [
                {
                    "raw_contains": "90",
                    "pattern_class": "FROM_SHEET",
                    "resolution": "resolved",
                    "target_page": "pg90",
                },
                {
                    "raw_contains": "92",
                    "pattern_class": "TO_SHEET",
                    "resolution": "resolved",
                    "target_page": "pg92",
                },
            ],
            "cables": [],
            "grid_refs": [],
            "expected_profile": {"selected_in": ["eplan_iec", "unknown_european"], "conflicts": []},
            "known_misreads": [],
            "expected_refusal": False,
            "expected_next_pages": [],
        },
    },
    {
        "case_id": "grid_ref_stays_unresolved",
        "kind": "control_page",
        "description": "A bare grid reference (C4) must never auto-resolve to a page.",
        "truth_status": "synthetic",
        "page": "99",
        "page_width": 1400,
        "tokens": [_tok("C4", 1330, 100, w=30)],
        "page_index": {"sheets": {"4": "pg4"}, "anchors": {}},
        "profile_samples": [],
        "title_text": "",
        "truth": {
            "devices": [],
            "terminals": [],
            "xrefs": [
                {
                    "raw": "C4",
                    "pattern_class": "GRID_REF",
                    "resolution": "unresolved_segment",
                    "target_page": None,
                }
            ],
            "cables": [],
            "grid_refs": ["C4"],
            "expected_profile": {"selected_in": ["unknown_european"], "conflicts": []},
            "known_misreads": [],
            "expected_refusal": False,
            "expected_next_pages": [],
        },
    },
    {
        "case_id": "partial_crop_missing_context",
        "kind": "partial_crop",
        "description": "Cropped page referencing sheet 89 that is not in the package: must declare "
        "missing_target and recommend photographing sheet 89.",
        "truth_status": "synthetic",
        "page": "91",
        "page_width": 1400,
        "tokens": _line(100, ("89.2", 1200), ("/", 1262), ("K891", 1272)),
        "page_index": {"sheets": {"92": "pg92"}, "anchors": {"92": ["K911"]}},
        "profile_samples": ["-91/K01"],
        "title_text": "",
        "truth": {
            "devices": [],
            "terminals": [],
            "xrefs": [
                {
                    "raw": "89.2 / K891",
                    "pattern_class": "SHEET_COL_ANCHOR",
                    "resolution": "missing_target",
                    "target_page": None,
                    "bbox": [1200, 100, 1330, 118],
                }
            ],
            "cables": [],
            "grid_refs": [],
            "expected_profile": {"selected_in": ["eplan_iec", "unknown_european"], "conflicts": []},
            "known_misreads": [],
            "expected_refusal": False,
            "expected_next_pages": ["89"],
        },
    },
    {
        "case_id": "contradictory_reference",
        "kind": "conflicting_refs",
        "description": "Lexical sheet number disagrees with the anchor's real home: contradictory.",
        "truth_status": "synthetic",
        "page": "91",
        "page_width": 1400,
        "tokens": _line(100, ("92.1", 1200), ("/", 1262), ("K931", 1272)),
        "page_index": {
            "sheets": {"92": "pg92", "93": "pg93"},
            "anchors": {"92": ["K921"], "93": ["K931"]},
        },
        "profile_samples": [],
        "title_text": "",
        "truth": {
            "devices": [],
            "terminals": [],
            "xrefs": [
                {
                    "raw": "92.1 / K931",
                    "pattern_class": "SHEET_COL_ANCHOR",
                    "resolution": "contradictory",
                    "target_page": "pg92",
                }
            ],
            "cables": [],
            "grid_refs": [],
            "expected_profile": {"selected_in": ["unknown_european"], "conflicts": []},
            "known_misreads": [],
            "expected_refusal": False,
            "expected_next_pages": [],
        },
    },
    {
        "case_id": "unreadable_page",
        "kind": "unreadable",
        "description": "Intentionally unreadable capture: zero claims allowed; refusal is the pass.",
        "truth_status": "synthetic",
        "page": "90",
        "page_width": 1400,
        "tokens": [],
        "page_index": {"sheets": {}, "anchors": {}},
        "profile_samples": [],
        "title_text": "",
        "truth": {
            "devices": [],
            "terminals": [],
            "xrefs": [],
            "cables": [],
            "grid_refs": [],
            "expected_profile": {"selected_in": ["unknown_european"], "conflicts": []},
            "known_misreads": [],
            "expected_refusal": True,
            "expected_next_pages": [],
        },
    },
    {
        "case_id": "nfpa_style_page",
        "kind": "profile_discrimination",
        "description": "NFPA-style digit-first tags: the profile detector must flag the conflict and "
        "never force eplan_iec.",
        "truth_status": "synthetic",
        "page": "12",
        "page_width": 1400,
        "tokens": _line(100, ("101CR", 110)) + _line(140, ("102M", 110)),
        "page_index": {"sheets": {}, "anchors": {}},
        "profile_samples": ["101CR", "102M", "1LS"],
        "title_text": "",
        "truth": {
            "devices": [],
            "terminals": [],
            "xrefs": [],
            "cables": [],
            "grid_refs": [],
            "expected_profile": {
                "selected_in": ["unknown_european"],
                "conflicts": ["NFPA-style digit-first tags present"],
            },
            "known_misreads": [],
            "expected_refusal": False,
            "expected_next_pages": [],
        },
    },
]


# ---------------------------------------------------------------------------
# Truth freeze
# ---------------------------------------------------------------------------


def truth_digest(cases: list[dict] | None = None) -> str:
    """SHA-256 over the canonical JSON of every case's truth (order-stable)."""
    src = [
        {"case_id": c["case_id"], "truth": c["truth"]}
        for c in sorted(cases or CASES, key=lambda c: c["case_id"])
    ]
    blob = json.dumps(src, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def case_ids() -> list[str]:
    return [c["case_id"] for c in CASES]
