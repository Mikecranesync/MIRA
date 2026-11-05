"""Mark three named staging Atlas work orders COMPLETE (#5223, owner-approved).

Staging Atlas runs on the free licence: 30 incomplete work orders per company.
The staging cmms-sync copied 30 old 'mike'-tenant Telegram test orders into the
one shared staging company, so no new order can be created. The owner approved
closing exactly three of them (Atlas ids 1, 2, 3) to free room for one real
Living Sheet order. Staging cmms-sync is turned off first, separately, so the
freed slots are not refilled.

Runs ON the staging host (stdin to `python3 -` under `doppler run --config stg`),
against staging Atlas on 127.0.0.1:4088, signed in as the Hub service account
(ATLAS_API_USER / ATLAS_API_PASSWORD, never printed).

All-or-nothing preflight: every target must exist, be OPEN (or already COMPLETE,
which is skipped) and start with its expected title prefix, or nothing changes.
Then PATCH /work-orders/{id}/change-status {status: COMPLETE} with a fixed note
that no repair was performed. Nothing is deleted.

Output is ids, HTTP codes, statuses and a fixed verdict only; this repository's
Actions logs are public, so titles are never printed.
Stdlib only: the host's python3 has nothing else installed.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("STG_ATLAS_BASE", "http://127.0.0.1:4088").rstrip("/")

# Atlas id -> expected title prefix (checked, never printed).
TARGETS = {1: "Siemens VFD - ", 2: "Siemens VFD - ", 3: "Siemens PLC - "}
NOTE = "Closed on staging to free a free-licence slot (#5223). No repair was performed."


def _call(method: str, path: str, body: dict | None = None, token: str = "") -> tuple[int, dict]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            raw, code = res.read(), res.status
    except urllib.error.HTTPError as e:
        return e.code, {}
    except (urllib.error.URLError, TimeoutError, OSError):
        return 0, {}
    try:
        data = json.loads(raw or b"{}")
    except ValueError:
        return code, {}
    return code, data if isinstance(data, dict) else {}


def main() -> int:
    user = os.environ.get("ATLAS_API_USER", "")
    password = os.environ.get("ATLAS_API_PASSWORD", "")
    if not user or not password:
        print("VERDICT: ATLAS_API_USER or ATLAS_API_PASSWORD missing from factorylm/stg")
        return 2

    code, data = _call(
        "POST", "/auth/signin", {"email": user, "password": password, "type": "CLIENT"}
    )
    print(f"signin http={code}")
    token = data.get("accessToken") or data.get("token") or ""
    if not token:
        print("VERDICT: service account cannot sign in; nothing changed")
        return 3

    to_close = []
    for wo_id, prefix in TARGETS.items():
        code, wo = _call("GET", f"/work-orders/{wo_id}", token=token)
        status = wo.get("status", "")
        title_ok = str(wo.get("title", "")).startswith(prefix)
        print(f"preflight id={wo_id} http={code} status={status or '-'} title_match={title_ok}")
        if code != 200 or not title_ok or status not in ("OPEN", "COMPLETE"):
            print("VERDICT: preflight failed; nothing changed")
            return 4
        if status == "OPEN":
            to_close.append(wo_id)

    failed = False
    for wo_id in to_close:
        code, wo = _call(
            "PATCH",
            f"/work-orders/{wo_id}/change-status",
            {"status": "COMPLETE", "feedback": NOTE},
            token=token,
        )
        print(f"close id={wo_id} http={code} status={wo.get('status', '-')}")
        failed = failed or code != 200 or wo.get("status") != "COMPLETE"

    if failed:
        print("VERDICT: at least one close failed; see lines above")
        return 5
    print(f"VERDICT: closed {len(to_close)}, already complete {len(TARGETS) - len(to_close)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
