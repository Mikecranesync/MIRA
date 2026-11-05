"""tools/stg_atlas_close_three.py against a stub Atlas (#5223).

The stub behaves like Atlas v1.8.0 as observed on a local rig: GET
/work-orders/{id} returns the order, PATCH /work-orders/{id}/change-status sets
its status. Output goes to PUBLIC Actions logs, so credentials and titles must
never appear in it.
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
TOOL = REPO / "tools" / "stg_atlas_close_three.py"
USER = "svc-hub@example.invalid"
PASSWORD = "Correct-Horse-42"
SECRET_TITLE_TAIL = "fictional-title-tail-xyz"


def _orders() -> dict[int, dict]:
    return {
        1: {"title": "Siemens VFD - " + SECRET_TITLE_TAIL, "status": "OPEN"},
        2: {"title": "Siemens VFD - " + SECRET_TITLE_TAIL, "status": "OPEN"},
        3: {"title": "Siemens PLC - " + SECRET_TITLE_TAIL, "status": "OPEN"},
        4: {"title": "Siemens PLC - " + SECRET_TITLE_TAIL, "status": "OPEN"},
    }


def _serve(orders: dict[int, dict], calls: list[str]) -> HTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _send(self, code: int, payload: dict):
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
            ok = body.get("email") == USER and body.get("password") == PASSWORD
            self._send(200, {"accessToken": "tok"}) if ok else self._send(403, {})

        def do_GET(self):
            calls.append("GET " + self.path)
            wo_id = int(self.path.rsplit("/", 1)[1])
            if not self._authed() or wo_id not in orders:
                return self._send(404, {})
            self._send(200, {"id": wo_id, **orders[wo_id]})

        def do_PATCH(self):
            body = self._body()
            calls.append("PATCH " + self.path)
            wo_id = int(self.path.split("/")[2])
            if not self._authed() or not self.path.endswith("/change-status"):
                return self._send(404, {})
            orders[wo_id]["status"] = body["status"]
            orders[wo_id]["feedback"] = body.get("feedback")
            self._send(200, {"id": wo_id, **orders[wo_id]})

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def _run(orders: dict[int, dict], user: str = USER, password: str = PASSWORD):
    calls: list[str] = []
    server = _serve(orders, calls)
    try:
        env = {
            **os.environ,
            "STG_ATLAS_BASE": f"http://127.0.0.1:{server.server_port}",
            "ATLAS_API_USER": user,
            "ATLAS_API_PASSWORD": password,
        }
        out = subprocess.run([sys.executable, str(TOOL)], capture_output=True, text=True, env=env)
    finally:
        server.shutdown()
    text = out.stdout + out.stderr
    assert user == "" or user not in text
    assert password == "" or password not in text
    assert SECRET_TITLE_TAIL not in text
    return out, calls


def _patched(calls: list[str]) -> list[str]:
    return [c for c in calls if c.startswith("PATCH")]


def test_closes_exactly_the_three_named_orders_and_nothing_else():
    orders = _orders()
    out, calls = _run(orders)
    assert out.returncode == 0, out.stdout
    assert "VERDICT: closed 3, already complete 0" in out.stdout
    assert [orders[i]["status"] for i in (1, 2, 3, 4)] == ["COMPLETE"] * 3 + ["OPEN"]
    assert "No repair was performed" in orders[1]["feedback"]
    assert _patched(calls) == [f"PATCH /work-orders/{i}/change-status" for i in (1, 2, 3)]


def test_rerun_is_a_no_op():
    orders = _orders()
    _run(orders)
    out, calls = _run(orders)
    assert out.returncode == 0
    assert "VERDICT: closed 0, already complete 3" in out.stdout
    assert _patched(calls) == []


def test_unexpected_title_changes_nothing():
    orders = _orders()
    orders[3]["title"] = "Something else entirely"
    out, calls = _run(orders)
    assert out.returncode == 4
    assert "preflight failed; nothing changed" in out.stdout
    assert _patched(calls) == []
    assert all(o["status"] == "OPEN" for o in orders.values())


def test_missing_order_changes_nothing():
    orders = _orders()
    del orders[2]
    out, calls = _run(orders)
    assert out.returncode == 4
    assert _patched(calls) == []
    assert orders[1]["status"] == "OPEN"


def test_unexpected_status_changes_nothing():
    orders = _orders()
    orders[1]["status"] = "ON_HOLD"
    out, calls = _run(orders)
    assert out.returncode == 4
    assert _patched(calls) == []


def test_bad_credentials_change_nothing():
    orders = _orders()
    out, calls = _run(orders, password="wrong")
    assert out.returncode == 3
    assert calls == ["POST /auth/signin"]


def test_missing_credentials_fail_before_any_request():
    out, calls = _run(_orders(), user="", password="")
    assert out.returncode == 2
    assert calls == []
