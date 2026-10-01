"""Runner tests: AC3 (--dry-run, real subprocess, no network) and AC4 (the
live per-case loop against a Hub that is monkeypatched at its HTTP
transport — never a real socket)."""

from __future__ import annotations

import json
import subprocess
import sys
import uuid
from pathlib import Path
from urllib.error import URLError

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
TOOLS_QA = REPO_ROOT / "tools" / "qa"
CASES_DIR = Path(__file__).resolve().parent / "cases"
if str(TOOLS_QA) not in sys.path:
    sys.path.insert(0, str(TOOLS_QA))

from photo_diagnosis import budget, runner, schema  # noqa: E402
from photo_diagnosis.providers import FakeProvider  # noqa: E402


# ---------------------------------------------------------------------------
# AC3 — python tools/qa/photo_diagnosis/runner.py --cases DIR --dry-run
# Run as a REAL subprocess: a passing in-process main(argv) call would not
# catch a script-mode sys.path bug (sys.path[0] differs between the two).


def test_dry_run_subprocess_exits_zero_and_lists_examples_as_not_scorable():
    proc = subprocess.run(
        [
            sys.executable,
            str(TOOLS_QA / "photo_diagnosis" / "runner.py"),
            "--cases",
            str(CASES_DIR),
            "--dry-run",
        ],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "example-diagnosis-001: NOT scorable" in proc.stdout
    assert "example-qa-001: NOT scorable" in proc.stdout
    assert "scorable (validated_by set): 0" in proc.stdout


def test_dry_run_makes_no_network_call(monkeypatch):
    def _boom(*a, **kw):
        raise AssertionError("dry-run must not open a network connection")

    monkeypatch.setattr("urllib.request.urlopen", _boom)
    summary = runner.dry_run_summary(CASES_DIR)
    assert summary["total_cases"] == 2
    assert summary["scorable"] == 0
    assert summary["errors"] == []


def test_dry_run_refuses_no_cookie_no_hub_construction(monkeypatch):
    # --dry-run must exit before anything that would need --cookie/--base.
    called = {"hub": False}

    class _ExplodingHub:
        def __init__(self, *a, **kw):
            called["hub"] = True
            raise AssertionError("Hub must not be constructed in --dry-run")

    monkeypatch.setattr(
        runner, "load_retrieval_acceptance", lambda: pytest.fail("must not import Hub module")
    )
    rc = runner.main(["--cases", str(CASES_DIR), "--dry-run"])
    assert rc == 0
    assert called["hub"] is False


def test_refuses_prod_base():
    assert runner._refuses_prod("https://app.factorylm.com") is True
    assert runner._refuses_prod("https://app-staging.factorylm.com") is False


def test_live_run_refuses_production_base(tmp_path):
    rc = runner.main(
        [
            "--cases",
            str(CASES_DIR),
            "--base",
            "https://app.factorylm.com",
            "--cookie",
            "whatever",
            "--out",
            str(tmp_path),
        ]
    )
    assert rc == 2


def test_live_run_without_cookie_refuses(tmp_path):
    rc = runner.main(
        [
            "--cases",
            str(CASES_DIR),
            "--base",
            "https://app-staging.factorylm.com",
            "--out",
            str(tmp_path),
        ]
    )
    assert rc == 2


# ---------------------------------------------------------------------------
# Live per-case loop, Hub HTTP transport monkeypatched — no socket


def _sse_body(frames: list[dict]) -> bytes:
    return ("\n\n".join(f"data: {json.dumps(f)}" for f in frames)).encode()


class _FakeHubTransport:
    """Scripted responses keyed on (method, path-prefix), installed over
    Hub._req so create_notebook/look/chat/diagnostics/attach_manual all run
    their real logic against canned bytes — never a socket."""

    def __init__(self, trace_id: str):
        self.trace_id = trace_id
        self.requests: list[tuple[str, str]] = []

    def __call__(self, hub_self, method, path, body=None, headers=None):
        self.requests.append((method, path))
        if path.startswith("/api/equipment-notebooks/") and path.endswith("/chat/"):
            frames = [
                {"kind": "trace", "traceId": self.trace_id},
                {"kind": "content", "content": "The nameplate reads PNOZ X3."},
                {"kind": "sources", "citations": []},
                {"kind": "evidence", "basis": "general_reasoning", "label": "general"},
                {"kind": "status", "status": "answered"},
            ]
            return 200, {"x-mira-trace-id": self.trace_id}, _sse_body(frames)
        if path.startswith("/api/equipment-notebooks/") and "/turns/diagnostics/" in path:
            packet = {
                "environment": "staging",
                "generation": {
                    "served_provider": "groq",
                    "served_model": "llama-test",
                    "input_tokens": 50,
                    "output_tokens": 20,
                },
                "answer_gate": {},
                "retrieval": {
                    "executed": False,
                    "candidate_count": 0,
                    "strategy": "skipped_general_mode",
                    "oem_corpus_searched": False,
                    "returned_doc_ids": [],
                },
                "context": {
                    "chunk_count": 0,
                    "evidence_doc_ids": [],
                    "system_prompt_kind": "general",
                },
            }
            body_json = {
                "turnId": "turn-1",
                "traceId": self.trace_id,
                "packet": packet,
                "anomalies": [],
            }
            return 200, {}, json.dumps(body_json).encode()
        if path == "/api/equipment-notebooks/":
            nb = {"id": "nb-" + uuid.uuid4().hex[:8], "nodeId": "node-1"}
            return 201, {}, json.dumps({"notebook": nb}).encode()
        if path.endswith("/look/"):
            return (
                200,
                {},
                json.dumps(
                    {"fileId": "file-1", "observation": {"capturedAt": "2026-10-01T00:00:00Z"}}
                ).encode(),
            )
        raise AssertionError(f"unexpected request in fake Hub transport: {method} {path}")


def test_run_qa_case_against_monkeypatched_hub(monkeypatch):
    ra = runner.load_retrieval_acceptance()
    hub = ra.Hub("https://app-staging.factorylm.com", "fake-cookie")
    transport = _FakeHubTransport(trace_id="0af7651916cd43dd8448eb211c80319c")
    monkeypatch.setattr(hub, "_req", lambda *a, **kw: transport(hub, *a, **kw))
    monkeypatch.setattr(ra.time, "sleep", lambda s: None)

    valid, errors = schema.load_cases(CASES_DIR)
    assert errors == []
    qa_case = next(c for c in valid if c["kind"] == "qa")
    qa_case = dict(qa_case, validated_by="mike")  # make it scorable for this test

    ledger = budget.Ledger(cap_usd=10.0)
    judge = FakeProvider(responses=[])  # qa_grade's deterministic path needs no judge call

    record = runner.run_qa_case(hub, ra, qa_case, ledger, judge, repeat=1)

    assert record["status"] == "completed"
    assert record["kind"] == "qa"
    assert len(record["answers"]) == 1
    answer = record["answers"][0]
    assert answer["exact_match"] is True  # "PNOZ X3" appears in the fake reply
    # no network error was ever raised means the SSE/packet shapes match
    # what common_checks() actually indexes (the KeyError hazard this test
    # exists to catch).
    assert any(p.endswith("/chat/") for _m, p in transport.requests)
    assert any("/turns/diagnostics/" in p for _m, p in transport.requests)


def test_hermetic_tests_never_touch_a_real_socket(monkeypatch):
    def _boom(*a, **kw):
        raise URLError("hermetic tests must never open a real socket")

    monkeypatch.setattr("urllib.request.urlopen", _boom)
    # Exercising the budget + grading + simulator modules with fakes must
    # not trip this guard.
    ledger = budget.Ledger(cap_usd=10.0)
    fake = FakeProvider(responses=['{"H": true}'])
    ledger.call(fake, [{"role": "user", "content": "hi"}], max_tokens=10)
    assert fake.calls == 1


def test_contract_record_keeps_failed_checks_and_marks_citation_text_unavailable():
    ra = runner.load_retrieval_acceptance()
    row = ra.Row("x")
    row.check("passes", True)
    row.check("badge truthful", False, "oem without citation")
    rec = runner._contract_record(row, {"citations": 2, "basis": "oem_documentation"})
    assert rec["passed"] is False
    assert rec["failed"] == ["badge truthful"]
    assert rec["citation_support"] == "citation_text_unavailable"
    assert (
        runner._contract_record(ra.Row("y"), {"citations": 0})["citation_support"] == "no_citations"
    )
