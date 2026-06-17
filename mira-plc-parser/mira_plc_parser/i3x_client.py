"""Talk to a live CESMII i3X server -- the ONLY networked part of this package.

The i3X API (https://api.i3x.dev, https://github.com/cesmii/API) is read + value-write: you can read
the server's model (`GET /info`, `GET /namespaces`, `POST /objects/list`) and write VALUES to existing
objects (`PUT /objects/value`), but it exposes NO endpoint to create ObjectTypes/ObjectInstances -- the
server owns its model. So this client does not "push a namespace in". What it does, and what is genuinely
useful when crafting toward i3X, is RECONCILE: handshake the server, then check which of our proposed
namespace nodes already exist there and which are new.

Strictly opt-in and isolated: the offline parser/analysis core never imports this. Stdlib `urllib` only
(no third-party HTTP dependency), so the package stays zero-dep and the .exe stays self-contained.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request

DEFAULT_TIMEOUT = 15


class I3XError(Exception):
    """A reconciliation/connectivity problem talking to an i3X server."""


def _url(base: str, path: str) -> str:
    return base.rstrip("/") + "/" + path.lstrip("/")


def _request(base: str, path: str, method: str, body: dict | None, timeout: float) -> object:
    url = _url(base, path)
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - explicit http(s) URL
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        raise I3XError("%s %s -> HTTP %s" % (method, url, exc.code)) from exc
    except urllib.error.URLError as exc:
        raise I3XError("cannot reach %s (%s)" % (url, exc.reason)) from exc
    except OSError as exc:
        raise I3XError("network error talking to %s (%s)" % (url, exc)) from exc
    if not raw.strip():
        return None
    try:
        return json.loads(raw)
    except ValueError as exc:
        raise I3XError("%s returned non-JSON" % url) from exc


def _unwrap(payload: object) -> object:
    """i3X wraps results in a SuccessResponse envelope; return the inner data when present."""
    if isinstance(payload, dict):
        for key in ("data", "value", "result", "results"):
            if key in payload:
                return payload[key]
    return payload


def info(base: str, timeout: float = DEFAULT_TIMEOUT) -> dict:
    """GET /info -- handshake. Returns the server-info dict (specVersion / serverVersion / ...)."""
    out = _unwrap(_request(base, "/info", "GET", None, timeout))
    return out if isinstance(out, dict) else {"raw": out}


def list_namespaces(base: str, timeout: float = DEFAULT_TIMEOUT) -> list[dict]:
    """GET /namespaces -- the namespaces the server already exposes."""
    out = _unwrap(_request(base, "/namespaces", "GET", None, timeout))
    return list(out) if isinstance(out, list) else []


def existing_ids(base: str, element_ids: list[str], timeout: float = DEFAULT_TIMEOUT) -> set[str]:
    """POST /objects/list with our elementIds -> the set that already exists on the server."""
    if not element_ids:
        return set()
    out = _unwrap(_request(base, "/objects/list", "POST", {"elementIds": list(element_ids)}, timeout))
    found: set[str] = set()
    if isinstance(out, list):
        for item in out:
            if isinstance(item, str):
                found.add(item)
                continue
            if not (isinstance(item, dict) and item.get("elementId")):
                continue
            # i3X echoes the requested elementId even in a NOT-FOUND result, so an elementId alone
            # does not mean "present". Only count it when the per-item result did not fail.
            detail = item.get("responseDetail")
            status = detail.get("status") if isinstance(detail, dict) else None
            failed = (item.get("success") is False) or (status == 404)
            if not failed:
                found.add(item["elementId"])
    return found


def reconcile(base: str, payload: dict, timeout: float = DEFAULT_TIMEOUT) -> dict:
    """Compare an i3X payload (from i3x.to_i3x) against a live server.

    Returns {server, total, existing_count, new_count, existing, new} where `existing`/`new` are the
    elementIds present / absent on the server. Read-only: it never writes to the server.
    """
    instances = payload.get("objectInstances", []) if isinstance(payload, dict) else []
    ids = [i["elementId"] for i in instances if i.get("elementId")]
    present = existing_ids(base, ids, timeout)
    existing = [i for i in ids if i in present]
    new = [i for i in ids if i not in present]
    return {
        "server": base.rstrip("/"),
        "total": len(ids),
        "existing_count": len(existing),
        "new_count": len(new),
        "existing": existing,
        "new": new,
    }
