"""Hermetic proofs for the metered drafting entrypoint. Mocked transport only, fake key, no network.

The refusal tests use a PAID configuration (far date, org set, caps 100) so that a missing guard
would reach the wire; they then assert nothing reached it. The dry tests show a free run.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx
import pytest

REPO = Path(os.environ.get("AUTOEVAL_REPO") or Path(__file__).resolve().parents[2])
SCRIPTS = Path(os.environ.get("AUTOEVAL_SCRIPTS") or REPO / "evals" / "scripts")
sys.path.insert(0, str(SCRIPTS))

import autoeval as cli  # noqa: E402
import autoeval_budget as ab  # noqa: E402
import autoeval_draft as dr  # noqa: E402
import autoeval_judge as jd  # noqa: E402

ORG = "org-confirmed"
FAR = "2099-01-01T00:00:00+00:00"
PROMPT = "Draft one troubleshooting question per passage. Return a JSON array of cases."
PASSAGES = [
    {
        "doc_id": "pf525-manual",
        "page": 41,
        "text": "If the drive faults with F004, check the output wiring for a short.",
        "is_private": False,
    },
    {
        "doc_id": "pf525-manual",
        "page": 42,
        "text": "Set P039 to 1 for stop mode 1.",
        "is_private": False,
    },
]
REPLY = json.dumps(
    [
        {
            "case_id": "draft-01",
            "question": "The drive shows F004. What do I check first?",
            "source_quote": "check the output wiring for a short",
            "source_doc": "pf525-manual",
            "source_page": 41,
        },
        {
            "case_id": "draft-02",
            "question": "How is stop mode set?",
            "source_quote": "Set P039 to 1 for stop mode 1.",
            "source_doc": "pf525-manual",
            "source_page": 42,
        },
    ]
)


class Wire:
    def __init__(self, text=REPLY, stop="end_turn"):
        self.requests = 0
        self.fetches = 0
        self.text, self.stop = text, stop

    def handler(self, request):
        self.requests += 1
        body = json.loads(request.content)
        resp = {
            "model": body["model"],
            "stop_reason": self.stop,
            "content": [{"type": "text", "text": self.text}],
            "usage": {"input_tokens": 900, "output_tokens": 300},
        }
        return httpx.Response(200, json=resp, headers={"anthropic-organization-id": ORG})

    def key(self):
        self.fetches += 1
        return "sk-ant-test-not-a-secret"


class _Client:
    def __init__(self, wire):
        self.wire = wire

    def Client(self, **_kw):  # noqa: N802 - mirrors httpx.Client
        return httpx.Client(transport=httpx.MockTransport(self.wire.handler))


@pytest.fixture
def world(tmp_path, monkeypatch):
    wire = Wire()
    monkeypatch.setattr(cli, "httpx", _Client(wire))
    monkeypatch.setattr(cli, "KeyOnce", lambda secret: _Counted(secret, wire))
    state = tmp_path / "state"
    state.mkdir()
    (state / "paid.json").write_text(
        json.dumps(
            {
                "total_cap_usd": 100.0,
                "daily_cap_usd": 100.0,
                "paid_not_after": FAR,
                "expect_org": ORG,
                "key_secret": "ANTHROPIC_API_KEY_TEST",
            }
        )
    )
    prompt = tmp_path / "prompt.md"
    prompt.write_text(PROMPT)
    passages = tmp_path / "passages.json"
    passages.write_text(json.dumps(PASSAGES))
    return {"tmp": tmp_path, "state": state, "prompt": prompt, "passages": passages, "wire": wire}


class _Counted:
    def __init__(self, secret, wire):
        self.secret, self.wire = secret, wire

    def __call__(self):
        return self.wire.key()


def _draft(w, *extra, passages=None, out="cands.jsonl") -> int:
    return cli.main(
        [
            "draft",
            "--state-dir",
            str(w["state"]),
            "--prompt",
            str(w["prompt"]),
            "--passages",
            str(passages or w["passages"]),
            "--category",
            "troubleshooting",
            "--out",
            str(w["tmp"] / out),
            *extra,
        ]
    )


def _ledger(w) -> list[dict]:
    p = w["state"] / "ledger.jsonl"
    return [json.loads(ln) for ln in p.read_text().splitlines()] if p.exists() else []


# ── refusal: before any cache lookup, metered call or key fetch ──────────────────


def test_drafting_refuses_a_private_passage_before_any_request_or_key(world):
    private = [dict(PASSAGES[0], is_private=True), PASSAGES[1]]
    world["passages"].write_text(json.dumps(private))
    assert _draft(world, "--paid") == 2
    assert world["wire"].requests == 0 and world["wire"].fetches == 0
    assert _ledger(world) == []  # nothing was reserved, so nothing can have been spent
    assert not (world["tmp"] / "cands.jsonl").exists()


@pytest.mark.parametrize("flag", ["missing", True])
def test_drafting_refuses_a_passage_without_is_private_false(world, flag):
    passage = dict(PASSAGES[0])
    if flag == "missing":
        del passage["is_private"]
    else:
        passage["is_private"] = flag
    world["passages"].write_text(json.dumps([passage, PASSAGES[1]]))
    assert _draft(world, "--paid") == 2
    assert world["wire"].requests == 0 and world["wire"].fetches == 0


def test_control_all_passages_marked_public_are_accepted(world):
    assert _draft(world, "--paid") == 0 and world["wire"].requests == 1  # control


# ── dry: a free run on a two-record input ────────────────────────────────────────


def test_draft_dry_run_on_two_passages_makes_no_request_and_no_ledger(world, capsys):
    assert _draft(world) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["api"] == 0 and out["reason"] == "paid_required"
    assert out["paid_required_worst_usd"] > 0 and out["candidates"] == 0
    assert world["wire"].requests == 0 and world["wire"].fetches == 0
    assert _ledger(world) == [] and not (world["tmp"] / "cands.jsonl").exists()


# ── paid: pending candidates, lane label, cache no-op, stored-error rules ────────


def test_paid_draft_writes_pending_review_candidates_with_source_fields(world, capsys):
    assert _draft(world, "--paid") == 0
    out = json.loads(capsys.readouterr().out)
    assert out["api"] == 1 and out["candidates"] == 2
    rows = [json.loads(ln) for ln in (world["tmp"] / "cands.jsonl").read_text().splitlines()]
    assert [r["case_id"] for r in rows] == ["draft-01", "draft-02"]
    for r in rows:
        assert r["status"] == "pending_review" and r["category"] == "troubleshooting"
        assert r["source_quote"] and r["source_doc"] == "pf525-manual" and r["source_page"]
    settled = [e for e in _ledger(world) if e["t"] == "settle"]
    assert settled and settled[0]["lane"] == "draft:troubleshooting" and settled[0]["status"] == 200


def test_draft_rerun_is_a_cache_no_op(world):
    assert _draft(world, "--paid") == 0
    assert _draft(world, "--paid", out="again.jsonl") == 0
    assert world["wire"].requests == 1
    assert (world["tmp"] / "again.jsonl").read_text() == (world["tmp"] / "cands.jsonl").read_text()


def test_truncated_draft_is_an_error_and_is_not_rebilled(world, capsys):
    world["wire"].stop = "max_tokens"
    assert _draft(world, "--paid") == 0
    assert json.loads(capsys.readouterr().out)["reason"] == "truncated"
    assert _draft(world, "--paid", out="again.jsonl") == 0
    assert world["wire"].requests == 1
    assert json.loads(capsys.readouterr().out)["reason"] == "recall_error"


def test_unparseable_draft_text_is_kept_and_never_rebilled(world, capsys):
    world["wire"].text = "Sure! Here are some cases: none in JSON form."
    assert _draft(world, "--paid") == 0
    assert json.loads(capsys.readouterr().out)["reason"] == "unparseable"
    assert _draft(world, "--paid", out="again.jsonl") == 0
    assert world["wire"].requests == 1
    assert json.loads(capsys.readouterr().out)["reason"] == "unparseable"


def test_draft_key_is_the_judge_key_scheme_over_the_rendered_prompt(world, tmp_path):
    cfg = ab.BudgetConfig(
        total_cap_usd=100.0,
        daily_cap_usd=100.0,
        paid_not_after=FAR,
        expect_org=ORG,
        sentinel=tmp_path / "STOP",
    )
    cas = jd.load_cas().CAS(tmp_path / "cas")
    env = dr.DraftEnv(
        mode="dry",
        model="claude-sonnet-4-6",
        cache=dr.DraftCache(cas),
        cfg=cfg,
        ledger=ab.Ledger(tmp_path / "ledger.jsonl", cfg),
        key_provider=lambda: "unused",
    )
    res = dr.draft(PROMPT, PASSAGES, category="troubleshooting", env=env)
    price = cfg.prices["claude-sonnet-4-6"]
    expected = jd.cache_key(
        dr.build_prompt(PROMPT, PASSAGES), "claude-sonnet-4-6", price.max_tokens, price.params
    )
    assert res.key == expected and res.reason == "paid_required"
    assert dr.DraftCache(cas).get(expected) is None  # dry never writes the cache


def test_candidate_parsing_keeps_only_objects_and_accepts_both_shapes():
    assert dr.parse_candidates('[{"a": 1}, "junk", 3]') == [{"a": 1}]
    assert dr.parse_candidates('{"cases": [{"b": 2}]}') == [{"b": 2}]
    assert dr.parse_candidates('{"a": 1}\n{"a": 2}') == [{"a": 1}, {"a": 2}]
