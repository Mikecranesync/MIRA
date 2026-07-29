"""Phase-3 session corpus — multi-photo + continuing-chat benchmark sessions.

Testing-program Phase 3: a technician starts with a partial view and adds
pages; PrintSense must name what's missing, absorb the added page WITHOUT
contradicting proven facts, refuse to combine non-print images, and survive
restarts (the durable ``PhotoBatchQueue`` is production's promise).

Each SESSION is a scripted sequence of photo-batch turns over synthetic pages
(same fictional universe as the frozen Phase-1/2 corpus: sheets 9x, K9xx).
Two run modes share the sessions, exactly like Phase 2:

* HERMETIC — ``scripted`` supplies per-turn vision classifications and a
  canned package reply, so CI drives the REAL album rung
  (``bot._try_multi_photo_printsense_reply``) end-to-end at $0.
* LIVE — pages render via the shared print renderer and the real paid
  interpreter answers; the SAME expectations grade the reply. Live runs are
  bounded (``PHASE3_LIVE_SESSION_IDS``).

Expectations are frozen (``session_digest`` vs ``session_cases.sha256``) —
editing them is a loud, deliberate two-file diff. ``scripted`` replies are
hermetic INPUTS, not truth, and stay outside the digest.
"""

from __future__ import annotations

import hashlib
import json

from .single_photo_cases import draw_print_page

PHASE3_VERSION = "session_cases_v1"

# Live-mode bound: which sessions the paid `/printsense_test phase3` runs.
# Each batch turn is one paid package interpretation (1-4 min on gpt-5.5).
PHASE3_LIVE_SESSION_IDS = ("s1_continuation", "s2_nonprint_refuse")
PHASE3_COST_CEILING_USD = 2.0

# ── synthetic pages (fictional; token layout mirrors the Phase-2 bases) ──────
PAGES: dict[str, dict] = {
    # The Phase-2 partial-crop page: BLATT 91 with an off-page reference to
    # sheet 89 (89.2 / K891) that THIS page cannot resolve.
    "crop91": {
        "page": 91,
        "page_width": 1400,
        "tokens": [
            {"text": "-91/K01", "bbox": [180, 140, 300, 165]},
            {"text": "A1  A2", "bbox": [430, 240, 540, 265]},
            {"text": "13  14", "bbox": [430, 320, 540, 345]},
            {"text": "89.2 / K891", "bbox": [1050, 140, 1250, 165]},
        ],
    },
    # The adjacent sheet that RESOLVES the continuation: K891's coil lands on
    # terminal -X4.6 at grid 89.2, with a back-reference to sheet 91.
    "p89": {
        "page": 89,
        "page_width": 1400,
        "tokens": [
            {"text": "K891", "bbox": [200, 140, 300, 165]},
            {"text": "A1  A2", "bbox": [430, 240, 540, 265]},
            {"text": "-X4.6", "bbox": [700, 320, 800, 345]},
            {"text": "91.2 / K01", "bbox": [1050, 140, 1250, 165]},
        ],
    },
    # German-labelled supply/heater sheet (interpreter prompt carries the
    # glossary; the grader only pins concept words, not translation prose).
    "p90de": {
        "page": 90,
        "page_width": 1400,
        "tokens": [
            {"text": "Versorgung 230V", "bbox": [180, 140, 380, 165]},
            {"text": "-90/E1  Heizung", "bbox": [430, 240, 640, 265]},
            {"text": "Klemme -X2.1", "bbox": [700, 320, 860, 345]},
        ],
    },
    # A conflicting revision of BLATT 91: same devices, but the auxiliary
    # contact pair differs (21 22 where rev A shows 13 14).
    "p91revB": {
        "page": 91,
        "page_width": 1400,
        "tokens": [
            {"text": "-91/K01", "bbox": [180, 140, 300, 165]},
            {"text": "A1  A2", "bbox": [430, 240, 540, 265]},
            {"text": "21  22", "bbox": [430, 320, 540, 345]},
            {"text": "REV B", "bbox": [1050, 820, 1150, 845]},
            {"text": "89.2 / K891", "bbox": [1050, 140, 1250, 165]},
        ],
    },
}

# Tags legal anywhere in this universe (tag-invention lane = anything
# tag-shaped outside this union is invention).
SESSION_ALLOWED_TAGS = ["-91/K01", "K911", "K891", "-X4.6", "-90/E1", "K01"]

SESSIONS: list[dict] = [
    {
        "session_id": "s1_continuation",
        "about": "crop -> names missing sheet 89 -> add sheet 89 -> resolves, keeps facts",
        "turns": [
            {
                "turn_id": "t1_crop",
                "kind": "batch",
                "pages": ["crop91"],
                "caption": "were does this go",
                "expect": {
                    "claimed": True,
                    "required_mentions": ["89"],
                    "affirm_any": [],
                    "honesty_any": [
                        "not in",
                        "not visible",
                        "missing",
                        "can't",
                        "cannot",
                        "not shown",
                    ],
                    "forbid_assert": [],
                    "facts_keep": [],
                },
                "scripted": {
                    "classifications": ["ELECTRICAL_PRINT"],
                    "reply": (
                        "The reference 89.2 / K891 points to sheet 89, which is "
                        "not in this photo — I can't confirm the far side. "
                        "Photograph sheet 89 to resolve it."
                    ),
                },
            },
            {
                "turn_id": "t2_resolved",
                "kind": "batch",
                "pages": ["crop91", "p89"],
                "caption": "here is sheet 89 where does it land",
                "expect": {
                    "claimed": True,
                    "required_mentions": ["K891", "89"],
                    "affirm_any": [],
                    "honesty_any": [],
                    "forbid_assert": [],
                    # Evidence accumulation: the resolved continuation must keep
                    # naming the tag proven in turn 1's reference.
                    "facts_keep": ["K891"],
                },
                "scripted": {
                    "classifications": ["ELECTRICAL_PRINT", "ELECTRICAL_PRINT"],
                    "reply": (
                        "With sheet 89 in view the continuation resolves: the "
                        "89.2 / K891 reference from sheet 91 lands on K891, "
                        "whose circuit terminates at -X4.6. The back-reference "
                        "91.2 / K01 returns to sheet 91."
                    ),
                },
            },
        ],
    },
    {
        "session_id": "s2_nonprint_refuse",
        "about": "a non-print image mixed into a print set must not combine",
        "turns": [
            {
                "turn_id": "t1_mixed",
                "kind": "batch",
                "pages": ["crop91", "__nonprint__"],
                "caption": "wat does this do",
                "expect": {
                    "claimed": False,
                    "required_mentions": [],
                    "affirm_any": [],
                    "honesty_any": [],
                    "forbid_assert": [],
                    "facts_keep": [],
                },
                "scripted": {
                    "classifications": ["ELECTRICAL_PRINT", "EQUIPMENT_PHOTO"],
                    "reply": "(never reached — the all-print gate must refuse the mix)",
                },
            }
        ],
    },
    {
        "session_id": "s3_duplicates",
        "about": "the same page twice must not invent devices or fail",
        "turns": [
            {
                "turn_id": "t1_dup",
                "kind": "batch",
                "pages": ["crop91", "crop91"],
                "caption": "what does this circuit do",
                "expect": {
                    "claimed": True,
                    "required_mentions": ["K01"],
                    "affirm_any": [],
                    "honesty_any": [],
                    "forbid_assert": [],
                    "facts_keep": [],
                },
                "scripted": {
                    "classifications": ["ELECTRICAL_PRINT", "ELECTRICAL_PRINT"],
                    "reply": (
                        "Both photos show the same sheet 91. -91/K01 is the "
                        "contactor coil (A1/A2) with its 13/14 auxiliary "
                        "contact; the circuit continues at 89.2 / K891."
                    ),
                },
            }
        ],
    },
    {
        "session_id": "s4_out_of_order",
        "about": "pages arriving out of order still resolve the reference",
        "turns": [
            {
                "turn_id": "t1_reversed",
                "kind": "batch",
                "pages": ["p89", "crop91"],
                "caption": "how do these connect",
                "expect": {
                    "claimed": True,
                    "required_mentions": ["K891"],
                    "affirm_any": [],
                    "honesty_any": [],
                    "forbid_assert": [],
                    "facts_keep": [],
                },
                "scripted": {
                    "classifications": ["ELECTRICAL_PRINT", "ELECTRICAL_PRINT"],
                    "reply": (
                        "Sheet 89 and sheet 91 connect through the K891 "
                        "reference: 89.2 / K891 on sheet 91 lands at -X4.6 on "
                        "sheet 89."
                    ),
                },
            }
        ],
    },
    {
        "session_id": "s5_german",
        "about": "German-labelled page answers with the right concepts",
        "turns": [
            {
                "turn_id": "t1_german",
                "kind": "batch",
                "pages": ["p90de"],
                "caption": "wat is this",
                "expect": {
                    "claimed": True,
                    "required_mentions": ["E1"],
                    "affirm_any": ["supply", "versorgung", "heater", "heizung"],
                    "honesty_any": [],
                    "forbid_assert": [],
                    "facts_keep": [],
                },
                "scripted": {
                    "classifications": ["ELECTRICAL_PRINT"],
                    "reply": (
                        "Sheet 90 is a 230V supply (Versorgung) feeding heater "
                        "-90/E1 (Heizung) through terminal -X2.1."
                    ),
                },
            }
        ],
    },
    {
        "session_id": "s6_revision_conflict",
        "about": "two revisions of one sheet must be flagged, not silently merged",
        "turns": [
            {
                "turn_id": "t1_conflict",
                "kind": "batch",
                "pages": ["crop91", "p91revB"],
                "caption": "these are the same sheet right",
                "expect": {
                    "claimed": True,
                    "required_mentions": ["K01"],
                    "affirm_any": [],
                    "honesty_any": [
                        "differ",
                        "conflict",
                        "revision",
                        "mismatch",
                        "not match",
                        "two versions",
                        "inconsistent",
                    ],
                    "forbid_assert": [],
                    "facts_keep": [],
                },
                "scripted": {
                    "classifications": ["ELECTRICAL_PRINT", "ELECTRICAL_PRINT"],
                    "reply": (
                        "These two photos are BOTH sheet 91 but they differ: "
                        "one shows a 13/14 auxiliary contact on -91/K01, the "
                        "other (marked REV B) shows 21/22. Confirm which "
                        "revision is installed before trusting either."
                    ),
                },
            }
        ],
    },
]


def session_ids() -> list[str]:
    return [s["session_id"] for s in SESSIONS]


def render_page_png(page_key: str) -> bytes:
    """Render one session page (or the shared non-print image)."""
    if page_key == "__nonprint__":
        from .single_photo_cases import CASES, render_case_png  # noqa: PLC0415

        nonprint = next(c for c in CASES if c["expect"].get("claimed") is False)
        return render_case_png(nonprint)
    return draw_print_page(PAGES[page_key])


def session_digest(sessions: list[dict] | None = None) -> str:
    """SHA-256 over the grading contract: ids, turns, pages, captions, expect.
    Scripted replies/classifications are hermetic inputs, not truth."""
    src = []
    for s in sorted(sessions or SESSIONS, key=lambda s: s["session_id"]):
        src.append(
            {
                "session_id": s["session_id"],
                "turns": [
                    {
                        "turn_id": t["turn_id"],
                        "kind": t["kind"],
                        "pages": t["pages"],
                        "caption": t["caption"],
                        "expect": t["expect"],
                    }
                    for t in s["turns"]
                ],
            }
        )
    blob = json.dumps(
        {"allowed_tags": sorted(SESSION_ALLOWED_TAGS), "sessions": src},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()
