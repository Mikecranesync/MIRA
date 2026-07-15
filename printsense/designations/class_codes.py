"""Sourced device class-code registry (D7).

Candidates only — a class is SELECTED exclusively when a proving profile or
package-scoped legend justifies it (``requires_project_legend`` defaults
True). Meanings are short derived noun phrases (copyright-safe), each rule
carrying source metadata. Entries are seeded from the standards review;
UNVERIFIED entries say so.
"""

from __future__ import annotations

_SRC_81346 = {"source_title": "Industrial systems - structuring principles "
                              "and reference designations - Part 2: letter "
                              "codes (derived)",
              "organization": "IEC/CENELEC", "document_id": "IEC 81346-2",
              "section": "class tables (derived summary)",
              "confidence": 0.7, "verified_date": "2026-07-15",
              "note": "derived candidate meanings; edition differences exist"}
_SRC_DIN = {"source_title": "Legacy German drawing practice (derived)",
            "organization": "DIN", "document_id": "DIN 40719-2 (withdrawn)",
            "section": "letter code usage (derived summary)",
            "confidence": 0.5, "verified_date": "2026-07-15",
            "note": "older drawings may follow this; UNVERIFIED per-project"}

CLASS_CODES: dict[str, list[dict]] = {
    "K": [{"meaning": "relay / contactor (switching, control circuit)",
           **_SRC_DIN},
          {"meaning": "processing / signal switching object", **_SRC_81346}],
    "Q": [{"meaning": "power circuit switching device (breaker, disconnector,"
                      " motor contactor)", **_SRC_81346}],
    "F": [{"meaning": "protection device (fuse, overload, protective relay)",
           **_SRC_81346}],
    "M": [{"meaning": "motor / driving object", **_SRC_81346}],
    "S": [{"meaning": "control switch / pushbutton / selector", **_SRC_DIN},
          {"meaning": "signal-source or switching object (edition-dependent)",
           **_SRC_81346}],
    "B": [{"meaning": "sensor / transducer (measurement conversion)",
           **_SRC_81346}],
    "X": [{"meaning": "terminal / connecting object", **_SRC_81346}],
    "XS": [{"meaning": "socket / connector (connecting object subtype)",
            **_SRC_DIN}],
    "W": [{"meaning": "cable / conductor / guiding object", **_SRC_81346}],
    "T": [{"meaning": "transformer / signal converter", **_SRC_81346}],
    "G": [{"meaning": "generator / power supply source", **_SRC_81346}],
    "U": [{"meaning": "keeping objects in a defined position (current-edition "
                      "candidate)", **_SRC_81346},
          {"meaning": "converter / drive (field convention - UNVERIFIED "
                      "against any edition text)",
           **{**_SRC_DIN, "confidence": 0.15,
              "note": "field lore only; standards review could not verify"}}],
    "A": [{"meaning": "assembly / subassembly (composite object)",
           **_SRC_81346}],
    "H": [{"meaning": "signalling / indicating device (lamp, horn)",
           **_SRC_DIN}],
    "P": [{"meaning": "measuring / indicating instrument", **_SRC_81346}],
    "E": [{"meaning": "miscellaneous (lighting, heating) - edition-dependent",
           **_SRC_DIN}],
}


def lookup(code: str) -> dict:
    """D7 contract: candidates, never a silent selection."""
    candidates = CLASS_CODES.get(code.upper(), [])
    return {
        "raw_code": code,
        "candidate_classes": [c["meaning"] for c in candidates],
        "selected_class": None,
        "profile": None,
        "source_rules": candidates,
        "confidence": 0.0 if not candidates else 0.4,
        "requires_project_legend": True,
    }
