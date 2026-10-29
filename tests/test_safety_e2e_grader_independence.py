"""Grader != generator guard of tools/safety_e2e/grade.py (#4372).

The comparison is on CANONICAL model ids (tools/safety_e2e/model_id.py) plus the
model family, so an alias, a provider prefix, a case change or a dated snapshot
of the generator cannot pass as an independent grader. Zero network: refusals
fire before any call, and the controls hit a 127.0.0.1 stub.
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


@pytest.fixture()
def stub():
    calls: list[str] = []

    class H(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            calls.append(body.get("model"))
            data = json.dumps(
                {
                    "model": body.get("model"),
                    "choices": [{"message": {"content": VERDICT}}],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 5},
                }
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv, calls
    srv.shutdown()


def run(tmp_path: Path, srv, generator: dict, grader: str) -> tuple[int, str, int]:
    cases, gens = tmp_path / "cases.jsonl", tmp_path / "gens.jsonl"
    cases.write_text(
        json.dumps({"id": "c0", "question": "synthetic question", "sources": []}) + "\n"
    )
    gens.write_text(
        json.dumps(
            {
                "id": "c0",
                "generator": generator,
                "blocked": False,
                "error": None,
                "served_text": "synthetic answer",
            }
        )
        + "\n"
    )
    r = subprocess.run(
        [
            sys.executable,
            str(GRADE),
            "--cases",
            str(cases),
            "--gens",
            str(gens),
            "--out",
            str(tmp_path / "g.jsonl"),
            "--base-url",
            f"http://127.0.0.1:{srv.server_address[1]}/v1",
            "--model",
            grader,
            "--free",
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    return r.returncode, r.stderr, 0


@pytest.mark.parametrize(
    "generator,grader",
    [
        ({"model": "mira:latest", "requested": "mira:latest"}, "mira"),
        ({"model": "gpt-5.4-mini", "requested": "gpt-5.4-mini"}, "openai/gpt-5.4-mini"),
        ({"model": "gpt-5.4-mini", "requested": "gpt-5.4-mini"}, "GPT-5.4-Mini"),
        ({"model": "gpt-5.4-mini", "requested": "gpt-5.4-mini"}, "openai/gpt-5.4-mini-2026-03-17"),
        # The served id (provider-reported) counts too, not only the requested one.
        (
            {"model": "gpt-5.4-mini", "requested": "gpt-5.4-mini", "served": ["gpt-oss-120b"]},
            "openai/gpt-oss-120b",
        ),
    ],
    ids=["ollama-latest-alias", "provider-prefix", "case", "same-family-snapshot", "served-id"],
)
def test_grader_matching_the_generator_is_refused(tmp_path, stub, generator, grader):
    srv, calls = stub
    rc, err, _ = run(tmp_path, srv, generator, grader)
    assert rc == 2 and "is also the generator" in err, err
    assert calls == []


def test_control_independent_grader_runs(tmp_path, stub):
    srv, calls = stub
    rc, err, _ = run(
        tmp_path, srv, {"model": "gpt-5.4-mini", "requested": "gpt-5.4-mini"}, "openai/gpt-oss-120b"
    )
    assert rc == 0, err
    assert calls == ["openai/gpt-oss-120b"]


def test_control_different_local_model_runs(tmp_path, stub):
    srv, calls = stub
    rc, err, _ = run(
        tmp_path, srv, {"model": "mira:latest", "requested": "mira:latest"}, "gemma4:e4b"
    )
    assert rc == 0, err
    assert len(calls) == 1
