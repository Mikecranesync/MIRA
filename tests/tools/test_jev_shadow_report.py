"""Pure-function tests for tools/qa/jev_shadow_report.py (no network, no DB)."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "jev_shadow_report", ROOT / "tools/qa/jev_shadow_report.py"
)
mod = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(mod)


def packet(*, chunks: int, decision: str, jev, reason=None, claim=False, tokens=None, total=1000):
    ag = {
        "decision": decision,
        "reason": "served" if decision == "answered" else "refusal_regex",
        "evidence_sufficient": chunks > 0,
        "ungrounded_unit_claim": claim,
        "jev_sufficient": jev,
        "jev_skipped_reason": reason,
        "jev_latency_ms": 120 if jev is not None else None,
        "jev_input_tokens": tokens,
    }
    return {
        "ids": {"turn_id": "t"},
        "environment": "staging",
        "answer_gate": ag,
        "retrieval": {
            "strategy": "oem_corpus_bm25" if chunks else "skipped_general_mode",
            "executed": chunks > 0,
            "candidate_count": chunks,
            "returned_doc_ids": [f"https://x/a.pdf#p{i}" for i in range(chunks)],
        },
        "context": {
            "chunk_count": chunks,
            "visual_evidence_count": 0,
            "system_prompt_kind": "grounded" if chunks else "general",
        },
        "generation": {"served_provider": "Groq"},
        "timings_ms": {"generation": 400, "total": total},
    }


def test_categories_cover_every_disagreement_shape():
    c = mod.categorize
    assert (
        c(mod.flatten(packet(chunks=6, decision="insufficient_evidence", jev=0.05), source="x"))
        == "D1 refused_jev_low"
    )
    assert (
        c(mod.flatten(packet(chunks=6, decision="answered", jev=0.14, claim=True), source="x"))
        == "D2 answered_claim_jev_low"
    )
    assert (
        c(mod.flatten(packet(chunks=1, decision="answered", jev=0.05), source="x"))
        == "D3 answered_jev_low"
    )
    assert (
        c(mod.flatten(packet(chunks=3, decision="insufficient_evidence", jev=0.9), source="x"))
        == "D4 refused_jev_high"
    )
    assert c(mod.flatten(packet(chunks=3, decision="answered", jev=0.9), source="x")) == "A agree"
    assert (
        c(mod.flatten(packet(chunks=3, decision="answered", jev=0.5), source="x")) == "U uncertain"
    )
    assert (
        c(
            mod.flatten(
                packet(chunks=0, decision="answered", jev=None, reason="no_evidence"), source="x"
            )
        )
        == "skipped:no_evidence"
    )
    # A packet from a build that predates the shadow has no jev keys at all → never "eligible".
    pre = packet(chunks=3, decision="answered", jev=None)
    del pre["answer_gate"]["jev_skipped_reason"]
    assert c(mod.flatten(pre, source="x")) == "pre_shadow"


def test_report_flags_config_defects_and_invariant_violations(tmp_path: Path):
    rows = [
        mod.flatten(
            packet(chunks=6, decision="answered", jev=0.9, tokens=300),
            source="db",
            trace_id="a" * 32,
        ),
        mod.flatten(
            packet(chunks=0, decision="answered", jev=None, reason="no_evidence"),
            source="db",
            trace_id="b" * 32,
        ),
        mod.flatten(
            packet(chunks=4, decision="answered", jev=None, reason="disabled"),
            source="db",
            trace_id="c" * 32,
        ),
    ]
    rc = mod.report(rows, tmp_path / "r.md", tmp_path / "r.csv", baseline=[])
    md = (tmp_path / "r.md").read_text()
    assert rc == 1, "a disabled/no_key packet on staging is a config defect, never evidence"
    assert "DEFECT" in md and "cccccccccccc" in md
    assert "judged: 1" in md
    assert "Zero-chunk turns never call Jev: OK" in md
    assert "$0.000013" in md  # 300 tokens × $0.042/M
    assert (tmp_path / "r.csv").read_text().count("\n") == 4  # header + 3 rows


def test_zero_chunk_call_is_a_violation(tmp_path: Path):
    bad = mod.flatten(
        packet(chunks=0, decision="answered", jev=0.4), source="db", trace_id="d" * 32
    )
    rc = mod.report([bad], tmp_path / "r.md", tmp_path / "r.csv", baseline=[])
    assert rc == 1
    assert "Every judged turn had chunks: VIOLATED" in (tmp_path / "r.md").read_text()


def test_artifact_rows_carry_trace_and_scenario(tmp_path: Path):
    art = {
        "base": "https://app-staging.factorylm.com",
        "ran_at": "2026-09-22T09:36:00Z",
        "rows": [
            {
                "scenario": "2 empty notebook + resolved Siemens identity",
                "trace_id": "e" * 32,
                "wire": {"status": "insufficient_evidence", "citations": 0},
                "packet": packet(chunks=6, decision="insufficient_evidence", jev=0.05),
            },
        ],
    }
    f = tmp_path / "retrieval-acceptance.json"
    f.write_text(json.dumps(art))
    rows = mod.rows_from_artifact(f, source="file:x")
    assert (
        rows[0]["trace_id"] == "e" * 32
        and rows[0]["scenario"] == "2"
        and rows[0]["wire_status"] == "insufficient_evidence"
    )
    # No text fields ever reach a row.
    assert not any(
        k in rows[0] for k in ("content_head", "message", "user_question", "recommendation")
    )
