"""Industry-standard projections — ISO 14224 fault catalog + UCUM-coded quantities. Deterministic.

The contextualizer already mines the diagnostic depth a grounded answer needs: a fault code with its
description / cause / next-check (``manuals.mine_faults``) and engineering units / ranges / setpoints
(``manuals.mine_specs``). This module reshapes that *existing* evidence into the two standards a
maintenance knowledge graph is expected to speak — it adds NO new extraction:

  * **ISO 14224** (collection of reliability + maintenance data for equipment): a fault becomes
    ``fault code → failure mode → failure mechanism / cause → maintenance action``. We map the
    evidence keys the miner already produces: ``description`` → failure mode,
    ``cause`` → failure mechanism, ``next_check`` → maintenance action.
  * **UCUM** (Unified Code for Units of Measure, https://ucum.org): a captured unit symbol becomes its
    case-sensitive UCUM code + a quantity kind (ISO 80000 / QUDT naming), carried with the value's
    range / setpoint and attached to the signal the value describes.

Pure lookup + reshape; stdlib only; offline. Everything produced is *proposed* — a human approves it
in the Hub. Used by ``bundle.py`` to enrich the i3X + kg_entities / kg_relationships projections.
"""
from __future__ import annotations

# unit symbol (lower-cased, as the miner captures it) -> (UCUM case-sensitive code, quantity kind).
# UCUM codes are case-sensitive; we normalize the lookup key but emit the canonical UCUM string.
UCUM: dict[str, tuple[str, str]] = {
    "hz": ("Hz", "frequency"),
    "khz": ("kHz", "frequency"),
    "a": ("A", "electric current"),
    "ma": ("mA", "electric current"),
    "ka": ("kA", "electric current"),
    "v": ("V", "voltage"),
    "mv": ("mV", "voltage"),
    "kv": ("kV", "voltage"),
    "vac": ("V", "voltage"),
    "vdc": ("V", "voltage"),
    "w": ("W", "power"),
    "kw": ("kW", "power"),
    "mw": ("MW", "power"),
    "va": ("V.A", "apparent power"),
    "kva": ("kV.A", "apparent power"),
    "rpm": ("{rpm}", "rotational frequency"),
    "°c": ("Cel", "temperature"),
    "degc": ("Cel", "temperature"),
    "°f": ("[degF]", "temperature"),
    "degf": ("[degF]", "temperature"),
    "s": ("s", "time"),
    "sec": ("s", "time"),
    "ms": ("ms", "time"),
    "min": ("min", "time"),
    "h": ("h", "time"),
    "hr": ("h", "time"),
    "bar": ("bar", "pressure"),
    "psi": ("[psi]", "pressure"),
    "kpa": ("kPa", "pressure"),
    "mpa": ("MPa", "pressure"),
    "pa": ("Pa", "pressure"),
    "nm": ("N.m", "torque"),
    "n·m": ("N.m", "torque"),
    "mm": ("mm", "length"),
    "cm": ("cm", "length"),
    "m": ("m", "length"),
    "%": ("%", "ratio"),
    "kg": ("kg", "mass"),
    "g": ("g", "mass"),
    "l": ("L", "volume"),
    "gpm": ("[gal_us]/min", "volume flow rate"),
    "lpm": ("L/min", "volume flow rate"),
}


def ucum_quantity(evidence: dict | None) -> dict | None:
    """Map a unit-bearing evidence blob (``units`` + optional ``range`` / ``setpoint``) to a
    UCUM-coded quantity. Returns None when there is no recognized unit (no guessing)."""
    ev = evidence or {}
    unit = (ev.get("units") or "").strip()
    if not unit:
        return None
    hit = UCUM.get(unit.lower())
    if not hit:
        return None
    ucum_code, kind = hit
    q = {"unit": unit, "ucum_code": ucum_code, "quantity_kind": kind, "standard": "UCUM"}
    if ev.get("range"):
        q["range"] = ev["range"]
    if ev.get("setpoint"):
        q["setpoint"] = ev["setpoint"]
    return q


def iso14224_fault(code: str, evidence: dict | None) -> dict | None:
    """Reshape a mined fault into an ISO 14224-aligned record. Returns None unless there is real
    diagnostic depth (a cause or a maintenance action) — a bare code/description is entity-spotting,
    not reliability data, and is already surfaced as a plain fault_code entity."""
    ev = evidence or {}
    cause = ev.get("cause")
    action = ev.get("next_check")
    if not (cause or action):
        return None
    return {
        "standard": "ISO 14224",
        "fault_code": code,
        "failure_mode": ev.get("description") or code,
        "failure_mechanism": cause,        # ISO 14224 "failure mechanism / cause"
        "maintenance_action": action,      # the corrective / next-check step
    }
