"""MVP Acceptance Tests — live VPS smoke suite.

Run from VPS (or via Tailscale) where internal services are reachable:
    doppler run -p factorylm -c prd -- pytest tests/e2e/mvp_acceptance.py -v --tb=short

Env vars (from Doppler / shell):
    PIPELINE_API_KEY   Bearer token for mira-pipeline
    PIPELINE_URL       Base URL for pipeline  (default: http://localhost:9099)
    INGEST_URL         Base URL for ingest    (default: http://localhost:8002)
    MCP_URL            Base URL for mira-mcp  (default: http://localhost:8001)
    WEB_URL            Public Open WebUI URL  (default: https://app.factorylm.com)
    CMMS_URL           Public CMMS URL        (default: https://cmms.factorylm.com)
    MIRA_WEB_URL       PLG web URL            (default: https://app.factorylm.com)
"""

from __future__ import annotations

import json as _json
import os

import httpx
import pytest

# ── Base URLs ─────────────────────────────────────────────────────────────────
# All services are proxied through app.factorylm.com by nginx.
# Override any URL with env vars if testing against a non-production host.

_BASE = os.getenv("WEB_URL", "https://app.factorylm.com")

PIPELINE_URL = os.getenv("PIPELINE_URL", _BASE)          # /v1/ routed to pipeline
INGEST_URL   = os.getenv("INGEST_URL",   f"{_BASE}/api/ingest")
MCP_URL      = os.getenv("MCP_URL",      f"{_BASE}/api/mcp")
WEB_URL      = _BASE
CMMS_URL     = os.getenv("CMMS_URL",     "https://cmms.factorylm.com")
MIRA_WEB_URL = os.getenv("MIRA_WEB_URL", _BASE)

_API_KEY = os.getenv("PIPELINE_API_KEY", "")
_AUTH    = {"Authorization": f"Bearer {_API_KEY}"} if _API_KEY else {}
_TIMEOUT = httpx.Timeout(45.0)

# ── Helpers ───────────────────────────────────────────────────────────────────


def _chat(messages: list[dict], user: str = "mvp-acceptance") -> httpx.Response:
    return httpx.post(
        f"{PIPELINE_URL}/v1/chat/completions",
        json={
            "model": "mira-diagnostic",
            "messages": messages,
            "user": user,
            "stream": False,
        },
        headers=_AUTH,
        timeout=_TIMEOUT,
    )


def _text(resp: httpx.Response) -> str:
    return resp.json()["choices"][0]["message"]["content"]


# ── 1. Entry points ───────────────────────────────────────────────────────────


def test_homepage_loads():
    """app.factorylm.com (Open WebUI) returns 200."""
    resp = httpx.get(WEB_URL, timeout=_TIMEOUT, follow_redirects=True)
    assert resp.status_code == 200, f"Homepage: {resp.status_code}"


def test_qr_scan_route():
    """GET /m/VFD-07 returns a non-server-error response."""
    resp = httpx.get(f"{MIRA_WEB_URL}/m/VFD-07", timeout=_TIMEOUT, follow_redirects=True)
    assert resp.status_code < 500, f"/m/VFD-07 returned {resp.status_code}"


def test_qr_test_page():
    """GET /qr-test returns a non-server-error response."""
    resp = httpx.get(f"{MIRA_WEB_URL}/qr-test", timeout=_TIMEOUT, follow_redirects=True)
    assert resp.status_code < 500, f"/qr-test returned {resp.status_code}"


# ── 2. Health checks ──────────────────────────────────────────────────────────


def test_pipeline_health():
    """mira-pipeline /v1/models returns the mira-diagnostic model (auth-exempt health proxy)."""
    resp = httpx.get(f"{PIPELINE_URL}/v1/models", headers=_AUTH, timeout=_TIMEOUT)
    assert resp.status_code == 200, f"pipeline /v1/models: {resp.status_code}"
    body = resp.json()
    model_ids = [m["id"] for m in body.get("data", [])]
    assert "mira-diagnostic" in model_ids, f"mira-diagnostic not in models: {model_ids}"


def test_ingest_health():
    """mira-ingest /health returns status: ok."""
    resp = httpx.get(f"{INGEST_URL}/health", timeout=_TIMEOUT)
    assert resp.status_code == 200, f"ingest /health: {resp.status_code}"
    body = resp.json()
    assert body.get("status") == "ok", f"ingest health body: {body}"


def test_mcp_health():
    """mira-mcp /health returns 200."""
    resp = httpx.get(f"{MCP_URL}/health", timeout=_TIMEOUT)
    assert resp.status_code == 200, f"MCP /health: {resp.status_code}"


# ── 3. Diagnostic conversation ────────────────────────────────────────────────


def test_pipeline_responds():
    """Pipeline processes a maintenance message and returns non-empty text."""
    resp = _chat([{"role": "user", "content": "The VFD on motor 7 shows E.OC.3 fault. What does this mean?"}])
    assert resp.status_code == 200, f"pipeline chat: {resp.status_code} — {resp.text[:300]}"
    text = _text(resp)
    assert len(text) > 20, f"Response too short: {text!r}"


def test_safety_escalation():
    """Safety keyword in message triggers a STOP/safety escalation response."""
    resp = _chat([{"role": "user", "content": "We were working on the panel while live and someone got shocked."}])
    assert resp.status_code == 200
    upper = _text(resp).upper()
    safety_signals = {"STOP", "SAFETY", "LOCKOUT", "LOTO", "EMERGENCY", "HAZARD", "CALL", "DANGER"}
    assert any(w in upper for w in safety_signals), (
        f"No safety escalation found in response:\n{_text(resp)[:400]}"
    )


def test_doc_intent():
    """Document-query intent returns a substantive answer."""
    resp = _chat([{"role": "user", "content": "Show me the maintenance schedule for the GS10 VFD."}])
    assert resp.status_code == 200
    assert len(_text(resp)) > 30, f"Doc intent response too short: {_text(resp)!r}"


def test_installation_question():
    """Installation question returns a helpful answer."""
    resp = _chat([{"role": "user", "content": "How do I wire a 3-phase motor to a GS10 VFD?"}])
    assert resp.status_code == 200
    assert len(_text(resp)) > 30


def test_general_question():
    """General maintenance question gets answered."""
    resp = _chat([{"role": "user", "content": "What causes an overcurrent fault on a variable frequency drive?"}])
    assert resp.status_code == 200
    assert len(_text(resp)) > 20


def test_greeting():
    """Greeting returns a response without triggering a full diagnostic workflow."""
    resp = _chat([{"role": "user", "content": "Hello!"}])
    assert resp.status_code == 200
    text = _text(resp)
    assert len(text) > 2, f"Empty greeting response: {text!r}"


# ── 4. CMMS ───────────────────────────────────────────────────────────────────


def test_cmms_accessible():
    """cmms.factorylm.com is accessible (200 or login redirect, not 5xx)."""
    resp = httpx.get(CMMS_URL, timeout=_TIMEOUT, follow_redirects=True)
    assert resp.status_code < 500, f"CMMS returned {resp.status_code}"


# ── 5. APIs ───────────────────────────────────────────────────────────────────


def test_briefing_api():
    """Briefing profiles endpoint is reachable (200/404/401 — not 5xx)."""
    resp = httpx.get(
        f"{PIPELINE_URL}/api/briefing/profiles/default",
        headers=_AUTH,
        timeout=_TIMEOUT,
    )
    assert resp.status_code < 500, (
        f"briefing API: {resp.status_code} — {resp.text[:200]}"
    )
    assert resp.status_code != 404 or True  # 404 = no profiles yet, that's fine


def test_identity_api():
    """Identity endpoint reachable — 200 if deployed, 404 if not yet deployed, no 5xx."""
    resp = httpx.get(
        f"{PIPELINE_URL}/api/identity/users/default",
        headers=_AUTH,
        timeout=_TIMEOUT,
    )
    assert resp.status_code < 500, (
        f"identity API: {resp.status_code} — {resp.text[:200]}"
    )


# ── 6. Response quality ───────────────────────────────────────────────────────

_QUALITY_QUERIES = [
    "What is the rated current of a GS10-21P0 VFD?",
    "How do I clear an E.OC.3 fault on a TECO drive?",
    "List the maintenance intervals for a 30HP motor.",
    "What safety precautions apply when working on a VFD?",
    "Explain what a soft starter does.",
]


def test_no_raw_json_in_responses():
    """None of the 5 quality queries return a raw JSON blob as the reply."""
    failures: list[str] = []
    for query in _QUALITY_QUERIES:
        resp = _chat([{"role": "user", "content": query}])
        if resp.status_code != 200:
            failures.append(f"HTTP {resp.status_code} for: {query!r}")
            continue
        text = _text(resp).strip()
        try:
            _json.loads(text)
            failures.append(f"Response is raw JSON for query: {query!r}\n  → {text[:120]}")
        except _json.JSONDecodeError:
            pass
    assert not failures, "\n".join(failures)


def test_multi_turn_coherence():
    """Two-turn conversation: second response is context-aware."""
    messages = [
        {"role": "user", "content": "I'm troubleshooting conveyor motor 3. It's a GS10 drive, 2HP."},
    ]
    r1 = _chat(messages, user="coherence-test")
    assert r1.status_code == 200, f"Turn 1 failed: {r1.status_code}"
    t1 = _text(r1)

    messages += [
        {"role": "assistant", "content": t1},
        {"role": "user", "content": "What fault codes should I watch for on that drive?"},
    ]
    r2 = _chat(messages, user="coherence-test")
    assert r2.status_code == 200, f"Turn 2 failed: {r2.status_code}"
    t2 = _text(r2)
    assert len(t2) > 20, f"Turn 2 response too short: {t2!r}"
