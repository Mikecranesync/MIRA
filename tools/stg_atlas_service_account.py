"""Ensure the staging Hub's Atlas service account can sign in (#5205, staging half).

Runs ON the staging host (stdin to `python3 -` under `doppler run --config stg`),
against the staging Atlas backend on 127.0.0.1:4088. Reads ATLAS_API_USER and
ATLAS_API_PASSWORD from the environment and never prints them.

1. Sign in exactly as the Hub does (POST /auth/signin, type CLIENT). 200 -> done.
2. Otherwise sign up that account (POST /auth/signup), then sign in again.

Output is HTTP status codes and a fixed verdict only; this repository's Actions
logs are public. Exit 0 only when the final sign-in returns a token.
Stdlib only: the host's python3 has nothing else installed.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("STG_ATLAS_BASE", "http://127.0.0.1:4088").rstrip("/")


def _post(path: str, body: dict) -> tuple[int, dict]:
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            raw = res.read()
            code = res.status
    except urllib.error.HTTPError as e:
        return e.code, {}
    except (urllib.error.URLError, TimeoutError, OSError):
        return 0, {}
    try:
        return code, json.loads(raw or b"{}")
    except ValueError:
        return code, {}


def _signin(user: str, password: str) -> tuple[int, bool]:
    code, data = _post("/auth/signin", {"email": user, "password": password, "type": "CLIENT"})
    return code, bool(data.get("accessToken") or data.get("token"))


def main() -> int:
    user = os.environ.get("ATLAS_API_USER", "")
    password = os.environ.get("ATLAS_API_PASSWORD", "")
    if not user or not password:
        print("VERDICT: ATLAS_API_USER or ATLAS_API_PASSWORD missing from factorylm/stg")
        return 2

    code, ok = _signin(user, password)
    print(f"signin http={code}")
    if ok:
        print("VERDICT: service account already signs in; nothing changed")
        return 0
    if code == 0:
        print("VERDICT: staging Atlas unreachable; nothing changed")
        return 3

    signup_code, _ = _post(
        "/auth/signup",
        {
            "email": user,
            "password": password,
            "firstName": "FactoryLM",
            "lastName": "Hub",
            "companyName": "FactoryLM Staging",
            "phone": "",
        },
    )
    print(f"signup http={signup_code}")
    code, ok = _signin(user, password)
    print(f"signin after signup http={code}")
    if ok:
        print("VERDICT: service account created; Hub sign-in now works")
        return 0
    if signup_code == 422:
        print("VERDICT: account exists with a different password; Doppler stg and Atlas disagree")
    else:
        print("VERDICT: signup refused; see the staging Atlas log (stg-atlas-signin probe)")
    return 4


if __name__ == "__main__":
    sys.exit(main())
