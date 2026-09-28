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


def test_failed_acceptance_runs_are_included_and_labelled(monkeypatch, tmp_path: Path):
    """#3954 — a red acceptance run's turns are real measurements.

    Run 35721520600 went red on an unrelated classifier defect (#3953) while
    carrying the only three packets that had `jev_input_tokens`. Filtering to
    `--status success` dropped exactly the evidence the report exists to collect.
    """
    listed = {
        "calls": [],
        "runs": [
            {
                "databaseId": 2,
                "headSha": "b" * 40,
                "createdAt": "2026-09-22T12:00:00Z",
                "conclusion": "failure",
                "status": "completed",
            },
            {
                "databaseId": 1,
                "headSha": "a" * 40,
                "createdAt": "2026-09-22T09:36:00Z",
                "conclusion": "success",
                "status": "completed",
            },
            {
                "databaseId": 3,
                "headSha": "c" * 40,
                "createdAt": "2026-09-22T13:00:00Z",
                "conclusion": None,
                "status": "in_progress",
            },
        ],
    }

    def fake_gh(*args):
        listed["calls"].append(args)
        if args[0] == "run" and args[1] == "list":
            return json.dumps(listed["runs"])
        # `run download <id> -D <dir>` → drop one artifact with one judged turn
        rid, dest = args[2], args[4]
        d = Path(dest) / f"retrieval-acceptance-{rid}"
        d.mkdir(parents=True)
        (d / "retrieval-acceptance.json").write_text(
            json.dumps(
                {
                    "ran_at": "2026-09-22T12:00:00Z",
                    "rows": [
                        {
                            "scenario": "2 x",
                            "trace_id": rid * 8,
                            "wire": {"status": "answered"},
                            "packet": packet(chunks=6, decision="answered", jev=0.05, tokens=1681),
                        }
                    ],
                }
            )
        )
        return ""

    monkeypatch.setattr(mod, "_gh", fake_gh)
    rows = mod.rows_from_runs(10)
    # The list call must NOT filter on success.
    list_args = next(a for a in listed["calls"] if a[1] == "list")
    assert "--status" not in list_args, "failed runs must be listed too"
    # Both completed runs contribute; the in-progress one does not.
    assert {r["run_conclusion"] for r in rows} == {"failure", "success"}
    assert len(rows) == 2

    rc = mod.report(rows, tmp_path / "r.md", tmp_path / "r.csv", baseline=[])
    md = (tmp_path / "r.md").read_text()
    assert rc == 0
    assert "judged: 2" in md
    assert "went RED" in md and "run:2" in md
    # Measured cost is reported from the real token counts, not the stale estimate.
    assert "3362 input tokens" in md.replace(",", "")
    assert "1,200" not in md
    assert "run_conclusion" in (tmp_path / "r.csv").read_text()
