"""Hermetic tests for the AI-visibility panel. No network, no paid call."""

from __future__ import annotations

import json

import httpx
import pytest

from answer_radar import ai_panel


def q(n: int) -> dict:
    return next(x for x in ai_panel.load_questions() if x["n"] == n)


def test_questions_file_matches_mikes_numbering():
    qs = ai_panel.load_questions()
    assert qs[0]["text"] == "What does PowerFlex 525 fault F004 mean?"
    assert qs[17]["text"] == "What is FactoryLM?"
    # Q7 must not presuppose the wrong meaning our own page used to publish.
    assert "earth" not in qs[6]["text"].lower()


def test_grade_answer_keys():
    assert ai_panel.grade(q(1), "F004 means UnderVoltage on the DC bus.", [])["correct"] is True
    assert ai_panel.grade(q(1), "F004 is an overcurrent trip.", [])["correct"] is False
    assert ai_panel.grade(q(7), "3220 is DC link undervoltage.", [])["correct"] is True
    # The wrong meaning fails even when the right words also appear.
    assert (
        ai_panel.grade(q(7), "Fault 3220 earth fault. Also DC link undervoltage.", [])["correct"]
        is False
    )
    assert ai_panel.grade(q(5), "Read the catalog number.", [])["correct"] is None
    # The best answer names the wrong meaning to rule it out; it must still pass.
    assert (
        ai_panel.grade(q(7), "3220 is DC link undervoltage, not an earth fault.", [])["correct"]
        is True
    )


def test_grade_visibility_and_safety():
    g = ai_panel.grade(
        q(4),
        "Lock out power first. Phase failure. Which drive size?",
        ["https://factorylm.com/drive-commander/siemens-g120/faults/F30011"],
    )
    assert g["cites_factorylm"] and not g["mentions_factorylm"]
    assert g["safety_warning"] is True and g["asks_followup"] is True
    assert ai_panel.grade(q(18), "FactoryLM is a maintenance AI.", [])["mentions_factorylm"] is None
    assert ai_panel.grade(q(9), "A miracle tool that won't disappear.", [])["tools_named"] == []
    g2 = ai_panel.grade(q(9), "Try FactoryLM or MaintainX.", [])
    assert g2["mentions_factorylm"] and g2["tools_named"] == ["FactoryLM", "MaintainX"]
    assert g2["safety_warning"] is None


def test_budget_reserves_worst_case_before_the_call():
    b = ai_panel.Budget(cap_usd=0.05)
    with pytest.raises(ai_panel.BudgetExceeded):
        b.reserve("anthropic")  # worst case of one Opus call with 3 searches exceeds 5 cents
    b2 = ai_panel.Budget(cap_usd=6.0)
    b2.reserve("openai")
    assert b2.settle("openai", 1_000_000, 0, 0) == pytest.approx(0.75)


def test_unpriced_provider_refuses(tmp_path):
    with pytest.raises(SystemExit):
        ai_panel.run(tmp_path, ["mystery"], ai_panel.Budget(6.0), ai_panel.load_questions()[:1])


def test_run_skips_stored_answers_and_stops_at_cap(tmp_path, monkeypatch):
    calls = []

    def fake(_client, text):
        calls.append(text)
        return {
            "answer": "UnderVoltage. Lock out power.",
            "urls": ["https://example.com"],
            "tokens_in": 1000,
            "tokens_out": 500,
            "searches": 1,
            "finished": "q03" not in text and "glist" not in text,
        }

    monkeypatch.setitem(ai_panel.ASKERS, "openai", fake)
    qs = ai_panel.load_questions()[:3]
    (tmp_path / "openai").mkdir()
    (tmp_path / "openai" / "q01.json").write_text("{}")
    log = ai_panel.run(tmp_path, ["openai"], ai_panel.Budget(6.0), qs)
    assert len(calls) == 2 and qs[0]["text"] not in calls
    rec = json.loads((tmp_path / "openai" / "q02.json").read_text())
    assert rec["grade"]["cites_any_source"] and rec["cost_usd"] > 0
    assert "total" in log[-1]
    stop = ai_panel.run(tmp_path / "x", ["openai"], ai_panel.Budget(0.001), qs)
    assert stop[0].startswith("STOP")


def test_openai_parser(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test")
    body = {
        "output": [
            {"type": "web_search_call"},
            {
                "type": "message",
                "content": [
                    {
                        "type": "output_text",
                        "text": "F004 = UnderVoltage",
                        "annotations": [{"type": "url_citation", "url": "https://factorylm.com/x"}],
                    }
                ],
            },
        ],
        "usage": {"input_tokens": 10, "output_tokens": 5},
    }
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=body)))
    res = ai_panel.ask_openai(client, "q")
    assert res == {
        "answer": "F004 = UnderVoltage",
        "urls": ["https://factorylm.com/x"],
        "tokens_in": 10,
        "tokens_out": 5,
        "searches": 1,
        "finished": False,
    }


def test_gemini_parser(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test")
    body = {
        "candidates": [
            {
                "content": {"parts": [{"text": "Phase failure"}]},
                "groundingMetadata": {
                    "groundingChunks": [
                        {"web": {"uri": "https://redirect", "title": "factorylm.com"}}
                    ]
                },
            }
        ],
        "usageMetadata": {
            "promptTokenCount": 7,
            "candidatesTokenCount": 3,
            "thoughtsTokenCount": 2,
        },
    }
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=body)))
    res = ai_panel.ask_gemini(client, "q")
    assert res["urls"] == ["factorylm.com"] and res["tokens_out"] == 5 and res["searches"] == 1


def test_redact_hides_keys(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "AIzaSECRET")
    assert "SECRET" not in ai_panel.redact("429 for url https://x/y?key=AIzaSECRET&a=1")
    assert "zzz" not in ai_panel.redact("url ?key=zzz")


def test_cleanup_mira_runs_only_with_a_tenant(monkeypatch):
    seen = []
    monkeypatch.setattr(ai_panel, "_provision", lambda *a: seen.append(a) or "")
    ai_panel.cleanup_mira()
    assert seen == []
    ai_panel._HUB.update(tenant="t-1", hub=object())
    ai_panel.cleanup_mira()
    assert seen == [("--cleanup", "t-1")] and ai_panel._HUB == {}


def test_unfinished_answers_are_paid_but_not_stored(tmp_path, monkeypatch):
    monkeypatch.setitem(
        ai_panel.ASKERS,
        "openai",
        lambda _c, t: {
            "answer": "cut",
            "urls": [],
            "tokens_in": 1000,
            "tokens_out": 0,
            "searches": 0,
            "finished": False,
        },
    )
    log = ai_panel.run(tmp_path, ["openai"], ai_panel.Budget(6.0), ai_panel.load_questions()[:1])
    assert "UNFINISHED" in log[0] and not (tmp_path / "openai" / "q01.json").exists()
    assert ai_panel.spent_so_far(tmp_path) == pytest.approx(0.00075)


def test_two_consecutive_errors_skip_the_provider(tmp_path, monkeypatch):
    calls = []

    def boom(_c, t):
        calls.append(t)
        raise RuntimeError("429")

    monkeypatch.setitem(ai_panel.ASKERS, "openai", boom)
    log = ai_panel.run(tmp_path, ["openai"], ai_panel.Budget(6.0), ai_panel.load_questions()[:5])
    assert len(calls) == 2 and "SKIPPED" in log[-1]


def test_report_regrades_stored_answers_without_calls(tmp_path):
    (tmp_path / "openai").mkdir()
    rec = {
        "n": 1,
        "answer": "F004 is UnderVoltage.",
        "urls": ["https://factorylm.com/x"],
        "cost_usd": 0.02,
        "searches": 1,
    }
    (tmp_path / "openai" / "q01.json").write_text(json.dumps(rec))
    md = ai_panel.report(tmp_path, ai_panel.load_questions())
    assert "| openai | 1/20 | 1/1 | 0/1 | 1/1 |" in md
    assert "| 1 | ✓ **FLM-cited** |" in md


def test_report_flag_needs_no_budget_and_makes_no_calls(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(ai_panel, "ASKERS", {})
    assert ai_panel.main(["--out", str(tmp_path), "--report"]) == 0
    assert "| Provider |" in capsys.readouterr().out
    with pytest.raises(SystemExit):
        ai_panel.main(["--out", str(tmp_path)])


def test_a_crash_after_the_call_still_counts_its_worst_case(tmp_path, monkeypatch):
    def parse_boom(_c, t):
        raise KeyError("usage")  # the provider answered (and billed); parsing failed

    monkeypatch.setitem(ai_panel.ASKERS, "anthropic", parse_boom)
    ai_panel.run(tmp_path, ["anthropic"], ai_panel.Budget(6.0), ai_panel.load_questions()[:1])
    wc = ai_panel.Budget(6.0).worst_case("anthropic")
    assert ai_panel.spent_so_far(tmp_path) == pytest.approx(wc)


def test_a_rejected_request_costs_nothing(tmp_path, monkeypatch):
    def rejected(_c, t):
        req = httpx.Request("POST", "https://x")
        raise httpx.HTTPStatusError("429", request=req, response=httpx.Response(429, request=req))

    monkeypatch.setitem(ai_panel.ASKERS, "openai", rejected)
    ai_panel.run(tmp_path, ["openai"], ai_panel.Budget(6.0), ai_panel.load_questions()[:1])
    assert ai_panel.spent_so_far(tmp_path) == 0.0


def test_failed_cleanup_keeps_and_names_the_tenant(monkeypatch):
    def fail(*a):
        raise RuntimeError("bun exited 1")

    monkeypatch.setattr(ai_panel, "_provision", fail)
    ai_panel._HUB.update(tenant="t-9", hub=object())
    with pytest.raises(RuntimeError, match="t-9"):
        ai_panel.cleanup_mira()
    assert ai_panel._HUB["tenant"] == "t-9"
    ai_panel._HUB.clear()


def test_redact_hides_database_urls():
    assert "secret" not in ai_panel.redact("connect postgres://u:secret@host/db failed")


def test_grader_rejects_lookalike_answers():
    assert ai_panel.grade(q(2), "Check F126 and F630 first.", [])["correct"] is False
    assert ai_panel.grade(q(2), "F012 is HW OverCurrent.", [])["correct"] is True
    assert ai_panel.grade(q(1), "F004 is not an undervoltage fault.", [])["correct"] is False
    assert (
        ai_panel.grade(q(18), "I could not find anything about FactoryLM in maintenance.", [])[
            "correct"
        ]
        is False
    )
    assert ai_panel.grade(q(18), "FactoryLM builds an industrial maintenance AI.", [])["correct"]
    # A hedged guess is not knowing the product (MIRA's own run-1 answer).
    guess = "FactoryLM is likely a term related to industrial automation, but its meaning is unverified."
    assert ai_panel.grade(q(18), guess, [])["correct"] is False
    assert ai_panel.grade(q(19), "This MIRA is unrelated to FactoryLM.", [])["correct"] is False
    assert ai_panel.grade(q(19), "MIRA is the maintenance agent by FactoryLM.", [])["correct"]
    assert ai_panel.grade(q(1), "Block out an hour for it.", [])["safety_warning"] is False
    assert ai_panel.grade(q(9), "You can glean answers from manuals.", [])["tools_named"] == []
    # Asked by name, a citation of our site is reported apart from the visibility score.
    g = ai_panel.grade(q(18), "FactoryLM is a maintenance tool.", ["https://factorylm.com/"])
    assert g["cites_factorylm"] is None and g["brand_query_cites_factorylm"] is True


def test_q19_and_q2_keys_after_second_review():
    assert ai_panel.grade(q(19), "MIRA is FactoryLM's maintenance AI.", [])["correct"] is True
    assert ai_panel.grade(q(19), "MIRA is not made by FactoryLM.", [])["correct"] is False
    assert ai_panel.grade(q(2), "Look up F-012 in the manual.", [])["correct"] is True


def test_a_torn_ledger_line_counts_high_and_cleanup_still_runs(tmp_path, monkeypatch):
    (tmp_path / "ledger.jsonl").write_text('{"id": "a", "prov": "openai", "reser')
    dearest = max(ai_panel.Budget(0).worst_case(p) for p in ai_panel.PRICES)
    assert ai_panel.spent_so_far(tmp_path) == pytest.approx(dearest)
    cleaned = []
    monkeypatch.setattr(ai_panel, "cleanup_mira", lambda: cleaned.append(1))
    calls = iter([0.0])  # the start-up read succeeds; the final SPENT read fails
    monkeypatch.setattr(ai_panel, "spent_so_far", lambda out: next(calls))
    monkeypatch.setattr(ai_panel, "run", lambda *a: [])
    with pytest.raises(StopIteration):
        ai_panel.main(["--out", str(tmp_path), "--budget-usd", "6"])
    assert cleaned == [1]


def test_the_cap_holds_across_a_restart(tmp_path, monkeypatch):
    monkeypatch.setitem(
        ai_panel.ASKERS,
        "anthropic",
        lambda _c, t: (_ for _ in ()).throw(KeyError("parse")),
    )
    cap = ai_panel.Budget(0).worst_case("anthropic") * 1.5
    ai_panel.run(tmp_path, ["anthropic"], ai_panel.Budget(cap), ai_panel.load_questions()[:1])
    # A fresh process starts from what is on disk, so the second call is refused.
    again = ai_panel.Budget(cap, spent_usd=ai_panel.spent_so_far(tmp_path))
    log = ai_panel.run(tmp_path, ["anthropic"], again, ai_panel.load_questions()[1:2])
    assert log[0].startswith("STOP")


def test_provision_records_tenant_before_a_later_failure(monkeypatch):
    """Review of #5949: a tenant created but missing its cookie must still be cleaned up."""
    calls: list[tuple[str, ...]] = []

    def fake_provision(*extra: str) -> str:
        calls.append(extra)
        return "noise without equals\nENV:BETA_GATE_TENANT=t-123\n"

    monkeypatch.setattr(ai_panel, "_provision", fake_provision)
    ai_panel._HUB.clear()
    with pytest.raises(RuntimeError, match="BETA_GATE_COOKIE"):
        ai_panel.ask_mira(None, "q")  # type: ignore[arg-type]
    assert ai_panel._HUB["tenant"] == "t-123"
    ai_panel.cleanup_mira()
    assert calls[-1] == ("--cleanup", "t-123")
    assert ai_panel._HUB == {}


def test_provision_without_tenant_says_so(monkeypatch):
    monkeypatch.setattr(ai_panel, "_provision", lambda *e: "ENV:BETA_GATE_COOKIE=c\n")
    ai_panel._HUB.clear()
    with pytest.raises(RuntimeError, match="no BETA_GATE_TENANT"):
        ai_panel.ask_mira(None, "q")  # type: ignore[arg-type]
    assert "tenant" not in ai_panel._HUB


def test_q1_wrong_meaning_for_f004_is_not_correct():
    """Review of #5949: naming undervoltage for another code must not pass Q1."""
    assert (
        ai_panel.grade(q(1), "F004 is overvoltage; F005 is undervoltage.", [])["correct"] is False
    )
    assert ai_panel.grade(q(1), "F004 means DC bus overvoltage.", [])["correct"] is False
    # A correct answer that does not repeat the code still passes.
    assert ai_panel.grade(q(1), "It means DC bus undervoltage.", [])["correct"] is True
    assert ai_panel.grade(q(1), "F004 UnderVoltage: the DC bus dropped.", [])["correct"] is True
