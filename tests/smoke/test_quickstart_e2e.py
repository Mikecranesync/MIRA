#!/usr/bin/env python3
"""End-to-end smoke check for the public Quickstart chat path (GTM RED #3).

Dependency-light (stdlib only — no requests, no Playwright) so it runs anywhere:
local dev box, CI runner, or by hand after a prod deploy.

Asserts the stranger-facing /api/quickstart/ask contract:
  1. A real maintenance question returns HTTP 200 with a non-empty answer.
  2. The reply carries >=1 citation OR an explicit "no docs" refusal (cite-or-
     refuse — never a confident answer with zero grounding).
  3. The per-IP rate limiter trips to HTTP 429 under a rapid flood.

Target defaults to localhost; override for prod:
    QUICKSTART_SMOKE_URL=https://app.factorylm.com python tests/smoke/test_quickstart_e2e.py
The 429 flood is localhost-only by default (flooding prod on every deploy is
antisocial and can't pass pre-deploy); enable against a remote with
    SMOKE_RATE_LIMIT_CHECK=1
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("QUICKSTART_SMOKE_URL", "http://localhost:3000").rstrip("/")
ENDPOINT = f"{BASE}/api/quickstart/ask"
RATE_LIMIT_CHECK = os.environ.get("SMOKE_RATE_LIMIT_CHECK") == "1" or "localhost" in BASE
# Phrases the cite-or-refuse system prompt emits when the KB has no coverage.
REFUSAL_MARKERS = ("don't have manuals", "no manuals", "sign up to upload", "don't have manual")


def _post(payload: dict, timeout: int = 45, url: str = ENDPOINT, _redirects: int = 0):
    """POST JSON; return (status_code, parsed_body_or_text).

    Follows 307/308 with the POST body intact (Next.js `trailingSlash` 308-
    redirects /api/quickstart/ask → .../ask/). urllib won't follow 308 for POST,
    so we do it by hand — once.
    """
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        if e.code in (307, 308) and _redirects < 2:
            loc = e.headers.get("Location")
            if loc:
                return _post(payload, timeout, urllib.parse.urljoin(url, loc), _redirects + 1)
        body = e.read().decode()
        try:
            return e.code, json.loads(body)
        except json.JSONDecodeError:
            return e.code, body


def check_grounded_answer() -> None:
    status, body = _post({"question": "What causes a VFD to overheat?"})
    assert status == 200, f"expected 200, got {status}: {body}"
    assert isinstance(body, dict), f"expected JSON object, got {body!r}"
    answer = (body.get("answer") or "").strip()
    assert len(answer) > 20, f"answer too short / empty: {answer!r}"
    citations = body.get("citations")
    assert isinstance(citations, list), f"citations must be a list, got {citations!r}"
    # Cite-or-refuse: either we grounded (>=1 citation) or we explicitly refused.
    refused = any(m in answer.lower() for m in REFUSAL_MARKERS)
    assert citations or refused, (
        "answer has no citations and is not an explicit no-docs refusal "
        f"(possible ungrounded answer): {answer!r}"
    )
    print(f"  ✓ grounded answer: {len(answer)} chars, {len(citations)} citation(s), refused={refused}")


def check_rate_limit() -> None:
    if not RATE_LIMIT_CHECK:
        print("  ~ rate-limit flood skipped (set SMOKE_RATE_LIMIT_CHECK=1 to run against a remote)")
        return
    # Empty-body POSTs short-circuit at the 400 (missing question) AFTER the
    # rate-limit check, so this floods the 20/min limiter WITHOUT burning cascade
    # quota. >20 rapid requests in the window must return 429.
    codes = [_post({}, timeout=10)[0] for _ in range(25)]
    assert 429 in codes, f"limiter never tripped to 429 in 25 rapid POSTs: {codes}"
    print(f"  ✓ rate limiter tripped to 429 ({codes.count(429)}/25 limited)")


def main() -> int:
    print(f"Quickstart smoke → {ENDPOINT}")
    failures = []
    for name, fn in (("grounded_answer", check_grounded_answer), ("rate_limit", check_rate_limit)):
        try:
            fn()
        except AssertionError as e:
            failures.append(name)
            print(f"  ✗ {name}: {e}")
        except Exception as e:  # noqa: BLE001 — surface network/transport errors as failures
            failures.append(name)
            print(f"  ✗ {name}: {type(e).__name__}: {e}")
    if failures:
        print(f"FAIL: {', '.join(failures)}")
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
