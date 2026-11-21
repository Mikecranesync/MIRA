"""Hermetic proofs for the fixture judge lane (tests/eval/judge.py rubric). No network, no key.

Requests go to httpx.MockTransport. The key is a fake that counts fetches. Sets are built with the
real importer, so the lane is exercised on the same contract the CLI accepts.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx

REPO = Path(os.environ.get("AUTOEVAL_REPO") or Path(__file__).resolve().parents[2])
SCRIPTS = Path(os.environ.get("AUTOEVAL_SCRIPTS") or REPO / "evals" / "scripts")
sys.path.insert(0, str(SCRIPTS))

import autoeval as cli  # noqa: E402
import autoeval_budget as ab  # noqa: E402
import autoeval_fixture_judge as fx  # noqa: E402
import autoeval_import as ai  # noqa: E402
import autoeval_judge as jd  # noqa: E402

SET = "f06922ac6-cov100"
FIXTURE = REPO / "evals" / "results" / SET
ORG = "org-confirmed"
NOON = 1_800_000_000.0
FAR = "2099-01-01T00:00:00+00:00"
DIMS = ("groundedness", "helpfulness", "tone", "instruction_following", "conversational_flow")
NO_KB = "(no KB chunks retrieved — model had no KB coverage)"
RUBRIC_MARK = "groundedness: Does the response reflect"  # only in tests/eval/judge.py


def verdict(score: int = 4) -> str:
    return json.dumps({d: {"score": score, "note": "n"} for d in DIMS})


class Wire:
    """Counts requests and key fetches. `reply(prompt)` returns (text, stop_reason)."""

    def __init__(self, reply=None):
        self.requests = 0
        self.fetches = 0
        self.bodies: list[str] = []
        self.reply = reply or (lambda prompt: (verdict(), "end_turn"))

    def handler(self, request):
        self.requests += 1
        body = json.loads(request.content)
        prompt = body["messages"][0]["content"]
        self.bodies.append(prompt)
        text, stop = self.reply(prompt)
        resp = {
            "model": body["model"],
            "stop_reason": stop,
            "content": [{"type": "text", "text": text}],
            "usage": {"input_tokens": 1000, "output_tokens": 200},
        }
        return httpx.Response(200, json=resp, headers={"anthropic-organization-id": ORG})

    def key(self):
        self.fetches += 1
        return "sk-ant-test-not-a-secret"


def make_set(tmp: Path, n: int = 2) -> Path:
    """An imported transcript set of n generated technician answers (via the real importer)."""
    src = tmp / "gen"
    src.mkdir(parents=True, exist_ok=True)
    for i in range(1, n + 1):
        cid = f"tech-{i:02d}"
        rec = {
            "case_id": cid,
            "case_type": "technician",
            "case": {"id": cid, "category": "general_industrial", "mode": "general"},
            "turns": [
                {
                    "turn": 0,
                    "question": f"Question {i}?",
                    "answer": f"Answer text number {i}.",
                    "citations": [],
                    "status": "answered",
                }
            ],
            "error": None,
            "timestamp": "2026-11-15T00:00:00+00:00",
        }
        (src / f"{cid}.json").write_text(json.dumps(rec))
    ai.import_records(
        src,
        tmp / "results",
        set_name=f"gen-{n}",
        route="technician",
        sha="abc1234",
        base_url="https://app.factorylm.com",
    )
    return tmp / "results" / f"gen-{n}"


def record_with_passages(case_id: str = "tech-09") -> dict:
    return {
        "case_id": case_id,
        "case_type": "technician",
        "case": {"id": case_id},
        "turns": [
            {
                "turn": 0,
                "question": "Why F004?",
                "answer": "Check the output wiring.",
                "citations": [],
                "status": "answered",
                "fsm_state": "DIAGNOSE",
            },
            {
                "turn": 1,
                "question": "What first?",
                "answer": "Power off, then test.",
                "citations": [],
                "status": "answered",
                "fsm_state": "CHECK",
            },
        ],
        "error": None,
        "timestamp": "2026-11-15T00:00:00+00:00",
        "retrieved_passages": [
            {"doc_id": "pf525-manual", "page": 41, "text": "F004 means undervoltage on the DC bus."}
        ],
    }


def _env(tmp: Path, mode: str, wire: Wire) -> jd.JudgeEnv:
    cfg = ab.BudgetConfig(
        total_cap_usd=100.0,
        daily_cap_usd=100.0,
        paid_not_after=FAR,
        expect_org=ORG,
        sentinel=tmp / "STOP",
    )
    return jd.JudgeEnv(
        mode=mode,
        model="claude-sonnet-4-6",
        cache=jd.VerdictCache(jd.load_cas().CAS(tmp / "cas")),
        cfg=cfg,
        ledger=ab.Ledger(tmp / "ledger.jsonl", cfg, clock=lambda: NOON),
        key_provider=wire.key,
        runner_sha="a" * 40,
        client=httpx.Client(transport=httpx.MockTransport(wire.handler)),
        clock=lambda: NOON,
        sleep=lambda s: None,
    )


def _run(tmp: Path, set_dir: Path, env: jd.JudgeEnv, name: str = "out") -> fx.FixtureRun:
    return fx.run_fixture(set_dir, tmp / name, env)


# ── the prompt: the rubric's own template, real passages, no invention ───────────


def test_rendered_prompt_is_the_rubric_template_with_the_record_answer():
    rubric = fx.load_rubric()
    prompt = fx.render_prompt(rubric, record_with_passages())
    assert RUBRIC_MARK in prompt
    assert "Context — what the user asked (final turn):\nWhat first?" in prompt
    assert "Assistant's final response to grade:\nPower off, then test." in prompt


def test_real_passages_reach_rag_context_when_the_record_provides_them():
    rubric = fx.load_rubric()
    prompt = fx.render_prompt(rubric, record_with_passages())
    assert "[pf525-manual p.41] F004 means undervoltage on the DC bus." in prompt
    assert NO_KB not in prompt


def test_no_passages_renders_the_no_kb_placeholder_and_no_invented_text():
    rubric = fx.load_rubric()
    rec = record_with_passages()
    del rec["retrieved_passages"]
    prompt = fx.render_prompt(rubric, rec)
    assert NO_KB in prompt
    assert "pf525-manual" not in prompt


def test_prior_turns_render_as_condensed_history_with_fsm_state():
    prompt = fx.render_prompt(fx.load_rubric(), record_with_passages())
    assert "Conversation history (condensed):" in prompt
    assert 'Turn 1: user said "Why F004?" → FSM advanced to DIAGNOSE' in prompt


# ── dry: free, no request, no key, no ledger ────────────────────────────────────


def test_fixture_dry_run_makes_zero_requests_fetches_no_key_and_writes_no_ledger(
    tmp_path, monkeypatch
):
    wire = Wire()
    monkeypatch.setattr(cli, "KeyOnce", lambda secret: wire.key)  # the CLI's key provider
    state = tmp_path / "state"
    rc = cli.main(["fixture", "--state-dir", str(state), "--set-dir", str(FIXTURE)])
    assert rc == 0
    assert wire.requests == 0 and wire.fetches == 0
    assert not (state / "ledger.jsonl").exists()
    out = sorted((state / "runs").glob("*/fixture/*/_summary.json"))[0]
    summary = json.loads(out.read_text())
    assert summary["api"] == 0 and summary["statuses"] == {"paid_required": 40}


def test_dry_run_control_after_a_paid_run_recalls_every_verdict(tmp_path):
    set_dir = make_set(tmp_path, 2)
    wire = Wire()
    _run(tmp_path, set_dir, _env(tmp_path, "paid", wire), name="paid")
    dry = Wire()
    run = _run(tmp_path, set_dir, _env(tmp_path, "dry", dry), name="dry")
    assert run.counts == {"recall_hit": 2} and dry.requests == 0 and dry.fetches == 0


# ── paid: provenance, cache no-op, and the stored-error rules ───────────────────


def test_paid_verdicts_are_cached_with_the_case_provenance(tmp_path):
    set_dir = make_set(tmp_path, 2)
    wire = Wire()
    run = _run(tmp_path, set_dir, _env(tmp_path, "paid", wire))
    assert run.counts == {"api": 2} and wire.requests == 2
    row = run.rows[0]
    cache = jd.VerdictCache(jd.load_cas().CAS(tmp_path / "cas"))
    payload = cache.get(row["cache_key"])
    assert payload["case_id"] == "tech-01" and payload["set"] == "gen-2"
    assert payload["answer_sha256"] == jd.sha256_text("Answer text number 1.")
    assert payload["sha"] == "abc1234" and payload["origin"] == "api"
    assert payload["prompt_sha256"] == jd.sha256_text(
        fx.render_prompt(fx.load_rubric(), _rec(tmp_path, 1))
    )


def _rec(tmp: Path, i: int) -> dict:
    return json.loads((tmp / "results" / "gen-2" / "technician" / f"tech-{i:02d}.json").read_text())


def test_fixture_rerun_is_a_cache_no_op(tmp_path):
    set_dir = make_set(tmp_path, 2)
    _run(tmp_path, set_dir, _env(tmp_path, "paid", Wire()), name="first")
    wire = Wire()
    second = _run(tmp_path, set_dir, _env(tmp_path, "paid", wire), name="second")
    assert wire.requests == 0 and second.counts == {"recall_hit": 2}
    assert second.summary["api"] == 0 and second.summary["scored"] == 2


def test_unparseable_paid_reply_is_stored_and_never_rebilled(tmp_path):
    set_dir = make_set(tmp_path, 2)

    def reply(prompt):
        return (
            ("here is my verdict, not json", "end_turn")
            if "Answer text number 2." in prompt
            else (verdict(), "end_turn")
        )

    first = _run(tmp_path, set_dir, _env(tmp_path, "paid", Wire(reply)), name="first")
    bad = [r for r in first.rows if r["case_id"] == "tech-02"][0]
    assert bad["status"] == "unparseable" and bad["scores"] is None and bad["error"]
    wire = Wire()
    second = _run(tmp_path, set_dir, _env(tmp_path, "paid", wire), name="second")
    assert wire.requests == 0
    assert [r["status"] for r in second.rows if r["case_id"] == "tech-02"] == ["unparseable"]


def test_truncated_fixture_reply_is_an_error_and_is_not_rebilled(tmp_path):
    set_dir = make_set(tmp_path, 2)

    def reply(prompt):
        return (
            ('{"groundedness": {"score": 4', "max_tokens")
            if "number 1." in prompt
            else (verdict(), "end_turn")
        )

    first = _run(tmp_path, set_dir, _env(tmp_path, "paid", Wire(reply)), name="first")
    assert first.counts == {"truncated": 1, "api": 1}
    wire = Wire()
    second = _run(tmp_path, set_dir, _env(tmp_path, "paid", wire), name="second")
    assert wire.requests == 0 and second.counts == {"recall_error": 1, "recall_hit": 1}


# ── the verdict: judge.py's own validator, all five dimensions ──────────────────


def test_scored_case_carries_all_five_dimensions(tmp_path):
    set_dir = make_set(tmp_path, 2)
    run = _run(tmp_path, set_dir, _env(tmp_path, "paid", Wire(lambda p: (verdict(5), "end_turn"))))
    scored = [r for r in run.rows if r["status"] == "scored"]
    assert len(scored) == 2 and set(scored[0]["scores"]) == set(DIMS)
    assert run.summary["mean_scores"] == {d: 5.0 for d in DIMS}


def test_out_of_range_score_is_unparseable_not_scored(tmp_path):
    set_dir = make_set(tmp_path, 2)

    def reply(prompt):
        return (verdict(9), "end_turn") if "number 2." in prompt else (verdict(), "end_turn")

    run = _run(tmp_path, set_dir, _env(tmp_path, "paid", Wire(reply)))
    bad = [r for r in run.rows if r["case_id"] == "tech-02"][0]
    assert bad["status"] == "unparseable" and "Score out of range" in bad["error"]


def test_the_lane_sends_the_second_rubric_not_the_release_gate_prompt(tmp_path):
    set_dir = make_set(tmp_path, 2)
    wire = Wire()
    _run(tmp_path, set_dir, _env(tmp_path, "paid", wire))
    assert wire.bodies and all(RUBRIC_MARK in b for b in wire.bodies)
