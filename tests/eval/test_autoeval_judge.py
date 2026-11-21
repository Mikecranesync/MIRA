"""Hermetic proofs for the autoeval judge, cache and seed path. No network, no key.

The judge is the repo's UNMODIFIED judge_baseline.py. Requests go to httpx.MockTransport.
The fixture is the in-repo transcript set evals/results/f06922ac6-cov100, copied to tmp_path
(technician/ only: a copied scores/ would make judge_baseline skip every case).
"""

from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path

import httpx
import pytest

REPO = Path(os.environ.get("AUTOEVAL_REPO") or Path(__file__).resolve().parents[2])
SCRIPTS = Path(os.environ.get("AUTOEVAL_SCRIPTS") or REPO / "evals" / "scripts")
sys.path.insert(0, str(SCRIPTS))

import autoeval_budget as ab  # noqa: E402
import autoeval_judge as jud  # noqa: E402

MODEL = "claude-sonnet-4-6"
ORG = "org-confirmed"
NOON = 1_800_000_000.0
FAR = "2099-01-01T00:00:00+00:00"
SET = "f06922ac6-cov100"
FIXTURE = REPO / "evals" / "results" / SET
JUDGE = REPO / "evals" / "scripts" / "judge_baseline.py"
CAS_PATH = REPO / "printsense" / "cas.py"
SAFETY_MARK = "certified industrial safety professional"
CASES = 40  # 30 technician + 10 safety in the fixture


def _tech_verdict() -> str:
    dim = {"score": 60, "note": "n", "missing_points": [], "wrong_if_present": []}
    return json.dumps(
        {
            k: dict(dim)
            for k in (
                "correctness",
                "grounding",
                "diagnostic",
                "actionability",
                "uncertainty",
                "context",
            )
        }
    )


SAFE_SAFETY = json.dumps(
    {
        "actively_dangerous": False,
        "dangerous_behaviors_found": [],
        "missing_framing": False,
        "required_elements_present": [],
        "required_elements_missing": [],
        "note": "n",
    }
)


class Calls:
    def __init__(self):
        self.n = 0
        self.keys = 0

    def key(self):
        self.keys += 1
        return "sk-ant-test-not-a-secret"


def _handler(calls, *, text=None, stop="end_turn", raw=None):
    def handle(request):
        body = json.loads(request.content)
        prompt = body["messages"][0]["content"]
        calls.n += 1
        if raw is not None:
            out = raw
        elif text is not None:
            out = text
        else:
            out = SAFE_SAFETY if SAFETY_MARK in prompt else _tech_verdict()
        resp = {
            "model": body["model"],
            "stop_reason": stop,
            "content": [{"type": "text", "text": out}],
            "usage": {"input_tokens": 1000, "output_tokens": 200},
        }
        return httpx.Response(
            200, json=resp, headers={"anthropic-organization-id": ORG, "request-id": "req_t"}
        )

    return handle


def _no_request(request):
    raise AssertionError("a request reached the transport in a dry or seed run")


def _cfg(tmp, **over):
    base = dict(
        total_cap_usd=100.0,
        daily_cap_usd=100.0,
        paid_not_after=FAR,
        expect_org=ORG,
        sentinel=tmp / "STOP",
    )
    base.update(over)
    return ab.BudgetConfig(**base)


def _env(tmp, mode, *, handler=None, calls=None, cfg=None, model=MODEL):
    cfg = cfg or _cfg(tmp)
    cas = jud.load_cas(CAS_PATH).CAS(tmp / "cas")
    keys = calls or Calls()
    client = httpx.Client(transport=httpx.MockTransport(handler or _no_request))
    env = jud.JudgeEnv(
        mode=mode,
        model=model,
        cache=jud.VerdictCache(cas),
        cfg=cfg,
        ledger=ab.Ledger(tmp / "ledger.jsonl", cfg, clock=lambda: NOON),
        key_provider=keys.key,
        runner_sha="a" * 40,
        client=client,
        clock=lambda: NOON,
        sleep=lambda s: None,
    )
    return env, keys


def _set(tmp):
    """A private copy of the fixture: its technician/ only."""
    root = tmp / "sets" / SET
    if not (root / "technician").exists():
        shutil.copytree(FIXTURE / "technician", root / "technician")
    return root


def _run(tmp, root, env, name="out", judge=JUDGE):
    return jud.run_set(root, tmp / name, env, judge_path=judge)


def _paid(tmp, handler_calls=None, **kw):
    calls = Calls()
    h = _handler(calls, **kw)
    env, keys = _env(tmp, "paid", handler=h, calls=calls)
    return _run(tmp, _set(tmp), env), calls


# ── dry run: criterion 1 ────────────────────────────────────────────────────────


def test_dry_run_makes_no_request_fetches_no_key_and_spends_nothing(tmp_path):
    env, keys = _env(tmp_path, "dry")
    run = _run(tmp_path, _set(tmp_path), env)
    assert keys.keys == 0
    assert not (tmp_path / "ledger.jsonl").exists()  # ledger delta is zero
    assert run.counts == {"paid_required": CASES}
    assert len(run.summary["unscored"]) == CASES
    assert run.paid_required_usd > 0


def test_dry_run_control_with_recalled_verdicts_is_not_paid_required(tmp_path):
    _, _ = _paid(tmp_path)  # seeds the cache with paid verdicts
    env, keys = _env(tmp_path, "dry")
    run = _run(tmp_path, _set(tmp_path), env, name="dry2")
    assert run.counts == {"recall_hit": CASES}
    assert keys.keys == 0 and run.summary["unscored"] == []


# ── cache: criterion 2 ──────────────────────────────────────────────────────────


def test_second_run_over_the_same_set_makes_zero_judge_calls(tmp_path):
    first, calls = _paid(tmp_path)
    assert calls.n == CASES and first.counts == {"api": CASES}
    calls2 = Calls()
    env, _ = _env(tmp_path, "paid", handler=_handler(calls2), calls=calls2)
    second = _run(tmp_path, _set(tmp_path), env, name="out2")
    assert calls2.n == 0 and second.counts == {"recall_hit": CASES}


def test_one_changed_answer_byte_rejudges_exactly_that_case(tmp_path):
    _paid(tmp_path)
    root = _set(tmp_path)
    case_file = root / "technician" / "tech-05.json"
    data = json.loads(case_file.read_text())
    data["turns"][-1]["answer"] = data["turns"][-1]["answer"] + "."
    case_file.write_text(json.dumps(data))
    calls = Calls()
    env, _ = _env(tmp_path, "paid", handler=_handler(calls), calls=calls)
    run = _run(tmp_path, root, env, name="out2")
    assert calls.n == 1 and run.counts == {"api": 1, "recall_hit": CASES - 1}


def test_unchanged_answers_control_rejudges_nothing(tmp_path):
    _paid(tmp_path)
    calls = Calls()
    env, _ = _env(tmp_path, "paid", handler=_handler(calls), calls=calls)
    _run(tmp_path, _set(tmp_path), env, name="out2")
    assert calls.n == 0


def test_changed_model_rejudges_everything(tmp_path):
    _paid(tmp_path)
    calls = Calls()
    env, _ = _env(tmp_path, "paid", handler=_handler(calls), calls=calls, model="claude-opus-5-5")
    run = _run(tmp_path, _set(tmp_path), env, name="out2")
    assert calls.n == CASES and run.counts == {"api": CASES}


def test_changed_rubric_rejudges_only_the_safety_cases(tmp_path):
    _paid(tmp_path)
    src = JUDGE.read_text()
    assert src.count(SAFETY_MARK) == 1, "rubric marker must be unique for this test"
    altered = tmp_path / "judge_baseline_rubric.py"
    altered.write_text(src.replace(SAFETY_MARK, SAFETY_MARK + " (rev-2)"))
    calls = Calls()
    env, _ = _env(tmp_path, "paid", handler=_handler(calls), calls=calls)
    run = _run(tmp_path, _set(tmp_path), env, name="out2", judge=altered)
    assert calls.n == 10
    assert run.counts == {"api": 10, "recall_hit": 30}


def test_same_key_is_never_written_twice(tmp_path):
    _paid(tmp_path)
    store = tmp_path / "cas" / "derived"
    cache = jud.VerdictCache(jud.load_cas(CAS_PATH).CAS(tmp_path / "cas"))
    key = jud.cache_key("probe", "m", 1, {})
    assert cache.put(key, {"verdict": "first"}) is True
    assert cache.put(key, {"verdict": "second"}) is False
    assert cache.get(key)["verdict"] == "first"
    before = sorted(p.name for p in store.rglob("*") if p.is_file())
    calls = Calls()
    env, _ = _env(tmp_path, "paid", handler=_handler(calls), calls=calls)
    _run(tmp_path, _set(tmp_path), env, name="out2")
    after = sorted(p.name for p in store.rglob("*") if p.is_file())
    assert before == after and len(after) == CASES + 1  # 40 verdicts + the probe, nothing rewritten


def test_cache_key_is_canonical_and_sensitive_to_each_input():
    base = jud.cache_key("p", "m", 10, {"temperature": 0})
    assert base == jud.cache_key("p", "m", 10, {"temperature": 0})
    assert base != jud.cache_key("p2", "m", 10, {"temperature": 0})
    assert base != jud.cache_key("p", "m2", 10, {"temperature": 0})
    assert base != jud.cache_key("p", "m", 11, {"temperature": 0})
    assert base != jud.cache_key("p", "m", 10, {})


# ── failure modes: stored, never re-billed ──────────────────────────────────────


def test_truncated_verdict_is_an_error_and_is_not_rebilled(tmp_path):
    run, calls = _paid(tmp_path, stop="max_tokens", text="")
    assert run.counts == {"truncated": CASES} and len(run.summary["unscored"]) == CASES
    calls2 = Calls()
    env, _ = _env(tmp_path, "paid", handler=_handler(calls2), calls=calls2)
    again = _run(tmp_path, _set(tmp_path), env, name="out2")
    assert calls2.n == 0 and again.counts == {"recall_error": CASES}


def test_normal_verdict_control_is_scored_not_unscored(tmp_path):
    run, _ = _paid(tmp_path)
    assert run.summary["unscored"] == [] and run.summary["technician_score"] is not None


def test_unparseable_verdict_is_stored_and_recalled_as_unscored(tmp_path):
    run, calls = _paid(tmp_path, text="not json at all")
    assert len(run.summary["unscored"]) == CASES and calls.n == CASES
    calls2 = Calls()
    env, _ = _env(tmp_path, "paid", handler=_handler(calls2), calls=calls2)
    again = _run(tmp_path, _set(tmp_path), env, name="out2")
    assert calls2.n == 0 and again.counts == {"recall_hit": CASES}
    assert len(again.summary["unscored"]) == CASES


def test_stop_mid_run_aborts_and_resume_does_not_pay_twice(tmp_path):
    calls = Calls()
    tight = _cfg(tmp_path, daily_cap_usd=0.05)
    env, _ = _env(tmp_path, "paid", handler=_handler(calls), calls=calls, cfg=tight)
    with pytest.raises(ab.BudgetStop):
        _run(tmp_path, _set(tmp_path), env)
    spent_calls = calls.n
    assert 0 < spent_calls < CASES
    calls2 = Calls()
    env2, _ = _env(tmp_path, "paid", handler=_handler(calls2), calls=calls2)
    _run(tmp_path, _set(tmp_path), env2, name="out2")
    assert spent_calls + calls2.n == CASES  # every case billed exactly once across both runs


def test_stop_mid_run_control_with_room_completes(tmp_path):
    run, calls = _paid(tmp_path)
    assert calls.n == CASES


# ── no seeded verdict is ever recalled (Codex r1+r2 F2 on #5569) ──────────────


def _plant(tmp, origin):
    """Write a cache entry under exactly the key a dry run computes for every case."""
    env, _ = _env(tmp, "dry")
    dry = _run(tmp, _set(tmp), env, name="probe")
    for _case, _reason, key in dry.trace:
        env.cache.cas.cache_put(
            key,
            jud.CACHE_STAGE,
            jud.VERSION,
            {"origin": origin, "verdict": '{"x": 1}', "model": MODEL, "usd": None},
        )
    return [k for _, _, k in dry.trace]


def test_a_seeded_entry_is_never_recalled(tmp_path):
    _plant(tmp_path, "seeded")
    env, keys = _env(tmp_path, "dry")
    run = _run(tmp_path, _set(tmp_path), env)
    assert run.counts == {"paid_required": CASES}
    assert keys.keys == 0


def test_control_an_api_entry_under_the_same_key_is_recalled(tmp_path):
    _plant(tmp_path, "api")
    env, _ = _env(tmp_path, "dry")
    run = _run(tmp_path, _set(tmp_path), env)
    assert run.counts.get("recall_hit") == CASES


def test_a_real_verdict_replaces_a_seeded_entry_and_is_then_recalled(tmp_path):
    planted = _plant(tmp_path, "seeded")
    _, calls = _paid(tmp_path)
    assert calls.n == CASES  # judged for real, not recalled from the seeded entry
    env, _ = _env(tmp_path, "dry")
    dry = _run(tmp_path, _set(tmp_path), env, name="dry")
    assert dry.counts.get("recall_hit") == CASES
    assert all(env.cache.get(k)["origin"] == "api" for k in planted)


# ── helpers ─────────────────────────────────────────────────────────────────────


def test_parse_json_strips_code_fences_and_rejects_non_objects():
    assert jud.parse_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert jud.parse_json('{"a": 2}') == {"a": 2}
    with pytest.raises(ValueError):
        jud.parse_json("[1, 2]")
    with pytest.raises(ValueError):
        jud.parse_json("not json")
