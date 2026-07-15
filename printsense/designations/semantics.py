"""Connection-point / contact semantics (D5/D6).

Builds child-entity classifications under a parent designation. Never merges
distinct terminals, never infers continuity, never asserts state."""

from __future__ import annotations

import re

from . import contact_markings

_NUMERIC = re.compile(r"^\d+$")
_ALNUM_POINT = re.compile(r"^[A-Za-z]+\d*$")
_COLOR_CORES = {"GNYE", "GN", "YE", "BU", "BN", "BK", "GY", "WH", "RD",
                "OG", "VT", "PK", "TQ"}
# device classes that plausibly carry an EN 50005 coil: relays/contactors and
# power-switching devices. An A1 on a sensor/instrument/motor is NOT a coil
# (EU-semantics review) — it stays a generic connection point.
_COIL_BEARING_CLASSES = {"K", "Q", None}


def classify_connection_point(cp: str, parent_class: str | None) -> dict:
    """Classify one connection point; unknown conventions stay unresolved."""
    conv = contact_markings.classify(cp, parent_class)
    if conv is not None and parent_class not in {"X", "XS", "W"}:
        if conv.get("role") == "coil_or_control_terminal" and \
                parent_class not in _COIL_BEARING_CLASSES:
            return {"raw": cp, "kind": "connection_point",
                    "convention": {"role": "a_series_terminal_label",
                                   "note": f"A/B-series label on class "
                                           f"{parent_class!r}: coil semantics "
                                           "not assumed for this device class",
                                   "state_proof": "never"}}
        out = {"raw": cp, **conv}
        if out["kind"] == "connection_point":
            out.setdefault("role", "coil_or_control_terminal")
        return out
    if parent_class == "W" and (cp.upper() in _COLOR_CORES
                                or _NUMERIC.match(cp)):
        return {"raw": cp, "kind": "conductor_core",
                "convention": {"role": "core_color_code"
                               if not _NUMERIC.match(cp)
                               else "numbered_core",
                               "state_proof": "never"}}
    if parent_class == "XS":
        return {"raw": cp, "kind": "connector_pin",
                "convention": {"role": "connector_pin", "state_proof": "never"}}
    if parent_class == "X":
        return {"raw": cp, "kind": "terminal",
                "convention": {"role": "terminal", "state_proof": "never"}}
    if _ALNUM_POINT.match(cp) and not _NUMERIC.match(cp):
        return {"raw": cp, "kind": "port",
                "convention": {"role": "port_or_interface",
                               "state_proof": "never"}}
    return {"raw": cp, "kind": "connection_point",
            "convention": {"role": "unknown", "state_proof": "never"}}


def changeover_group(common: str, nc: str, no: str) -> dict:
    """D5/D6: one changeover contact group — branches related, never merged,
    and never a statement about which branch is currently made.

    WHICH terminal digit is the common is deliberately NOT encoded: the
    standards review returned conflicting claims (UNVERIFIED) — the caller
    supplies the assignment from drawing/device evidence. Likewise a bare
    'x4' terminal's pair_key from contact_markings is convention-only:
    in a changeover group its true companion is the common terminal, and
    group membership must come from the drawing, never the number."""
    return {
        "common": common,
        "nc_branch": f"{common}-{nc}",
        "no_branch": f"{common}-{no}",
        "group_key": f"{common}-{nc}-{no}",
        "state_proof": "never",
    }
