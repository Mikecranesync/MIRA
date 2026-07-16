"""Sourced terminal-marking registry (D6).

Every rule states its governing convention with source metadata, and every
contact-semantic output carries ``state_proof: "never"`` — a terminal number
is a NAMING convention, not evidence of contact position, energization, or
safe state (Safety laws 1-4, 10)."""

from __future__ import annotations

import re

_SRC_60947 = {"source_title": "Low-voltage switchgear - control circuit "
                              "devices: terminal marking scheme (derived)",
              "organization": "IEC/CENELEC", "document_id": "IEC 60947-5-1",
              "section": "auxiliary contact function digits (derived)",
              "confidence": 0.8, "reviewed_date": "2026-07-15", "verification": "secondary_sources_only",
              "note": "two-digit marking: first=sequence, second=function; "
                      "function 1-2 break (NC), 3-4 make (NO)"}
_SRC_50005 = {"source_title": "Terminal markings for control devices incl. "
                              "coil terminals (derived)",
              "organization": "CENELEC", "document_id": "EN 50005/50011",
              "section": "coil terminal designations (derived)",
              "confidence": 0.7, "reviewed_date": "2026-07-15", "verification": "secondary_sources_only",
              "note": "A1/A2 designate coil terminals; polarity is NOT "
                      "derivable from the marking alone"}
_SRC_MAIN = {"source_title": "Main-circuit terminal markings for contactors "
                             "and overload relays (derived)",
             "organization": "IEC/CENELEC", "document_id": "IEC 60947-4-1",
             "section": "main pole and overload auxiliary markings (derived)",
             "confidence": 0.7, "reviewed_date": "2026-07-15", "verification": "secondary_sources_only",
             "note": "1/L1..6/T3 line/load poles; 95-96 NC / 97-98 NO "
                     "overload auxiliaries — device-class gated"}

_COIL = re.compile(r"^[AB]\d$")
_AUX = re.compile(r"^(\d)(\d)$")
_MAIN_POLE = re.compile(r"^([1-6])/(L[123]|T[123])$")


def classify(cp: str, parent_class: str | None = None) -> dict | None:
    """Classify a connection-point string. Returns None when no verified
    convention applies (caller keeps the point as generic, unresolved)."""
    if _COIL.match(cp):
        return {"kind": "connection_point",
                "role": "coil_or_control_terminal",
                "convention": {"role": "coil_or_control_by_convention",
                               "polarity": "unknown",
                               "state_proof": "never",
                               "source": _SRC_50005}}
    m = _AUX.match(cp)
    if m:
        seq, func = m.group(1), m.group(2)
        if cp in ("95", "96", "97", "98"):
            gated = parent_class in {"F", "Q"}
            return {"kind": "contact_terminal",
                    "pair_key": "95-96" if cp in ("95", "96") else "97-98",
                    "convention": {
                        "sequence": seq, "function_digit": func,
                        "role": ("overload_NC_by_convention" if cp in ("95", "96")
                                 else "overload_NO_by_convention"),
                        "device_gated": True,
                        "device_context_compatible": gated,
                        "state_proof": "never", "source": _SRC_MAIN}}
        if func in ("1", "2"):
            return {"kind": "contact_terminal",
                    "pair_key": f"{seq}1-{seq}2",
                    "convention": {"sequence": seq, "function_digit": func,
                                   "role": "NC_by_convention",
                                   "state_proof": "never",
                                   "source": _SRC_60947}}
        if func in ("3", "4"):
            return {"kind": "contact_terminal",
                    "pair_key": f"{seq}3-{seq}4",
                    "convention": {"sequence": seq, "function_digit": func,
                                   "role": "NO_by_convention",
                                   "state_proof": "never",
                                   "source": _SRC_60947}}
        return {"kind": "contact_terminal", "pair_key": None,
                "convention": {"sequence": seq, "function_digit": func,
                               "role": "unknown_function_digit",
                               "state_proof": "never", "source": _SRC_60947}}
    if _MAIN_POLE.match(cp):
        return {"kind": "main_pole_terminal",
                "convention": {"role": "main_pole_by_convention",
                               "printed": cp, "state_proof": "never",
                               "source": _SRC_MAIN}}
    return None
