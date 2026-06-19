"""Offline VQT attachment -- the thin slice of issue #2102 (see VQT_ATTACH_SPEC.md).

Take a compiled asset graph + a values **snapshot** (address -> value readings, what a Modbus poll
returns) and return a NEW graph with each `MAPPED_TO` signal's VQT (Value / Quality / Timestamp) +
freshness populated. Deterministic, offline, read-only -- no PLC I/O, no third-party deps. The same
`attach_values()` will later be fed by a live poll (mira-connect) or the historian (mira-relay); only
the snapshot *source* changes.
"""
from __future__ import annotations

import csv
import io
import json
from dataclasses import dataclass
from datetime import datetime

# Mirrors mira-relay's VALID_QUALITY; copied (not imported) so this subproject stays dependency-free.
VALID_QUALITY = {"good", "bad", "stale", "uncertain"}


@dataclass
class Reading:
    key: str                # Modbus address (default) or signal name (by="name")
    value: object = None
    quality: str = ""
    timestamp: str = ""


def _coerce(value):
    """Best-effort scalar coercion of a snapshot value; '' / None -> None (a no-value reading)."""
    if value is None:
        return None
    s = str(value).strip()
    if s == "":
        return None
    low = s.lower()
    if low in ("true", "false"):
        return low == "true"
    try:
        return int(s)
    except ValueError:
        pass
    try:
        return float(s)
    except ValueError:
        return s


def load_snapshot(text: str, by: str = "address") -> list[Reading]:
    """Parse a values snapshot (CSV or JSON) into Readings. `by` selects the key column.

    CSV header: `address,value[,quality][,timestamp]` (or `signal,...` when by='name').
    JSON: a list of `{address|signal, value, quality?, timestamp?}` (or `{"readings": [...]}`).
    """
    text = (text or "").strip()
    if not text:
        return []
    keycol = "signal" if by == "name" else "address"
    if text[0] in "[{":
        data = json.loads(text)
        rows = data if isinstance(data, list) else data.get("readings", [])
        out = []
        for r in rows:
            key = str(r.get(keycol, r.get("name", ""))).strip()
            if key:
                out.append(Reading(key=key, value=r.get("value"),
                                   quality=str(r.get("quality", "")).strip(),
                                   timestamp=str(r.get("timestamp", "")).strip()))
        return out
    out = []
    for row in csv.DictReader(io.StringIO(text)):
        norm = {(k or "").strip().lower(): (v.strip() if isinstance(v, str) else v)
                for k, v in row.items()}
        key = norm.get(keycol) or norm.get("name") or norm.get("tag") or ""
        if not key:
            continue
        out.append(Reading(key=str(key).strip(), value=norm.get("value"),
                           quality=str(norm.get("quality", "")), timestamp=str(norm.get("timestamp", ""))))
    return out


def _parse_ts(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def _freshness(ts: str, as_of: str | None, max_age: float) -> str:
    if not ts or not as_of:
        return "unknown"
    try:
        delta = (_parse_ts(as_of) - _parse_ts(ts)).total_seconds()
    except ValueError:
        return "unknown"
    return "current" if abs(delta) <= max_age else "stale"


def _quality(coerced_value, raw_quality: str) -> str:
    if coerced_value is None:
        return "bad"
    q = (raw_quality or "").strip().lower()
    if not q:
        return "good"
    return q if q in VALID_QUALITY else "uncertain"


def attach_values(graph: dict, readings, as_of: str | None = None,
                  max_age: float = 30.0, by: str = "address") -> dict:
    """Return a NEW graph with VQT attached to MAPPED_TO signals. Input graph is not mutated."""
    g = json.loads(json.dumps(graph))  # deep copy; never touch the offline artifact
    signals = [n for n in g["nodes"] if n["type"] == "Signal"]
    reg_addr = {n["id"]: n["name"] for n in g["nodes"] if n["type"] == "Register"}

    addr_to_signals: dict[str, list[str]] = {}
    for e in g["edges"]:
        if e["type"] == "MAPPED_TO" and e["to"] in reg_addr:
            addr_to_signals.setdefault(reg_addr[e["to"]], []).append(e["from"])
    name_to_signal: dict[str, list[str]] = {}
    for n in signals:
        name_to_signal.setdefault(n["name"], []).append(n["id"])
    by_id = {n["id"]: n for n in signals}

    for n in signals:
        n["vqt"] = {"value": None, "quality": "unknown", "timestamp": None}
        n["freshness"] = "unknown"

    if as_of is None:
        stamps = [r.timestamp for r in readings if r.timestamp]
        as_of = max(stamps) if stamps else None

    unmatched, q_counts, f_counts = [], {}, {}
    for r in readings:
        targets = (name_to_signal if by == "name" else addr_to_signals).get(r.key)
        if not targets:
            unmatched.append({"key": r.key, "reason": "no %s for '%s' in graph"
                              % ("signal" if by == "name" else "register/address", r.key)})
            continue
        val = _coerce(r.value)
        qual = _quality(val, r.quality)
        fresh = _freshness(r.timestamp, as_of, max_age)
        if fresh == "stale" and qual == "good":
            qual = "stale"
        for sid in targets:
            by_id[sid]["vqt"] = {"value": val, "quality": qual, "timestamp": r.timestamp or None}
            by_id[sid]["freshness"] = fresh
        q_counts[qual] = q_counts.get(qual, 0) + 1
        f_counts[fresh] = f_counts.get(fresh, 0) + 1

    attached = sum(1 for n in signals if n["vqt"]["value"] is not None)
    g["live_summary"] = {
        "as_of": as_of, "by": by, "max_age": max_age, "readings": len(readings),
        "signals_attached": attached, "signals_unsampled": len(signals) - attached,
        "unmatched_readings": unmatched, "quality": q_counts, "freshness": f_counts,
    }
    return g
