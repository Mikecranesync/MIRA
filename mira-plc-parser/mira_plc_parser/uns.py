"""Propose a standardized UNS / ISA-95 namespace from a parsed PLC report.

The parser already extracts *what* is in a program (tags, asset candidates, VFD signal roles). This
turns that into *where each tag belongs* in a Unified Namespace -- an ISA-95 path of the shape:

    enterprise / site / area / line / asset / signal

The parse can only fill the LOWER levels it can see -- the `asset` (from asset candidates / tag name
prefixes) and the standardized `signal` leaf (from VFD signal roles, else the slugged tag name). The
UPPER levels (enterprise / site / area / line) are plant context the export does not contain, so they
come from a `prefix` the user sets once (the interactive part); a sensible default is derived from the
controller name.

Deterministic, stdlib-only, no LLM, no network. Output is JSON-safe and feeds both the CLI report and
the desktop Namespace Builder GUI.
"""
from __future__ import annotations

import re

# the standardized signal vocabulary the parser already speaks (see analyze._vfd_signal_candidates)
_ROLE_WORDS = ("setpoint", "frequency", "current", "fault", "voltage", "speed", "torque",
               "running", "command", "comm", "warning", "temperature")

# default UNS levels when the export gives no plant context. Users override these in the GUI/CLI.
DEFAULT_PREFIX = {"enterprise": "enterprise", "site": "site1", "area": "area1", "line": "line1"}
PREFIX_LEVELS = ("enterprise", "site", "area", "line")


def slug(text: str) -> str:
    """UNS segment slug: lowercase, runs of non-alphanumeric collapsed to '_', trimmed."""
    s = re.sub(r"[^a-z0-9]+", "_", (text or "").lower()).strip("_")
    return s or "x"


def default_prefix(report: dict) -> dict:
    """Seed the four upper UNS levels. `line` defaults to the controller name so a fresh parse lands
    somewhere meaningful; the rest are generic placeholders the user renames."""
    pref = dict(DEFAULT_PREFIX)
    controller = (report or {}).get("controller")
    if controller:
        pref["line"] = slug(controller)
    return pref


def _role_from_detail(detail: str) -> str:
    """'candidate role: frequency' -> 'frequency'. Falls back to the first known role word found."""
    d = (detail or "").lower()
    marker = "candidate role:"
    if marker in d:
        tail = d.split(marker, 1)[1].strip()
        tail = re.split(r"[^a-z]+", tail)[0] if tail else ""
        if tail:
            return tail
    for w in _ROLE_WORDS:
        if w in d:
            return w
    return ""


def _signal_index(report: dict) -> dict:
    """tag name -> standardized signal leaf, for tags the parser flagged as VFD signals."""
    out: dict[str, str] = {}
    for c in (report or {}).get("vfd_signal_candidates", []):
        role = _role_from_detail(c.get("detail", ""))
        if c.get("name") and role:
            out[c["name"]] = role
    return out


def _asset_index(report: dict) -> list[tuple[str, str]]:
    """List of (asset_slug, asset_name_lower) from asset candidates, longest name first so a more
    specific asset wins when several prefix-match a tag."""
    assets = []
    for a in (report or {}).get("asset_candidates", []):
        name = a.get("name") or ""
        if name:
            assets.append((slug(name), name.lower()))
    assets.sort(key=lambda t: len(t[1]), reverse=True)
    return assets


def _asset_for_tag(tag_name: str, assets: list[tuple[str, str]]) -> str:
    """Best asset segment for a tag: the asset whose name prefixes the tag name (Conv -> Conv_Fault).
    Returns '' if none match, so the tag sits directly under the line."""
    low = (tag_name or "").lower()
    for aslug, aname in assets:
        if low == aname or low.startswith(aname):
            return aslug
    return ""


def propose_uns(report: dict, prefix: dict | None = None) -> list[dict]:
    """Propose a UNS path for every tag in the report.

    Returns a list of {tag, data_type, path, segments, signal, asset, confidence, source, evidence},
    one per tag, in tag order. `path` is '/'-joined (UNS topic style); `segments` lets a caller build
    an ltree or any other encoding. Confidence:
      high   -- standardized signal AND an asset matched
      medium -- one of the two
      low    -- neither (raw slugged leaf directly under the line)
    """
    if not (report or {}).get("handled"):
        return []
    pref = dict(DEFAULT_PREFIX)
    pref.update(default_prefix(report))
    if prefix:
        pref.update({k: v for k, v in prefix.items() if k in PREFIX_LEVELS and v})

    signals = _signal_index(report)
    assets = _asset_index(report)
    out = []
    for t in report.get("tag_dictionary", []):
        name = t.get("name", "")
        standardized = name in signals
        signal = signals[name] if standardized else slug(name)
        asset = _asset_for_tag(name, assets)

        if standardized and asset:
            conf = "high"
        elif standardized or asset:
            conf = "medium"
        else:
            conf = "low"

        segs = {
            "enterprise": slug(pref["enterprise"]),
            "site": slug(pref["site"]),
            "area": slug(pref["area"]),
            "line": slug(pref["line"]),
            "asset": asset,        # '' if unmatched
            "signal": signal,
        }
        parts = [segs["enterprise"], segs["site"], segs["area"], segs["line"]]
        if asset:
            parts.append(asset)
        parts.append(signal)
        out.append({
            "tag": name,
            "data_type": t.get("data_type", ""),
            "path": "/".join(parts),
            "segments": segs,
            "signal": signal,
            "asset": asset,
            "standardized": standardized,
            "confidence": conf,
            "source": "proposed",
            "evidence": ("VFD signal role" if standardized else "tag name") +
                        ((" + asset '%s'" % asset) if asset else ""),
        })
    return out
