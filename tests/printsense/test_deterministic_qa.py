"""UNSEEN-1 acceptance tests — deterministic print-QA fast-path (module level).

Hermetic: no network, no SDKs, no model. Proves the closed-form question
classes are answered from the deterministic spine with evidence + citation +
caveat, that insufficiency falls through, and that the unseen probe content is
NOT woven into calibration corpora or prompts."""

from __future__ import annotations

import pathlib

from printsense import deterministic_qa as dq
from printsense.benchmarks.single_photo_grader import _SAFETY_MARKERS, _STATE_CLAIM_RE

VD = {
    "ocr_items": [
        "-27/K44",
        "A1",
        "A2",
        "13",
        "14",
        "21",
        "22",
        "-27/S18",
        "-X7:1",
        "-X7:2",
        "-X7:3",
        "-X7:4",
        "-W7301",
        "18.4",
        "-X5.2",
        "-27/PE:1",
        "-27/Q30",
        "-27/F12",
    ],
    "drawing_type": "control circuit",
}


def _ans(question, vd=VD):
    return dq.try_deterministic_answer(question, vd)


# ── contact conventions ──────────────────────────────────────────────────────


def test_21_22_cannot_be_answered_no():
    r = _ans("Is contact 21/22 on -27/K44 normally open or normally closed?")
    assert r and r["question_class"] == "contact_convention"
    low = r["answer"].lower()
    assert "normally closed" in low
    assert "normally open" not in low  # the benchmark's wrong answer is unreachable


def test_13_14_and_53_54_resolve_no():
    for q in ("wat kind of contakt is 13 14 on K44??", "what about contact 53/54 on -27/K44?"):
        r = _ans(q)
        assert r, q
        low = r["answer"].lower()
        assert "normally open" in low and "normally closed" not in low, q


def test_95_96_stays_device_gated():
    r = _ans("is 95/96 on -27/K44 normally closed?")
    assert r is not None
    low = r["answer"].lower()
    assert "overload" in low and "legend" in low  # gated wording, not a flat verdict
    assert "is normally closed (nc) auxiliary" not in low
    # compatible device class (F) keeps the documented overload-NC verdict
    vd_f = {"ocr_items": ["-27/F12", "95", "96"], "drawing_type": "control circuit"}
    r_f = _ans("is contact 95/96 on -27/F12 normally closed?", vd_f)
    assert r_f and "normally closed" in r_f["answer"].lower()


def test_a1_a2_is_coil_with_unknown_polarity():
    r = _ans("what is A1/A2 on -27/K44?")
    assert r and "coil" in r["answer"].lower()
    assert "polarity" in r["answer"].lower()


# ── designation / class letter ───────────────────────────────────────────────


def test_designation_meaning_from_class_registry():
    r = _ans("What does -27/Q30 mean on this print?")
    assert r and r["question_class"] == "designation_meaning"
    low = r["answer"].lower()
    assert "q30" in low and "breaker" in low and "legend" in low


# ── cross-reference + wire lookup (novel-sheet surfacing) ────────────────────


def test_xref_18_4_surfaced_from_novel_sheet():
    r = _ans("Where does this circuit continue after this sheet?")
    assert r and r["question_class"] == "xref_lookup"
    assert "18.4" in r["answer"]
    assert "binds" in r["answer"] or "geometry" in r["answer"]  # no OCR-only binding claim


def test_xref_insufficient_evidence_falls_through():
    assert _ans("Where does this circuit continue?", {"ocr_items": ["-27/K44"]}) is None


def test_wire_w7301_surfaced_from_novel_sheet():
    r = _ans("What is the wire number connected to terminal -X7:1?")
    assert r and r["question_class"] == "wire_lookup"
    assert "-W7301" in r["answer"]


def test_wire_ambiguity_not_promoted_to_fact():
    vd = {"ocr_items": ["-W7301", "-W7302"], "drawing_type": "control circuit"}
    r = _ans("what wire number goes to -X7:1?", vd)
    assert r is not None
    assert "-W7301" in r["answer"] and "-W7302" in r["answer"]
    assert "cannot bind" in r["answer"].lower() or "cannot" in r["answer"].lower()
    assert "0.6" in r["confidence"]  # explicitly downgraded


def test_wire_no_evidence_falls_through():
    assert _ans("what is the wire number here?", {"ocr_items": ["13", "14"]}) is None


# ── state honesty ────────────────────────────────────────────────────────────


def test_state_question_answers_structural_honesty_without_state_claim():
    r = _ans("Is -27/K44 energized right now?")
    assert r and r["question_class"] == "state_honesty"
    assert _STATE_CLAIM_RE.search(r["reply_text"]) is None  # never trips the grader
    assert "-27/K44" in r["answer"]


# ── fall-through honesty ─────────────────────────────────────────────────────


def test_open_theory_question_falls_through():
    assert _ans("What does this circuit appear to do?") is None


def test_do_question_about_absent_tag_falls_through():
    # "what does X do" is circuit reasoning, not a closed form — the model path
    # (which proved honest absence behavior) keeps owning it.
    assert _ans("What does -27/M90 do in this circuit?") is None


# ── answer contract: evidence, source, confidence, caveat ────────────────────


def test_reply_carries_evidence_source_confidence_and_safety_caveat():
    r = _ans("Is contact 21/22 on -27/K44 normally open or normally closed?")
    for key in ("answer", "evidence", "source", "confidence", "caveat", "reply_text"):
        assert r.get(key), key
    assert "IEC" in r["source"]
    low = r["reply_text"].lower()
    assert any(m in low for m in _SAFETY_MARKERS)


def test_evidence_pack_for_fallthrough_grounding():
    pack = dq.extract_evidence("What does this circuit appear to do?", VD)
    joined = "\n".join(pack["lines"])
    assert "21-22 = NC" in joined
    assert "13-14 = NO" in joined
    assert "18.4" in joined
    assert "-W7301" in joined


# ── no memorization: unseen content stays out of calibration + prompts ───────


def test_unseen_sheet_not_in_calibration_or_prompts():
    root = pathlib.Path(__file__).resolve().parents[2]
    guarded = [
        root / "printsense" / "benchmarks" / "single_photo_cases.py",
        root / "printsense" / "benchmarks" / "session_cases.py",
        root / "printsense" / "benchmarks" / "robustness_transforms.py",
        root / "mira-bots" / "shared" / "print_translator.py",
        root / "printsense" / "interpret.py",
    ]
    novel_tokens = ("-W7301", "-27/K44", "-27/Q30", "MCC4-PNL")
    for path in guarded:
        text = path.read_text(encoding="utf-8", errors="replace")
        for token in novel_tokens:
            assert token not in text, f"{token} leaked into {path.name}"
