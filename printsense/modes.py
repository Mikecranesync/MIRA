"""Explicit degraded product modes (PR-B of the degraded-mode program).

Three runtime modes with honest, non-overlapping claims:

- ``one_off_page`` — the existing single-page interpret path; NEVER claims
  whole-system reconstruction from one page.
- ``package_scout`` — preliminary package inventory; the result envelope
  ALWAYS carries the verbatim banner below.
- ``full_reconstruction`` — HARD-gated on capability qualification
  (``cross_reference_extraction`` AND ``system_reconstruction``); when
  unavailable, returns the explicit ``advanced_reasoning_unavailable`` state
  (callers queue a frontier packet). No silent fallback; Scout output is
  never labeled reconstruction.
"""

from __future__ import annotations

from .providers import reconstruction_gate

SCOUT_BANNER = ("Preliminary package inventory — full system reconstruction "
                "has not been performed.")

MODES = ("one_off_page", "package_scout", "full_reconstruction")

ONE_OFF_CAPABILITIES = (
    "ocr", "page_classification", "visible_device_inventory",
    "visible_terminal_wire_cable_designation_extraction",
    "visible_circuit_explanation", "safety_warnings",
    "unreadable_region_reporting", "honest_uncertainty",
)


def one_off_page_envelope(result: dict) -> dict:
    """Wrap a single-page interpret result with honest scope metadata."""
    return {"mode": "one_off_page",
            "scope": "single_page",
            "supported": list(ONE_OFF_CAPABILITIES),
            "system_reconstruction_performed": False,
            "system_reconstruction_claim_forbidden": True,
            "result": result}


def package_scout_envelope(inventory: dict, degraded_reason: str | None = None) -> dict:
    """Wrap Scout pipeline outputs; the banner is non-optional."""
    return {"mode": "package_scout",
            "banner": SCOUT_BANNER,
            "system_reconstruction_performed": False,
            "degraded_mode_reason": degraded_reason
            or "frontier reconstruction capability not qualified",
            "inventory": inventory}


def full_reconstruction_entry(registry: dict | None = None) -> dict:
    """Gate check for full reconstruction — explicit state, never a fallback."""
    gate = reconstruction_gate(registry=registry)
    if gate["state"] != "available":
        return {"mode": "full_reconstruction",
                "state": "advanced_reasoning_unavailable",
                "reason": gate["reason"],
                "action": gate["action"],
                "system_reconstruction_performed": False}
    return {"mode": "full_reconstruction", "state": "available",
            "providers": {"xref": gate["xref_provider"],
                          "reconstruction": gate["reconstruction_provider"]}}
