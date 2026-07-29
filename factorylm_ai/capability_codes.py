"""Typed capability/provider error codes — PrintSense Provider & OCR Hardening.

FR-10 of the hardening PRD (ADR-0031): stable, machine-readable codes that
reports, logs, tests, and UIs key on instead of free-form text. The code set
is a frozen contract — additions are append-only; renames are breaking.

Import-safe: no env, no network, no side effects (factorylm_ai package law).
"""

from __future__ import annotations

# ── Provider / network ──────────────────────────────────────────────────────
PROVIDER_KEY_MISSING = "PROVIDER_KEY_MISSING"
NETWORK_DISABLED = "NETWORK_DISABLED"
PROVIDER_NOT_APPROVED = "PROVIDER_NOT_APPROVED"
MODEL_NOT_AVAILABLE = "MODEL_NOT_AVAILABLE"
MODEL_NOT_SERVERLESS = "MODEL_NOT_SERVERLESS"
VISION_PROBE_FAILED = "VISION_PROBE_FAILED"
EMPTY_MODEL_RESPONSE = "EMPTY_MODEL_RESPONSE"
PROVIDER_TIMEOUT = "PROVIDER_TIMEOUT"
INVALID_MODEL_JSON = "INVALID_MODEL_JSON"
PRINTSYNTH_VALIDATION_FAILED = "PRINTSYNTH_VALIDATION_FAILED"
REQUIRED_PROVIDER_UNAVAILABLE = "REQUIRED_PROVIDER_UNAVAILABLE"

# ── OCR floor ───────────────────────────────────────────────────────────────
TESSERACT_MISSING = "TESSERACT_MISSING"
OCR_PROBE_FAILED = "OCR_PROBE_FAILED"

# ── Provenance / reproducibility ────────────────────────────────────────────
DIRTY_WORKTREE = "DIRTY_WORKTREE"
REVISION_MISMATCH = "REVISION_MISMATCH"
DUPLICATE_RUN = "DUPLICATE_RUN"
MAILER_NOT_READY = "MAILER_NOT_READY"

# ── Configuration ───────────────────────────────────────────────────────────
INVALID_CONFIGURATION = "INVALID_CONFIGURATION"

ALL_CODES: tuple[str, ...] = (
    PROVIDER_KEY_MISSING,
    NETWORK_DISABLED,
    PROVIDER_NOT_APPROVED,
    MODEL_NOT_AVAILABLE,
    MODEL_NOT_SERVERLESS,
    VISION_PROBE_FAILED,
    EMPTY_MODEL_RESPONSE,
    PROVIDER_TIMEOUT,
    INVALID_MODEL_JSON,
    PRINTSYNTH_VALIDATION_FAILED,
    REQUIRED_PROVIDER_UNAVAILABLE,
    TESSERACT_MISSING,
    OCR_PROBE_FAILED,
    DIRTY_WORKTREE,
    REVISION_MISMATCH,
    DUPLICATE_RUN,
    MAILER_NOT_READY,
    INVALID_CONFIGURATION,
)


class CapabilityError(RuntimeError):
    """A typed failure in provider/OCR/provenance readiness or execution.

    ``code`` is always one of ``ALL_CODES``; ``detail`` is free-form human
    context. Callers branch on ``code``, never on the message text.
    """

    def __init__(self, code: str, detail: str = "") -> None:
        if code not in ALL_CODES:
            raise ValueError(f"unknown capability code: {code!r}")
        self.code = code
        self.detail = detail
        super().__init__(f"{code}: {detail}" if detail else code)
