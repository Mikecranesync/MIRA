"""Provider capability registry — capability-specific, fail-closed routing.

A provider is never broadly "qualified": every capability is qualified,
disqualified, or untested on its own evidence (see capabilities.json, updated
only from ``printsense/benchmarks/provider_qualification.py`` probe runs
signed by the operator). Selection FAILS CLOSED: anything but an explicit
``qualified`` raises — there is no silent fallback and no default provider.

The full_reconstruction product mode additionally requires BOTH
``cross_reference_extraction`` and ``system_reconstruction`` to be qualified;
otherwise callers receive the explicit ``advanced_reasoning_unavailable``
state (see :func:`reconstruction_gate`).
"""

from __future__ import annotations

import json
from pathlib import Path

CAPABILITIES = (
    "device_inventory",
    "schema_reliability",
    "cross_reference_extraction",
    "system_reconstruction",
)
_VALID_STATUS = {"qualified", "disqualified", "untested"}
_REGISTRY_PATH = Path(__file__).resolve().parent / "capabilities.json"


class CapabilityUnavailable(RuntimeError):
    """No provider is qualified for the requested capability (fail closed)."""


def load_registry(path: str | Path | None = None) -> dict:
    data = json.loads(Path(path or _REGISTRY_PATH).read_text(encoding="utf-8"))
    for name, caps in data.get("providers", {}).items():
        for cap, rec in caps.items():
            if cap.startswith("_"):
                continue
            if cap not in CAPABILITIES:
                raise ValueError(f"{name}: unknown capability {cap!r}")
            status = rec.get("status")
            if status not in _VALID_STATUS:
                raise ValueError(f"{name}.{cap}: invalid status {status!r}")
            if status != "untested" and not rec.get("evidence"):
                raise ValueError(f"{name}.{cap}: {status} requires evidence")
    return data


def capability_status(provider: str, capability: str,
                      registry: dict | None = None) -> str:
    if capability not in CAPABILITIES:
        raise ValueError(f"unknown capability {capability!r}")
    reg = registry if registry is not None else load_registry()
    rec = reg.get("providers", {}).get(provider, {}).get(capability)
    return rec.get("status", "untested") if isinstance(rec, dict) else "untested"


def select_provider(capability: str, candidates: list[str] | None = None,
                    registry: dict | None = None) -> str:
    """Return the first candidate qualified for ``capability`` — else raise."""
    reg = registry if registry is not None else load_registry()
    pool = candidates if candidates is not None else list(
        reg.get("providers", {}).keys())
    for provider in pool:
        if capability_status(provider, capability, reg) == "qualified":
            return provider
    raise CapabilityUnavailable(
        f"no provider qualified for {capability!r} "
        f"(candidates={pool}); refusing to fall back")


def reconstruction_gate(registry: dict | None = None) -> dict:
    """Gate for the full_reconstruction mode. Never silently degrades."""
    reg = registry if registry is not None else load_registry()
    try:
        xref = select_provider("cross_reference_extraction", registry=reg)
        recon = select_provider("system_reconstruction", registry=reg)
    except CapabilityUnavailable:
        return {"state": "advanced_reasoning_unavailable",
                "reason": "no provider qualified for "
                          "cross_reference_extraction + system_reconstruction",
                "action": "queue frontier packet for later processing"}
    return {"state": "available", "xref_provider": xref,
            "reconstruction_provider": recon}
