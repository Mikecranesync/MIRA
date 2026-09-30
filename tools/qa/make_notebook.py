#!/usr/bin/env python3
"""Create a throwaway notebook and print `notebook=<uuid>` for $GITHUB_OUTPUT.

Exists so the workflow needs no nested heredoc, which is how the first attempt
at wiring capture acceptance into CI broke.
"""
import json
import os
import sys
import urllib.request

base = os.environ.get("ACCEPT_BASE", "https://app-staging.factorylm.com")
cookie = os.environ.get("ACCEPT_COOKIE") or os.environ.get("BETA_GATE_COOKIE") or ""
if "app.factorylm.com" in base:
    print("refusing production", file=sys.stderr)
    raise SystemExit(2)
if not cookie:
    print("ACCEPT_COOKIE required", file=sys.stderr)
    raise SystemExit(2)

req = urllib.request.Request(
    f"{base}/api/equipment-notebooks/",
    data=json.dumps({"displayName": "capture acceptance (CI)"}).encode(),
    method="POST",
    headers={"Content-Type": "application/json", "Cookie": cookie},
)
with urllib.request.urlopen(req, timeout=60) as r:
    d = json.loads(r.read())
print(f"notebook={(d.get('notebook') or d)['id']}")
