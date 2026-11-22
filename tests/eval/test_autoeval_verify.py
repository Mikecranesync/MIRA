"""Hermetic proofs for the deterministic quote verifier. No model, no network, no key."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

REPO = Path(os.environ.get("AUTOEVAL_REPO") or Path(__file__).resolve().parents[2])
SCRIPTS = Path(os.environ.get("AUTOEVAL_SCRIPTS") or REPO / "evals" / "scripts")
sys.path.insert(0, str(SCRIPTS))

import autoeval as cli  # noqa: E402
import autoeval_verify_cases as vc  # noqa: E402

DOC = "pf525-manual"
PASSAGE = (
    "Parameter P036 sets the motor overload current. If the drive faults with F004, check the\n"
    "   output wiring for a short before resetting the drive."
)
PASSAGES = [
    {"doc_id": DOC, "page": 41, "text": PASSAGE, "is_private": False},
    {"doc_id": DOC, "page": 42, "text": "Set P039 to 1 for stop mode 1.", "is_private": False},
]


def cand(quote: str, *, doc: str = DOC, page=41, cid: str = "c-1") -> dict:
    return {
        "case_id": cid,
        "question": "What does F004 mean and what do I check first?",
        "source_quote": quote,
        "source_doc": doc,
        "source_page": page,
        "status": "pending_review",
    }


def verdict(quote: str, **kw) -> str | None:
    return vc.verify_one(cand(quote, **kw), vc.index_passages(PASSAGES))


# ── the original quote is accepted; a mutated one is rejected ──────────────────


def test_verifier_accepts_the_original_quote(tmp_path):
    accepted, rejected = vc.verify(
        [cand("If the drive faults with F004, check the output wiring")], PASSAGES
    )
    assert len(accepted) == 1 and rejected == []
    assert accepted[0]["quote_verified"] is True and accepted[0]["verifier"] == vc.VERIFIER_VERSION


def test_verifier_rejects_a_mutated_quote(tmp_path):
    accepted, rejected = vc.verify(
        [cand("If the drive faults with F005, check the output wiring")], PASSAGES
    )
    assert accepted == [] and len(rejected) == 1
    assert "not verbatim" in rejected[0]["reject_reason"]


# ── normalisation is whitespace only ──────────────────────────────────────────


def test_whitespace_only_differences_are_accepted(tmp_path):
    # the passage holds a newline and three spaces where the quote has single spaces
    assert verdict("If the drive faults with F004,\n\t check the   output wiring") is None


def test_case_and_punctuation_are_not_normalised(tmp_path):
    assert verdict("if the drive faults with F004, check the output wiring") is not None
    assert verdict("If the drive faults with F004; check the output wiring") is not None


def test_quote_cited_to_the_wrong_page_is_rejected(tmp_path):
    # P039 is verbatim, but it is on page 42, so citing page 41 must fail
    assert verdict("Set P039 to 1 for stop mode 1.", page=41) is not None
    assert verdict("Set P039 to 1 for stop mode 1.", page=42) is None  # control


def test_quote_for_an_unknown_doc_is_rejected(tmp_path):
    assert "no supplied passage" in verdict("Set P039 to 1", doc="other-manual", page=42)


def test_empty_or_missing_quote_is_rejected_explicitly(tmp_path):
    assert verdict("") == "source_quote missing or empty"
    assert verdict("   \n  ") == "source_quote missing or empty"
    missing = {k: v for k, v in cand("x").items() if k != "source_quote"}
    assert vc.verify_one(missing, vc.index_passages(PASSAGES)) == "source_quote missing or empty"


def test_string_page_and_int_page_match_the_same_passage(tmp_path):
    assert verdict("Set P039 to 1 for stop mode 1.", page="42") is None


# ── CLI: files in, accepted.jsonl and rejected.jsonl out, no network ───────────


def test_cli_verify_writes_accepted_and_rejected_jsonl(tmp_path):
    cands = tmp_path / "candidates.jsonl"
    rows = [
        cand("Set P039 to 1 for stop mode 1.", page=42, cid="ok"),
        cand("Set P039 to 2 for stop mode 1.", page=42, cid="bad"),
    ]
    cands.write_text("".join(json.dumps(r) + "\n" for r in rows))
    passages = tmp_path / "passages.json"
    passages.write_text(json.dumps(PASSAGES))
    out = tmp_path / "out"
    assert (
        cli.main(
            [
                "verify",
                "--candidates",
                str(cands),
                "--passages",
                str(passages),
                "--out-dir",
                str(out),
            ]
        )
        == 0
    )
    accepted = [json.loads(ln) for ln in (out / "accepted.jsonl").read_text().splitlines()]
    rejected = [json.loads(ln) for ln in (out / "rejected.jsonl").read_text().splitlines()]
    assert [r["case_id"] for r in accepted] == ["ok"]
    assert [r["case_id"] for r in rejected] == ["bad"] and "reject_reason" in rejected[0]
