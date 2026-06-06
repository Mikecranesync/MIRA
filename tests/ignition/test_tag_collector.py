# tests/ignition/test_tag_collector.py
# Pytest suite for the MIRA Ignition tag-collector core (pure logic).
# Verifies value-type inference, quality bands, allowlist fail-closed filtering,
# Phase-2 payload shape, and HMAC-signed POST with retry/backoff — all without
# an Ignition Gateway (system.* I/O is injected).
# Run: cd /Users/charlienode/MIRA && python3 -m pytest tests/ignition/test_tag_collector.py -v

import hashlib
import hmac as hmaclib
import os
import sys

import pytest

# collector.py + allowlist.py live in api/tags; collector adds api/chat for signing.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../ignition/webdev/FactoryLM/api/tags"))

import collector  # noqa: E402


# ── value type inference ─────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "value,expected",
    [
        (True, "bool"),
        (False, "bool"),
        (42, "int"),
        (3.14, "float"),
        ("running", "string"),
        (None, "string"),
    ],
)
def test_infer_value_type(value, expected):
    assert collector.infer_value_type(value) == expected


def test_bool_not_classified_as_int():
    # bool is a subclass of int — must resolve to "bool", not "int".
    assert collector.infer_value_type(True) == "bool"


# ── quality bands ────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "q,expected",
    [
        ("Good", "good"),
        ("Good_Unspecified", "good"),
        ("Bad", "bad"),
        ("Bad_Stale", "stale"),   # stale wins over bad
        ("Stale", "stale"),
        ("Uncertain", "uncertain"),
        ("", "uncertain"),
        (None, "uncertain"),
    ],
)
def test_quality_band(q, expected):
    assert collector.quality_band(q) == expected


# ── reading + payload shape ──────────────────────────────────────────────────


def test_build_reading():
    r = collector.build_reading("[default]Conveyor/Motor_Current_A", 8.3, "Good", ts="2026-06-02T00:00:00Z")
    assert r == {
        "tag_path": "[default]Conveyor/Motor_Current_A",
        "value": 8.3,
        "value_type": "float",
        "quality": "good",
        "ts": "2026-06-02T00:00:00Z",
    }


def test_build_payload_is_ignition_source():
    payload = collector.build_payload("t-1", [{"tag_path": "x"}], source_connection_id="gw-1")
    assert payload["source_system"] == "ignition"  # relay derives simulated=false
    assert payload["tenant_id"] == "t-1"
    assert payload["source_connection_id"] == "gw-1"
    assert payload["tags"] == [{"tag_path": "x"}]


# ── allowlist fail-closed ────────────────────────────────────────────────────


def test_filter_allowlisted_keeps_only_allowed():
    readings = [
        {"tag_path": "[default]Conveyor/Motor_Running"},
        {"tag_path": "[default]Secret/Recipe"},
    ]
    allow = {"[default]Conveyor/Motor_Running"}
    out = collector.filter_allowlisted(readings, allow)
    assert len(out) == 1
    assert out[0]["tag_path"] == "[default]Conveyor/Motor_Running"


def test_filter_allowlisted_empty_allowlist_fails_closed():
    readings = [{"tag_path": "[default]Conveyor/Motor_Running"}]
    assert collector.filter_allowlisted(readings, set()) == []
    assert collector.filter_allowlisted(readings, None) == []


# ── HMAC-signed POST with retry/backoff ──────────────────────────────────────


class _Resp:
    def __init__(self, status):
        self.statusCode = status


def _fake_post(status_sequence):
    """Returns a post_fn that yields the given statuses in order, recording calls."""
    calls = []
    seq = list(status_sequence)

    def _post(url, body_bytes, headers, timeout_ms):
        calls.append({"url": url, "body": body_bytes, "headers": dict(headers)})
        status = seq.pop(0) if seq else 500
        return _Resp(status)

    _post.calls = calls
    return _post


KEY = "test-hmac-key"
TENANT = "00000000-0000-0000-0000-000000000001"


def test_post_success_first_try():
    post = _fake_post([200])
    res = collector.post_with_retry(post, "https://x/api/v1/tags/ingest", KEY, TENANT,
                                    {"source_system": "ignition", "tags": []},
                                    sleep_fn=lambda s: None)
    assert res == {"ok": True, "status": 200, "attempts": 1}
    # HMAC headers present and signature matches the Phase-2 contract.
    h = post.calls[0]["headers"]
    body = post.calls[0]["body"]
    assert h["X-MIRA-Tenant"] == TENANT
    body_hash = hashlib.sha256(body).hexdigest()
    signed = "%s\n%s\n%s\n%s" % (TENANT, h["X-MIRA-Nonce"], h["X-MIRA-Timestamp"], body_hash)
    expected = hmaclib.new(KEY.encode(), signed.encode(), hashlib.sha256).hexdigest()
    assert h["X-MIRA-Signature"] == expected


def test_post_retries_then_succeeds():
    post = _fake_post([503, 200])
    res = collector.post_with_retry(post, "u", KEY, TENANT, {"tags": []},
                                    max_retries=3, sleep_fn=lambda s: None)
    assert res["ok"] is True
    assert res["attempts"] == 2


def test_post_fresh_nonce_per_attempt():
    post = _fake_post([503, 200])
    collector.post_with_retry(post, "u", KEY, TENANT, {"tags": []},
                              max_retries=3, sleep_fn=lambda s: None)
    nonces = [c["headers"]["X-MIRA-Nonce"] for c in post.calls]
    assert len(nonces) == 2
    assert nonces[0] != nonces[1]  # replay protection needs a fresh nonce each retry


def test_post_4xx_stops_early():
    post = _fake_post([401, 200])  # second would succeed, but 4xx must not retry
    res = collector.post_with_retry(post, "u", KEY, TENANT, {"tags": []},
                                    max_retries=3, sleep_fn=lambda s: None)
    assert res["ok"] is False
    assert res["status"] == 401
    assert res["attempts"] == 1


def test_post_exhausts_retries():
    post = _fake_post([503, 503, 503])
    slept = []
    res = collector.post_with_retry(post, "u", KEY, TENANT, {"tags": []},
                                    max_retries=3, backoff_base=0.5,
                                    sleep_fn=lambda s: slept.append(s))
    assert res["ok"] is False
    assert res["attempts"] == 3
    # Backoff between attempts (not after the last): 0.5, 1.0
    assert slept == [0.5, 1.0]
