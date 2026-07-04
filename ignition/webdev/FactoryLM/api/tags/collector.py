# collector.py — MIRA Ignition tag-collector core (pure logic, no system.* imports).
#
# Importable from BOTH:
#   * Jython 2.7 inside the Ignition Gateway (the tag-stream timer script)
#   * Python 3 under pytest (tests/ignition/test_tag_collector.py)
#
# This is the customer-deployable collector's brain. It builds the Phase-2
# ingestion payload (POST /api/v1/tags/ingest — see mira-relay/tag_ingest.py),
# infers value types + quality bands, enforces the approved_tags allowlist
# (reusing allowlist.py), and posts with HMAC signing (reusing signing.py) and
# bounded retry/backoff. All Ignition I/O (system.tag, system.net) is injected
# by the caller so this module is fully unit-testable without a Gateway.
#
# REUSE, not duplication:
#   * allowlist : api/tags/allowlist.py (same dir) — load_allowlist / tag_in_allowlist
#   * signing   : api/chat/signing.py  (sibling)   — build_headers (HMAC-SHA256)
#   Both are pure-stdlib helpers the repo already ships for exactly this reuse.
#
# Ref: docs/integrations/ignition-tag-collector.md
#      docs/plans/current-state-gap-closure-plan.md §3 G8

import json
import os
import sys
import time

# allowlist.py is a same-directory sibling.
from allowlist import load_allowlist, resolve_allowlist_path, tag_in_allowlist

# signing.py lives in api/chat/ — add it to the path so we reuse the canonical
# HMAC signer rather than duplicating it. Same relative-path pattern allowlist.py
# uses for its default approved_tags.json locations. When deploying to a Gateway
# whose script scope cannot cross-import, place collector.py + signing.py +
# allowlist.py together in the project script library (see the integration doc).
# In Ignition's Jython script library __file__ is undefined and signing.py is a
# flat sibling module, so the sys.path dance below is only needed for the
# non-Ignition (api/chat) source layout. Guard it so import works in both.
try:
    _CHAT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "chat")
    if _CHAT_DIR not in sys.path:
        sys.path.insert(0, _CHAT_DIR)
except NameError:
    pass  # __file__ undefined (Ignition script resource); signing is a flat sibling
from signing import build_headers  # noqa: E402  (path set above)


DEFAULT_INGEST_URL = "https://api.factorylm.com/api/v1/tags/ingest"
SOURCE_SYSTEM = "ignition"


def infer_value_type(value):
    """Map a tag value to the Phase-2 value_type discriminator.

    bool|int|float|string. bool is checked before int because in Python (and
    Jython) bool is a subclass of int.
    """
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int):
        return "int"
    # Jython 2.7 exposes Java Long as `long`; match by type name so this
    # module imports cleanly under py3 (which has no `long`).
    if type(value).__name__ == "long":
        return "int"
    if isinstance(value, float):
        return "float"
    return "string"


def quality_band(ignition_quality):
    """Map an Ignition quality string to good|bad|stale|uncertain.

    Order matters: 'good' wins; then 'stale' (e.g. 'Bad_Stale' → stale);
    then 'bad'; else uncertain.
    """
    if ignition_quality is None:
        return "uncertain"
    q = str(ignition_quality).lower()
    if "good" in q:
        return "good"
    if "stale" in q:
        return "stale"
    if "bad" in q:
        return "bad"
    return "uncertain"


def build_reading(tag_path, value, ignition_quality, ts=None):
    """Build one Phase-2 tag reading dict."""
    return {
        "tag_path": tag_path,
        "value": value,
        "value_type": infer_value_type(value),
        "quality": quality_band(ignition_quality),
        "ts": ts,
    }


def filter_allowlisted(readings, allowlist):
    """Keep only readings whose tag_path is in the allowlist set. Fail-closed:
    an empty/None allowlist drops everything."""
    if not allowlist:
        return []
    return [r for r in readings if tag_in_allowlist(r.get("tag_path", ""), allowlist)]


def load_allowlist_set():
    """Resolve + load the approved_tags allowlist. Fail-closed: returns an
    empty set (drops all tags) when no allowlist file is found."""
    path = resolve_allowlist_path()
    if not path:
        return set()
    return load_allowlist(path)


def build_payload(tenant_id, readings, source_connection_id=None):
    """Build the POST /api/v1/tags/ingest batch body.

    source_system is always 'ignition' here — the relay derives simulated=false
    from it, so a real Ignition gateway can never be mistaken for the simulator.
    """
    return {
        "source_system": SOURCE_SYSTEM,
        "source_connection_id": source_connection_id,
        "tenant_id": tenant_id,
        "tags": readings,
    }


def post_with_retry(
    post_fn,
    url,
    hmac_key,
    tenant_id,
    payload,
    max_retries=3,
    backoff_base=0.5,
    timeout_ms=5000,
    sleep_fn=time.sleep,
    json_encode=json.dumps,
):
    """POST the signed payload with bounded exponential backoff.

    Args:
        post_fn: injected callable (url, body_bytes, headers, timeout_ms) ->
                 object with a .statusCode attribute (or an int). Wraps
                 system.net.httpClient().post() in the Gateway; a fake in tests.
        max_retries: total attempts (>=1). A fresh HMAC nonce+timestamp is
                 generated per attempt (the relay rejects replayed nonces and
                 stale timestamps), so each retry is independently valid.

    Returns:
        dict: {ok, status, attempts}
    """
    body_bytes = json_encode(payload).encode("utf-8")
    last_status = None
    attempts = 0
    for attempt in range(max(1, max_retries)):
        attempts = attempt + 1
        # Fresh signature per attempt — new nonce + timestamp.
        headers = build_headers(hmac_key, tenant_id, body_bytes)
        try:
            resp = post_fn(url, body_bytes, headers, timeout_ms)
            status = getattr(resp, "statusCode", resp)
            last_status = status
            if status == 200:
                return {"ok": True, "status": status, "attempts": attempts}
            # 4xx (auth/validation) won't fix themselves on retry — stop early.
            if isinstance(status, int) and 400 <= status < 500:
                return {"ok": False, "status": status, "attempts": attempts}
        except Exception as exc:  # noqa: BLE001  (Jython: catch broadly, log upstream)
            last_status = "exception: %s" % str(exc)
        # Backoff before the next attempt (not after the final one).
        if attempt < max(1, max_retries) - 1:
            sleep_fn(backoff_base * (2 ** attempt))
    return {"ok": False, "status": last_status, "attempts": attempts}
