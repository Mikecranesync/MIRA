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


def packet(
    *,
    chunks: int,
    decision: str,
    jev,
    reason=None,
    claim=False,
    tokens=None,
    total=1000,
    visual: bool = False,
    version=None,
    obs=None,
    ledger: bool = False,
):
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
    if version is not None:
        ag["jev_instructions_version"] = version
    if obs is not None:
        ag["jev_observation_count"] = obs
    return {
        "ids": {"turn_id": "t"},
        "environment": "staging",
        "request": {"has_visual_evidence": visual},
        # `visual_evidence` is the per-turn truth; `context.visual_evidence_count`
        # ALSO counts the asset ledger (`ledger`), which is why the report must
        # not read it (Gate 7 substitute review of #4380, finding 2).
        "visual_evidence": {
            "observation_in_context": visual,
            "observation_available": visual,
            "prior_turn_observation_count": 0,
        },
        "answer_gate": ag,
        "retrieval": {
            "strategy": "oem_corpus_bm25" if chunks else "skipped_general_mode",
            "executed": chunks > 0,
            "candidate_count": chunks,
            "returned_doc_ids": [f"https://x/a.pdf#p{i}" for i in range(chunks)],
        },
        "context": {
            "chunk_count": chunks,
            "visual_evidence_count": (1 if visual else 0) + (1 if ledger else 0),
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
    assert (
        "Every judged turn had chunks or an observation: VIOLATED"
        in (tmp_path / "r.md").read_text()
    )


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


def test_unsampled_db_turns_are_not_collapsed(tmp_path: Path):
    """#4107 F3: turns not sampled for export have no OTel trace id. Each distinct
    turn must still count once, by its turn id or its decision_traces row."""
    rows = []
    for i, (jev, tokens) in enumerate([(0.9, 300), (0.2, 300), (None, None)]):
        p = packet(
            chunks=4,
            decision="answered",
            jev=jev,
            tokens=tokens,
            reason=None if jev is not None else "no_evidence",
        )
        p["ids"] = {"turn_id": f"turn-{i}"}
        rows.append(mod.flatten(p, source="db", trace_id=None))
    no_turn = packet(chunks=4, decision="answered", jev=0.8, tokens=300)
    no_turn["ids"] = {}
    for key in ("row-a", "row-b"):
        r = mod.flatten(no_turn, source="db", trace_id=None)
        r["row_id"] = f"db:{key}"
        rows.append(r)
    mod.report(rows, tmp_path / "r.md", tmp_path / "r.csv", baseline=[])
    assert (tmp_path / "r.csv").read_text().count("\n") == 6  # header + 5 distinct turns
    assert "judged: 4" in (tmp_path / "r.md").read_text()


def test_photo_turns_judged_without_their_observation_are_a_blind_spot_not_a_disagreement(
    tmp_path: Path,
):
    """2026-10-12 adjudication: 97 of the first 131 judged turns were photo turns scored
    on chunks alone. Those rows are listed, segmented and EXCLUDED from the window and
    the disagreement rate; a v2 photo turn (observation sent) counts."""
    rows = [
        # v1 photo turn (no version field, no observation count) — blind spot
        mod.flatten(
            packet(chunks=6, decision="answered", jev=0.05, claim=True, visual=True),
            source="x",
            trace_id="p1" + "0" * 30,
        ),
        # explicit v1 on a photo turn — blind spot
        mod.flatten(
            packet(chunks=6, decision="answered", jev=0.10, visual=True, version="sufficiency-v1"),
            source="x",
            trace_id="p2" + "0" * 30,
        ),
        # v2 photo turn: observation sent → interpretable, photo segment, agrees
        mod.flatten(
            packet(
                chunks=6,
                decision="answered",
                jev=0.85,
                visual=True,
                version="sufficiency-v2",
                obs=1,
            ),
            source="x",
            trace_id="p3" + "0" * 30,
        ),
        # v2 photo turn judged on the observation ALONE (zero chunks) — allowed, not a violation
        mod.flatten(
            packet(
                chunks=0,
                decision="answered",
                jev=0.80,
                visual=True,
                version="sufficiency-v2",
                obs=1,
            ),
            source="x",
            trace_id="p4" + "0" * 30,
        ),
        # text turns, unchanged semantics
        mod.flatten(
            packet(chunks=6, decision="answered", jev=0.05, version="sufficiency-v2", obs=0),
            source="x",
            trace_id="t1" + "0" * 30,
        ),
        mod.flatten(
            packet(
                chunks=6,
                decision="insufficient_evidence",
                jev=0.04,
                version="sufficiency-v2",
                obs=0,
            ),
            source="x",
            trace_id="t2" + "0" * 30,
        ),
    ]
    assert [mod.blind_spot(r) for r in rows] == [True, True, False, False, False, False]
    assert [mod.segment(r) for r in rows] == ["photo", "photo", "photo", "photo", "text", "text"]
    rc = mod.report(rows, tmp_path / "r.md", tmp_path / "r.csv", [])
    md = (tmp_path / "r.md").read_text()
    assert rc == 0, md  # an observation-only v2 judgment is not the zero-chunk violation
    assert "judged: 6 (interpretable: 4, blind-spot: 2)" in md
    assert "**BLIND SPOT:** 2 photo turn(s) were judged under `sufficiency-v1`" in md
    assert "Interpretable judged turns by segment: text 2 · photo 2" in md
    assert "window: **4/50** interpretable" in md
    # D3 (text) + D1 (text) = 2 disagreements over the 4 interpretable turns; the two A rows are photo
    assert (
        "Disagreements: 2/4 interpretable judged turns (2 blind-spot photo turns excluded)." in md
    )
    assert "| A agree | 0 | 2 |" in md
    assert "Every judged turn had chunks or an observation: OK" in md
    csv_text = (tmp_path / "r.csv").read_text()
    assert "blind_spot" in csv_text.splitlines()[0] and "segment" in csv_text.splitlines()[0]


def test_a_v2_judgment_with_neither_chunks_nor_observation_is_still_a_violation(tmp_path: Path):
    rows = [
        mod.flatten(
            packet(chunks=0, decision="answered", jev=0.5, version="sufficiency-v2", obs=0),
            source="x",
            trace_id="z" + "0" * 31,
        )
    ]
    rc = mod.report(rows, tmp_path / "r.md", tmp_path / "r.csv", [])
    assert rc == 1
    assert (
        "Every judged turn had chunks or an observation: VIOLATED (1)"
        in (tmp_path / "r.md").read_text()
    )


def test_asset_ledger_visual_evidence_is_not_a_photo_turn(tmp_path: Path):
    """Finding 2 of the Gate 7 substitute review of #4380: `context.visual_evidence_count`
    also counts the asset's visual-evidence LEDGER, so it is >0 on every later TEXT turn
    for that asset. A chunks-only v2 judgment on such a turn is a text disagreement,
    never a blind spot, never the photo segment."""
    text_turn_with_ledger_v2 = mod.flatten(
        packet(
            chunks=6, decision="answered", jev=0.05, version="sufficiency-v2", obs=0, ledger=True
        ),
        source="x",
        trace_id="l1" + "0" * 30,
    )
    text_turn_with_ledger_v1 = mod.flatten(
        packet(chunks=6, decision="answered", jev=0.05, ledger=True),
        source="x",
        trace_id="l2" + "0" * 30,
    )
    assert mod.blind_spot(text_turn_with_ledger_v2) is False
    assert mod.segment(text_turn_with_ledger_v2) == "text"
    assert mod.blind_spot(text_turn_with_ledger_v1) is False, (
        "v1 + ledger only: no observation was in context"
    )
    assert mod.segment(text_turn_with_ledger_v1) == "text"
    # And a v2 photo turn whose observation count is 0 (observation never reached the
    # judge) is a text judgment too — the count, not the flag, says what Jev saw.
    odd = mod.flatten(
        packet(
            chunks=6, decision="answered", jev=0.1, visual=True, version="sufficiency-v2", obs=0
        ),
        source="x",
        trace_id="l3" + "0" * 30,
    )
    assert mod.blind_spot(odd) is False and mod.segment(odd) == "text"
    rc = mod.report(
        [text_turn_with_ledger_v2, text_turn_with_ledger_v1, odd],
        tmp_path / "r.md",
        tmp_path / "r.csv",
        [],
    )
    md = (tmp_path / "r.md").read_text()
    assert rc == 0
    assert "judged: 3 (interpretable: 3, blind-spot: 0)" in md
    assert "Disagreements: 3/3 interpretable judged turns." in md


def test_old_packets_without_visual_evidence_block_fall_back_to_the_request_flag():
    p = packet(chunks=6, decision="answered", jev=0.05, visual=True)
    del p["visual_evidence"]
    r = mod.flatten(p, source="x", trace_id="o1" + "0" * 30)
    assert r["observation_in_context"] is True and mod.blind_spot(r) is True
