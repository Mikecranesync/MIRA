"""Independently verify staging Atlas work order 1602 (#5223, owner-approved).

Order 1602 was created by the Hub outbox for the fictional Living Sheet job
9ff99b8f (synthetic tenant 0099). The Hub reported verified_by_readback; this
helper checks the order from outside the Hub, straight against Atlas:

  identity   GET /work-orders/1602 returns id 1602 and a non-empty title
  source     description carries the create event's marker exactly once and
             names the source job id
  duplicates no other order in the company carries that marker (full scan of
             /work-orders/search; an incomplete scan is a failure, never a pass)
  finish     the job's finish note (its own marker) is on 1602 exactly once

MODE=verify (default) is read-only. MODE=complete runs every check first and,
only if all pass, sets 1602 (and nothing else) COMPLETE, then reads it back and
re-runs the checks. Nothing is deleted.

Runs ON the staging host (stdin to `python3 -` under `doppler run --config stg`),
against staging Atlas on 127.0.0.1:4088, signed in as the Hub service account
(ATLAS_API_USER / ATLAS_API_PASSWORD, never printed). Actions logs are public:
output is ids, HTTP codes, statuses, counts and booleans only, never titles.
Stdlib only: the host's python3 has nothing else installed.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("STG_ATLAS_BASE", "http://127.0.0.1:4088").rstrip("/")

ORDER_ID = 1602
JOB_ID = "9ff99b8f-eeb6-4319-b71c-71360c958cf0"
CREATE_MARKER = "[MIRA:7337af55-68ba-4241-a340-9c2d95f7d6ab]"
FINISH_MARKER = "[MIRA:7bb50d64-d4b3-471d-b75d-c0b2330f1098]"
PAGE_SIZE = 25
PAGE_CAP = 80
NOTE = "Closed on staging after acceptance verification (#5223). Fictional test order."


def _call(method: str, path: str, body: dict | None = None, token: str = "") -> tuple[int, object]:
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
        return code, json.loads(raw or b"{}")
    except ValueError:
        return code, {}


def _count(text: object, marker: str) -> int:
    return str(text or "").count(marker)


def _check(token: str) -> tuple[bool, str]:
    """All read-only checks. Returns (passed, status)."""
    ok = True
    code, wo = _call("GET", f"/work-orders/{ORDER_ID}", token=token)
    wo = wo if isinstance(wo, dict) else {}
    status = str(wo.get("status") or "-")
    identity = code == 200 and wo.get("id") == ORDER_ID and bool(str(wo.get("title") or "").strip())
    desc = wo.get("description")
    marker_n = _count(desc, CREATE_MARKER)
    job_ref = JOB_ID in str(desc or "")
    print(
        f"order id={ORDER_ID} http={code} identity={identity} status={status} "
        f"priority={wo.get('priority') or '-'} create_marker={marker_n} job_ref={job_ref}"
    )
    ok = ok and identity and marker_n == 1 and job_ref

    matches: list = []
    complete_scan = False
    pages = 0
    for page in range(PAGE_CAP):
        code, res = _call(
            "POST", "/work-orders/search", {"pageSize": PAGE_SIZE, "pageNum": page}, token
        )
        items = res.get("content") if isinstance(res, dict) else None
        if code != 200 or not isinstance(items, list):
            print(f"search page={page} http={code}")
            break
        pages += 1
        matches += [
            i.get("id")
            for i in items
            if isinstance(i, dict) and _count(i.get("description"), CREATE_MARKER)
        ]
        if len(items) < PAGE_SIZE:
            complete_scan = True
            break
    print(f"duplicates scan_complete={complete_scan} pages={pages} marker_orders={sorted(matches)}")
    ok = ok and complete_scan and matches == [ORDER_ID]

    code, comments = _call("POST", f"/comments/search/{ORDER_ID}", {}, token)
    comments = comments if isinstance(comments, list) else []
    # Atlas mixes synthetic history rows (system=true) into this list; only a
    # technician note counts, as in mira-hub's AtlasWriteProvider.findByMarker.
    finish_n = sum(
        _count(c.get("content"), FINISH_MARKER)
        for c in comments
        if isinstance(c, dict) and not c.get("system") and isinstance(c.get("content"), str)
    )
    print(f"comments http={code} total={len(comments)} finish_marker={finish_n}")
    ok = ok and code == 200 and finish_n == 1
    return ok, status


def main() -> int:
    mode = os.environ.get("MODE", "verify")
    if mode not in ("verify", "complete"):
        print("VERDICT: MODE must be verify or complete")
        return 2
    user = os.environ.get("ATLAS_API_USER", "")
    password = os.environ.get("ATLAS_API_PASSWORD", "")
    if not user or not password:
        print("VERDICT: ATLAS_API_USER or ATLAS_API_PASSWORD missing from factorylm/stg")
        return 2

    code, data = _call(
        "POST", "/auth/signin", {"email": user, "password": password, "type": "CLIENT"}
    )
    print(f"signin http={code}")
    token = (data.get("accessToken") or data.get("token") or "") if isinstance(data, dict) else ""
    if not token:
        print("VERDICT: service account cannot sign in; nothing changed")
        return 3

    ok, status = _check(token)
    if not ok:
        print("VERDICT: FAIL; nothing changed")
        return 4
    if mode == "verify":
        print(f"VERDICT: PASS status={status}")
        return 0

    if status != "COMPLETE":
        code, wo = _call(
            "PATCH",
            f"/work-orders/{ORDER_ID}/change-status",
            {"status": "COMPLETE", "feedback": NOTE},
            token,
        )
        got = wo.get("status", "-") if isinstance(wo, dict) else "-"
        print(f"complete id={ORDER_ID} http={code} status={got}")
    ok, status = _check(token)
    if not ok or status != "COMPLETE":
        print(f"VERDICT: FAIL after complete; status={status}")
        return 5
    print("VERDICT: PASS status=COMPLETE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
