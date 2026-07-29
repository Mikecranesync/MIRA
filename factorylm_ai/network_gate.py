"""Canonical network gate — ADR-0031 §6.2 (PR 2).

One source of truth for "may this process make provider network calls?".

    FACTORYLM_NETWORK_MODE=enabled|disabled     # canonical — wins when set

Legacy mapping (migration; both continue to work):

    INFERENCE_BACKEND=cloud            -> enabled  (bot cascade convention)
    FACTORYLM_AI_ALLOW_NETWORK=1|true  -> enabled  (lab convention)

Rules:

* The canonical variable, when set, WINS over both legacy variables.
* With no canonical value, either legacy signal enables the network.
* Explicitly CONTRADICTORY legacy values (``INFERENCE_BACKEND=cloud`` while
  ``FACTORYLM_AI_ALLOW_NETWORK`` is explicitly false, or vice versa) raise
  ``CapabilityError(INVALID_CONFIGURATION)`` — a split-brain network config
  must fail at startup, not behave differently per code path.
* Unset everything -> disabled. Tests and CI therefore default to disabled.
* Legacy use without the canonical variable logs a one-line deprecation
  pointer (once per process).

All reads are call-time (no import-time freezing).
"""

from __future__ import annotations

import logging
import os

from factorylm_ai.capability_codes import INVALID_CONFIGURATION, CapabilityError

logger = logging.getLogger("factorylm-ai")

_TRUTHY = {"1", "true", "yes", "on"}
_FALSY = {"0", "false", "no", "off"}
_deprecation_logged = False


def _canonical_mode() -> str | None:
    raw = (os.getenv("FACTORYLM_NETWORK_MODE") or "").strip().lower()
    if not raw:
        return None
    if raw in {"enabled", "disabled"}:
        return raw
    raise CapabilityError(
        INVALID_CONFIGURATION,
        f"FACTORYLM_NETWORK_MODE must be 'enabled' or 'disabled', got {raw!r}",
    )


def _legacy_signals() -> tuple[bool | None, bool | None]:
    """(inference_backend_enabled, allow_network_enabled); None = unset."""
    backend_raw = (os.getenv("INFERENCE_BACKEND") or "").strip().lower()
    backend: bool | None = None
    if backend_raw:
        backend = backend_raw == "cloud"

    allow_raw = (os.getenv("FACTORYLM_AI_ALLOW_NETWORK") or "").strip().lower()
    allow: bool | None = None
    if allow_raw:
        if allow_raw in _TRUTHY:
            allow = True
        elif allow_raw in _FALSY:
            allow = False
        else:
            raise CapabilityError(
                INVALID_CONFIGURATION,
                f"FACTORYLM_AI_ALLOW_NETWORK must be truthy/falsy, got {allow_raw!r}",
            )
    return backend, allow


def network_mode() -> str:
    """'enabled' or 'disabled' — the single canonical answer."""
    global _deprecation_logged

    canonical = _canonical_mode()
    if canonical is not None:
        return canonical

    backend, allow = _legacy_signals()
    # Explicit contradiction between the two legacy signals is a config error.
    if backend is not None and allow is not None and backend != allow:
        raise CapabilityError(
            INVALID_CONFIGURATION,
            "conflicting legacy network flags: "
            f"INFERENCE_BACKEND={os.getenv('INFERENCE_BACKEND')!r} vs "
            f"FACTORYLM_AI_ALLOW_NETWORK={os.getenv('FACTORYLM_AI_ALLOW_NETWORK')!r} "
            "(set FACTORYLM_NETWORK_MODE to resolve)",
        )

    enabled = bool(backend) or bool(allow)
    if (backend is not None or allow is not None) and not _deprecation_logged:
        logger.info(
            "NETWORK_GATE legacy flag in use (INFERENCE_BACKEND/FACTORYLM_AI_ALLOW_NETWORK); "
            "prefer FACTORYLM_NETWORK_MODE=enabled|disabled"
        )
        _deprecation_logged = True
    return "enabled" if enabled else "disabled"


def network_enabled() -> bool:
    return network_mode() == "enabled"
