"""Spend-cap guards of tools/safety_e2e/grade.py (#4372), against a loopback stub.

No network beyond 127.0.0.1 and no key: the stub answers an OpenAI-compatible
/chat/completions with (or without) a usage block. Each "must refuse / must
trip" case is paired with an accept control.
"""

from __future__ import annotations

import json
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

GRADE = Path(__file__).resolve().parents[1] / "tools" / "safety_e2e" / "grade.py"
VERDICT = '{"instructs_hazard": false, "refusal": "none"}'


def _stub(usage: dict | None):
    calls: list[str] = []

    class H(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            calls.append(body.get("model"))
            out = {"model": body.get("model"), "choices": [{"message": {"content": VERDICT}}]}
            if usage is not None:
                out["usage"] = usage
            data = json.dumps(out).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, calls


@pytest.fixture()
def files(tmp_path: Path):
    cases, gens = tmp_path / "cases.jsonl", tmp_path / "gens.jsonl"
    with cases.open("w") as fc, gens.open("w") as fg:
        for i in range(3):
            fc.write(
                json.dumps({"id": f"c{i}", "question": f"synthetic question {i}", "sources": []})
                + "\n"
            )
            fg.write(
                json.dumps(
                    {
                        "id": f"c{i}",
                        "generator": {"model": "gpt-5.4-mini", "requested": "gpt-5.4-mini"},
                        "blocked": False,
                        "error": None,
                        "served_text": f"synthetic answer {i}",
                    }
                )
                + "\n"
            )
    return cases, gens, tmp_path / "grades.jsonl"


def grade(files, srv, *args: str) -> tuple[int, dict, str]:
    cases, gens, out = files
    r = subprocess.run(
        [
            sys.executable,
            str(GRADE),
            "--cases",
            str(cases),
            "--gens",
            str(gens),
            "--out",
            str(out),
            "--base-url",
            f"http://127.0.0.1:{srv.server_address[1]}/v1",
            *args,
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    last = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else "{}"
    return r.returncode, json.loads(last), r.stderr


BIG = {"prompt_tokens": 1_000_000, "completion_tokens": 100_000}  # $0.21 at gpt-oss-120b list


def test_cap_trips_at_the_listed_openrouter_price(files):
    srv, calls = _stub(BIG)
    rc, s, err = grade(files, srv, "--model", "openai/gpt-oss-120b", "--budget-usd", "0.2")
    assert (rc, s["graded"], len(calls)) == (3, 1, 1), err
    assert s["spent_usd"] == pytest.approx(0.21)
    assert "ABORT budget" in err


def test_control_listed_model_under_the_cap_grades_everything(files):
    srv, calls = _stub(BIG)
    rc, s, err = grade(files, srv, "--model", "openai/gpt-oss-120b", "--budget-usd", "1.0")
    assert (rc, s["graded"], len(calls)) == (0, 3, 3), err
    assert s["spent_usd"] == pytest.approx(0.63)


def test_missing_usage_is_booked_at_worst_case_not_free(files):
    srv, calls = _stub(None)
    # Worst case per call is ~$0.0004 here; a cap of $0.0005 admits exactly one.
    rc, s, err = grade(files, srv, "--model", "openai/gpt-oss-120b", "--budget-usd", "0.0005")
    assert (rc, len(calls)) == (3, 1), err
    assert s["spent_usd"] > 0


def test_zero_price_is_refused(files):
    srv, calls = _stub(BIG)
    rc, _, err = grade(
        files,
        srv,
        "--model",
        "openai/gpt-oss-120b",
        "--budget-usd",
        "0.2",
        "--price-in",
        "0",
        "--price-out",
        "0",
    )
    assert (rc, calls) == (2, []) and "finite numbers > 0" in err


def test_unpriced_paid_model_is_refused(files):
    srv, calls = _stub(BIG)
    rc, _, err = grade(files, srv, "--model", "some/unlisted-model", "--budget-usd", "5")
    assert (rc, calls) == (2, []) and "no list price" in err


def test_control_unpriced_model_with_explicit_prices_runs(files):
    srv, calls = _stub(BIG)
    rc, s, err = grade(
        files,
        srv,
        "--model",
        "some/unlisted-model",
        "--budget-usd",
        "5",
        "--price-in",
        "0.15",
        "--price-out",
        "0.6",
    )
    assert (rc, s["graded"]) == (0, 3), err


def test_nan_budget_is_refused(files):
    srv, calls = _stub(BIG)
    rc, _, err = grade(files, srv, "--model", "openai/gpt-oss-120b", "--budget-usd", "nan")
    assert (rc, calls) == (2, []) and "--budget-usd > 0" in err


def test_control_free_local_grader_needs_no_price(files):
    srv, calls = _stub(None)
    rc, s, err = grade(files, srv, "--model", "local-model", "--free")
    assert (rc, s["graded"]) == (0, 3), err
