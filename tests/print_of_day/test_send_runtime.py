"""Regression coverage for the POTD send orchestration (tools/print_of_day/run.py).

Ported (reconciliation) from the superseded PR #2865, re-targeted at the CANONICAL
runtime: the real ``run()`` entrypoint driving the real ``SendLedger`` + send gate,
with the upstream pipeline seams (provenance, readiness, interpret, grade, judge)
monkeypatched — the same seam-mock style the PR-6 suite uses. Locks in the three
send-orchestration invariants the runtime must never regress:

  * a failed provider send writes NO successful ``SendLedger`` entry,
  * the failed case therefore stays retryable (a later successful run records once),
  * a duplicate case is refused BEFORE the mail provider is ever invoked.

Hermetic ($0, no network, no email): ``mailer.send`` is a spy.
"""
from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "tools" / "internet_print_test"))

import mailer  # noqa: E402
from printsense import grade_case as grade_case_mod  # noqa: E402
from printsense import interpret as interpret_mod  # noqa: E402
from printsense.print_of_day import send_gate  # noqa: E402
from printsense.print_of_day.provenance import Provenance  # noqa: E402
# run.py is a script module (tools/ is not a package); load it by path under a
# unique name so it can't collide with any other "run" module in the full suite.
_run_spec = importlib.util.spec_from_file_location(
    "potd_run_under_test", REPO / "tools" / "print_of_day" / "run.py")
run_mod = importlib.util.module_from_spec(_run_spec)
_run_spec.loader.exec_module(run_mod)

_READY_CAP = {
    "environment": "staging",
    "provider": {"requested": "together", "resolved": "together",
                 "model": "MiniMaxAI/MiniMax-M3", "key_present": True,
                 "network_enabled": True, "text_probe": "ok", "vision_probe": "ok"},
    "ocr": {"required": True, "available": True, "tesseract_version": "5.3.0",
            "pytesseract_version": "0.3.13"},
    "verdict": "ready",
}


class _FakeGraph:
    def model_dump_json(self, **kwargs):
        return "{}"

    def all_entities(self):
        return []


class _Spy:
    def __init__(self, result):
        self.result = result
        self.calls = 0

    def __call__(self, *args, **kwargs):
        self.calls += 1
        return self.result


def _args(tmp_path, **over):
    base = dict(
        case="pf523", image=str(tmp_path / "print.png"), run_id=None, question=None,
        rubric=None, source_url="https://example.com/p.pdf", title="PF523",
        report_url=None, recipient="mike@example.com", environment="staging",
        out=str(tmp_path / "out"), send_ledger=str(tmp_path / "sent.jsonl"),
        live=False, send=True,
    )
    base.update(over)
    return argparse.Namespace(**base)


@pytest.fixture
def drive(tmp_path, monkeypatch):
    """Mock the upstream seams so run() reaches its send step deterministically.

    Returns (args, ledger_path, interpret_spy)."""
    (tmp_path / "print.png").write_bytes(b"\x89PNG realish page bytes for a hash")
    monkeypatch.setattr(run_mod, "collect_provenance", lambda: Provenance(
        git_sha="a" * 40, git_dirty=False, image_revision="a" * 40, allow_dirty=False))
    monkeypatch.setattr(run_mod, "enforce_potd_readiness", lambda **k: dict(_READY_CAP))
    interpret_spy = _Spy(_FakeGraph())
    monkeypatch.setattr(interpret_mod, "interpret_print", interpret_spy)
    monkeypatch.setattr(interpret_mod, "pop_last_usage", lambda: {})
    monkeypatch.setattr(grade_case_mod, "grade_case", lambda *a, **k: {
        "score": 8.2, "letter": "B", "import_verdict": "PASS",
        "hard_failures": [], "safety_critical_misreads": []})
    try:  # judge is advisory (best-effort try/except in run); stub to $0
        import judge as judge_mod  # noqa: PLC0415
        monkeypatch.setattr(judge_mod, "judge", lambda **k: {})
    except ImportError:
        pass
    args = _args(tmp_path)
    return args, Path(args.send_ledger), interpret_spy


def test_duplicate_case_blocked_before_mail_provider(drive, monkeypatch):
    args, ledger_path, interpret_spy = drive
    send_gate.SendLedger(ledger_path).record_sent(
        run_id="prev", case_id=args.case, email_id="e0", sha="x")
    send_spy = _Spy({"sent": True, "id": "should-not-happen", "status": 200})
    monkeypatch.setattr(mailer, "send", send_spy)

    rc = run_mod.run(args)

    assert rc != 0  # refused (DUPLICATE_RUN)
    assert send_spy.calls == 0  # the mail provider is NEVER invoked for a duplicate
    assert interpret_spy.calls == 0  # refused before the (paid) interpret, too


def test_failed_send_writes_no_ledger_entry_and_stays_retryable(drive, monkeypatch):
    args, ledger_path, _ = drive

    fail_spy = _Spy({"sent": False, "status": 500, "error": "provider boom"})
    monkeypatch.setattr(mailer, "send", fail_spy)
    rc = run_mod.run(args)

    assert rc != 0  # a failed provider send blocks the run
    assert fail_spy.calls == 1  # the provider WAS attempted
    ledger = send_gate.SendLedger(ledger_path)
    # No successful ledger entry was written for the failed case (already_sent
    # matches on case_id, so any run_id proves the case is absent) → retryable.
    assert ledger.already_sent(run_id="any", case_id=args.case) is False

    # Retry: a subsequent run whose provider succeeds records the case exactly once.
    ok_spy = _Spy({"sent": True, "id": "email-9", "status": 200})
    monkeypatch.setattr(mailer, "send", ok_spy)
    rc2 = run_mod.run(args)

    assert rc2 == 0
    assert ok_spy.calls == 1
    assert ledger.already_sent(run_id="any", case_id=args.case) is True
