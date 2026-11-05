"""tools/stg_atlas_verify_1602.py against a stub Atlas (#5223).

The stub mimics Atlas v1.8.0: GET /work-orders/{id}, POST /work-orders/search
(paged, no text filter), POST /comments/search/{id}, PATCH change-status.
Output goes to PUBLIC Actions logs, so credentials and titles must never appear.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
TOOL = REPO / "tools" / "stg_atlas_verify_1602.py"
USER = "svc-hub@example.invalid"
PASSWORD = "Correct-Horse-42"
SECRET_TITLE = "fictional-title-xyz"
JOB = "9ff99b8f-eeb6-4319-b71c-71360c958cf0"
CREATE = "[MIRA:7337af55-68ba-4241-a340-9c2d95f7d6ab]"
FINISH = "[MIRA:7bb50d64-d4b3-471d-b75d-c0b2330f1098]"


def _state(n_other: int = 30) -> dict:
    orders = {
        i: {"id": i, "title": "Other", "description": "x", "status": "OPEN"}
        for i in range(1, n_other + 1)
    }
    orders[1602] = {
        "id": 1602,
        "title": SECRET_TITLE,
        "description": f"{CREATE} TEST\n— Technician via MIRA (ref work_sheet_jobs:work_order:{JOB})",
        "status": "OPEN",
        "priority": "MEDIUM",
    }
    return {
        "orders": orders,
        "comments": {1602: [{"content": f"{FINISH} finished"}]},
        "search_fail_from": None,
        "patch_noop": False,
    }


def _serve(state: dict, calls: list[str]) -> HTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _send(self, code: int, payload):
            data = json.dumps(payload).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _body(self) -> dict:
            n = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(n)) if n else {}

        def _authed(self) -> bool:
            return self.headers.get("Authorization") == "Bearer tok"

        def do_POST(self):
            body = self._body()
            calls.append("POST " + self.path)
            if self.path == "/auth/signin":
                ok = body.get("email") == USER and body.get("password") == PASSWORD
                return self._send(200, {"accessToken": "tok"}) if ok else self._send(403, {})
            if not self._authed():
                return self._send(401, {})
            if self.path == "/work-orders/search":
                items = sorted(state["orders"].values(), key=lambda o: o["id"])
                size, page = body["pageSize"], body["pageNum"]
                if state["search_fail_from"] is not None and page >= state["search_fail_from"]:
                    return self._send(500, {})
                return self._send(200, {"content": items[page * size : (page + 1) * size]})
            if self.path.startswith("/comments/search/"):
                return self._send(200, state["comments"].get(int(self.path.rsplit("/", 1)[1]), []))
            self._send(404, {})

        def do_GET(self):
            calls.append("GET " + self.path)
            wo_id = int(self.path.rsplit("/", 1)[1])
            if not self._authed() or wo_id not in state["orders"]:
                return self._send(404, {})
            self._send(200, state["orders"][wo_id])

        def do_PATCH(self):
            body = self._body()
            calls.append("PATCH " + self.path)
            wo_id = int(self.path.split("/")[2])
            if not self._authed() or not self.path.endswith("/change-status"):
                return self._send(404, {})
            if not state["patch_noop"]:
                state["orders"][wo_id]["status"] = body["status"]
            self._send(200, state["orders"][wo_id])

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def _run(state: dict, mode: str = "verify", password: str = PASSWORD):
    calls: list[str] = []
    server = _serve(state, calls)
    try:
        env = {
            **os.environ,
            "STG_ATLAS_BASE": f"http://127.0.0.1:{server.server_port}",
            "ATLAS_API_USER": USER,
            "ATLAS_API_PASSWORD": password,
            "MODE": mode,
        }
        out = subprocess.run([sys.executable, str(TOOL)], capture_output=True, text=True, env=env)
    finally:
        server.shutdown()
    text = out.stdout + out.stderr
    assert USER not in text and PASSWORD not in text and SECRET_TITLE not in text
    return out, calls


def _writes(calls: list[str]) -> list[str]:
    return [c for c in calls if c.startswith("PATCH")]


def test_verify_passes_and_writes_nothing():
    state = _state()
    out, calls = _run(state)
    assert out.returncode == 0, out.stdout
    assert "VERDICT: PASS status=OPEN" in out.stdout
    assert "marker_orders=[1602]" in out.stdout and "scan_complete=True pages=2" in out.stdout
    assert _writes(calls) == []


def test_duplicate_marker_fails():
    state = _state()
    state["orders"][7]["description"] = CREATE + " copy"
    out, calls = _run(state, mode="complete")
    assert out.returncode == 4
    assert "marker_orders=[7, 1602]" in out.stdout
    assert _writes(calls) == []


def test_incomplete_scan_is_a_failure_not_a_pass():
    # Page 0 is full and holds 1602 (the only match); page 1 errors, so the
    # scan cannot prove there is no duplicate further on.
    state = _state(n_other=24)
    state["search_fail_from"] = 1
    out, calls = _run(state, mode="complete")
    assert out.returncode == 4
    assert "scan_complete=False pages=1 marker_orders=[1602]" in out.stdout
    assert _writes(calls) == []


def test_missing_job_ref_or_finish_note_fails():
    state = _state()
    state["orders"][1602]["description"] = CREATE + " no ref"
    assert _run(state)[0].returncode == 4
    state = _state()
    state["comments"][1602] = []
    out, _ = _run(state)
    assert out.returncode == 4 and "finish_marker=0" in out.stdout


def test_complete_closes_only_1602_and_reads_back():
    state = _state()
    out, calls = _run(state, mode="complete")
    assert out.returncode == 0, out.stdout
    assert "VERDICT: PASS status=COMPLETE" in out.stdout
    assert _writes(calls) == ["PATCH /work-orders/1602/change-status"]
    assert state["orders"][1602]["status"] == "COMPLETE"
    assert all(o["status"] == "OPEN" for i, o in state["orders"].items() if i != 1602)
    out, calls = _run(state, mode="complete")
    assert out.returncode == 0 and _writes(calls) == []


def test_complete_that_does_not_persist_fails():
    state = _state()
    state["patch_noop"] = True
    out, calls = _run(state, mode="complete")
    assert out.returncode == 5
    assert "FAIL after complete; status=OPEN" in out.stdout
    assert _writes(calls) == ["PATCH /work-orders/1602/change-status"]


def test_bad_credentials_and_bad_mode_change_nothing():
    out, calls = _run(_state(), password="wrong")
    assert out.returncode == 3 and calls == ["POST /auth/signin"]
    out, calls = _run(_state(), mode="delete")
    assert out.returncode == 2 and calls == []
