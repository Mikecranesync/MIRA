"""POTD readiness gate — fail closed before any controlled run begins.

ADR-0031 §6.6 / QR-1: a Print of the Day run refuses to start unless the
required capabilities are present. This reuses the PR-4 readiness collector
(`factorylm_ai.readiness.collect`) rather than re-deriving provider/OCR state,
and adds the POTD-specific, STRICT requirements the generic readiness command
does not force:

* provider must be Together and the model must be the approved
  ``MiniMaxAI/MiniMax-M3`` (POTD's approved policy, no silent substitution),
* Tesseract + pytesseract must be available (required OCR floor),
* network must be enabled,
* under ``--live`` the vision probe must pass.

Any miss raises a typed ``CapabilityError`` — the entrypoint turns that into a
non-zero exit and a failure report WITHOUT sending an email (QR-1: fail closed;
never a "vision-only" substitution for a controlled run).
"""

from __future__ import annotations

from factorylm_ai import readiness
from factorylm_ai.capability_codes import (
    MODEL_NOT_AVAILABLE,
    REQUIRED_PROVIDER_UNAVAILABLE,
    TESSERACT_MISSING,
    VISION_PROBE_FAILED,
    CapabilityError,
)

REQUIRED_PROVIDER = "together"
REQUIRED_MODEL = "MiniMaxAI/MiniMax-M3"


def enforce_potd_readiness(*, live: bool = False, environment: str | None = None) -> dict:
    """Collect the FR-1 capability report and enforce POTD's strict floor.

    Returns the capability report on success. Raises ``CapabilityError`` (fail
    closed) on any missing requirement. Never sends anything, never substitutes
    a weaker provider/model.
    """
    report = readiness.collect("printsense", live=live, environment=environment)

    provider = report["provider"]
    if provider["resolved"] != REQUIRED_PROVIDER:
        raise CapabilityError(
            REQUIRED_PROVIDER_UNAVAILABLE,
            f"POTD requires provider {REQUIRED_PROVIDER!r}, resolved {provider['resolved']!r}",
        )
    if not provider["key_present"]:
        raise CapabilityError(
            REQUIRED_PROVIDER_UNAVAILABLE, "TOGETHERAI_API_KEY not present for POTD"
        )
    if not provider["network_enabled"]:
        raise CapabilityError(
            REQUIRED_PROVIDER_UNAVAILABLE, "provider network disabled — POTD cannot run"
        )
    if provider["model"] != REQUIRED_MODEL:
        raise CapabilityError(
            MODEL_NOT_AVAILABLE,
            f"POTD requires vision model {REQUIRED_MODEL!r}, configured {provider['model']!r} "
            "(no silent substitution)",
        )
    if live and provider["vision_probe"] != "ok":
        raise CapabilityError(
            VISION_PROBE_FAILED,
            f"POTD live vision probe did not pass (got {provider['vision_probe']!r})",
        )

    ocr = report["ocr"]
    if not ocr["available"] or not ocr["tesseract_version"]:
        raise CapabilityError(
            TESSERACT_MISSING, "POTD requires Tesseract — the OCR floor is unavailable"
        )
    if not ocr["pytesseract_version"]:
        raise CapabilityError(TESSERACT_MISSING, "POTD requires pytesseract — not importable")

    return report
