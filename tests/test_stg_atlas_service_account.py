"""tools/stg_atlas_service_account.py against a stub Atlas (#5205, staging half).

The stub behaves like Atlas v1.8.0 as observed on a local rig: /auth/signin
returns 403 for an unknown user or wrong password, /auth/signup returns 422 for
an existing email. Output goes to PUBLIC Actions logs, so credentials must never
appear in it.
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
TOOL = REPO / "tools" / "stg_atlas_service_account.py"
USER = "svc-hub@example.invalid"
PASSWORD = "Correct-Horse-42"


def _serve(accounts: dict[str, str], calls: list[str]) -> HTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):  # keep test output quiet
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            calls.append(self.path)
            if self.path == "/auth/signin":
                ok = (
                    accounts.get(body["email"]) == body["password"] and body.get("type") == "CLIENT"
                )
                code, payload = (
                    (200, {"accessToken": "tok"})
                    if ok
                    else (403, {"message": "Invalid credentials"})
                )
            elif self.path == "/auth/signup":
                if body["email"] in accounts:
                    code, payload = 422, {"message": "Email is already in use"}
                else:
                    accounts[body["email"]] = body["password"]
                    code, payload = 200, {"accessToken": "tok"}
            else:
                code, payload = 404, {}
            data = json.dumps(payload).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def _run(accounts: dict[str, str], user: str = USER, password: str = PASSWORD):
    calls: list[str] = []
    server = _serve(accounts, calls)
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
    assert user == "" or user not in out.stdout + out.stderr
    assert password == "" or password not in out.stdout + out.stderr
    return out, calls


def test_existing_account_signs_in_and_nothing_is_created():
    accounts = {USER: PASSWORD}
    out, calls = _run(accounts)
    assert out.returncode == 0
    assert "already signs in; nothing changed" in out.stdout
    assert calls == ["/auth/signin"]


def test_missing_account_is_created_then_signs_in():
    accounts = {"someone-else@example.invalid": "x"}
    out, calls = _run(accounts)
    assert out.returncode == 0
    assert "service account created" in out.stdout
    assert calls == ["/auth/signin", "/auth/signup", "/auth/signin"]
    assert accounts[USER] == PASSWORD


def test_existing_account_with_other_password_is_reported_not_changed():
    accounts = {USER: "Old-Password-1"}
    out, calls = _run(accounts)
    assert out.returncode == 4
    assert "signup http=422" in out.stdout
    assert "different password" in out.stdout
    assert accounts[USER] == "Old-Password-1"


def test_missing_credentials_fail_before_any_request():
    out, calls = _run({}, user="", password="")
    assert out.returncode == 2
    assert calls == []
