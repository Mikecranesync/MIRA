"""Startup readiness — the ONE capability check every environment runs.

ADR-0031 FR-2::

    python -m factorylm_ai.readiness --profile printsense [--live] [--out FILE]

Exit codes:

* ``0`` — ready
* ``1`` — a required capability is unavailable
* ``2`` — invalid configuration
* ``3`` — probe infrastructure failure (the check itself broke)

Emits the FR-1 ``factorylm.runtime-capabilities.v1`` report (schema
``factorylm_ai/schemas/runtime_capabilities.schema.json``) on stdout, and to
``--out`` when given. Never contains secret values (``key_present`` only).

Live provider probes run ONLY with ``--live`` (a separately permissioned,
budget-conscious action — normal CI and healthchecks stay network-free and
see ``"skipped"`` probes). Probe seams are module-level functions so tests
monkeypatch them; nothing here reads env at import time.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from typing import Any

from factorylm_ai.capability_codes import (
    INVALID_CONFIGURATION,
    PROVIDER_KEY_MISSING,
    TESSERACT_MISSING,
    VISION_PROBE_FAILED,
    CapabilityError,
)

PROFILES = ("printsense",)

_EXIT_READY = 0
_EXIT_NOT_READY = 1
_EXIT_INVALID_CONFIG = 2
_EXIT_PROBE_FAILURE = 3


# ── probe seams (monkeypatched by tests) ────────────────────────────────────


def _git_info() -> tuple[str | None, bool | None]:
    """(sha, dirty) — best-effort; (None, None) outside a git checkout."""
    try:
        sha = (
            subprocess.run(
                ["git", "rev-parse", "HEAD"], capture_output=True, timeout=10, check=True
            )
            .stdout.decode()
            .strip()
        )
        dirty_out = subprocess.run(
            ["git", "status", "--porcelain"], capture_output=True, timeout=10, check=True
        ).stdout.decode()
        return sha, bool(dirty_out.strip())
    except Exception:  # noqa: BLE001 — absence of git is a report state
        return None, None


def _tesseract_versions() -> tuple[str | None, str | None]:
    """(tesseract_version, pytesseract_version) — (None, None) when absent."""
    try:
        import pytesseract  # noqa: PLC0415 — optional dependency by design

        tess = str(pytesseract.get_tesseract_version())
        pyt = getattr(pytesseract, "__version__", None) or "unknown"
        return tess, pyt
    except Exception:  # noqa: BLE001
        return None, None


def _live_text_probe(provider) -> str:
    """'ok'|'failed' — one tiny text completion. --live only, never CI."""
    import httpx  # noqa: PLC0415

    try:
        resp = httpx.post(
            f"{provider.spec.canonical_url}/chat/completions",
            headers={"Authorization": f"Bearer {provider.api_key}"},
            json={
                "model": provider.text_model,
                "max_tokens": 16,
                "messages": [{"role": "user", "content": "Reply with the single word: OK"}],
            },
            timeout=provider.timeout,
        )
        content = (resp.json().get("choices") or [{}])[0].get("message", {}).get("content") or ""
        return "ok" if resp.status_code == 200 and content.strip() else "failed"
    except Exception:  # noqa: BLE001
        return "failed"


# Known-token vision fixture — the SAME committed image the PR-5 canary uses
# (tools/canary_fixtures/vision_canary.png, printed text "MIRA CANARY 7"). A
# meaningful vision probe must make the model READ real text; a 1x1 blank pixel
# + "describe this" is not a valid probe (a vision model legitimately returns
# nothing, a FALSE negative — the defect the PR-7 staging activation surfaced).
_VISION_FIXTURE = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "tools",
    "canary_fixtures",
    "vision_canary.png",
)
_VISION_TOKENS = ("canary", "7")
# Reasoning-vision models (MiniMax-M3) can spend a small budget entirely on
# reasoning — 4096 is the measured-safe headroom (R5 program).
_VISION_PROBE_MAX_TOKENS = 4096


def _live_vision_probe(provider, model: str) -> str:
    """'ok'|'failed' — one known-token vision read on the CONFIGURED model.

    Passes only when the model READS the fixture's printed tokens back (proving
    real perception, not a generic "an image with text" reply). --live only.
    """
    import base64  # noqa: PLC0415

    import httpx  # noqa: PLC0415

    try:
        with open(_VISION_FIXTURE, "rb") as fh:
            b64 = base64.standard_b64encode(fh.read()).decode("ascii")
    except OSError:
        return "failed"
    try:
        resp = httpx.post(
            f"{provider.spec.canonical_url}/chat/completions",
            headers={"Authorization": f"Bearer {provider.api_key}"},
            json={
                "model": model,
                "max_tokens": _VISION_PROBE_MAX_TOKENS,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/png;base64,{b64}"},
                            },
                            {
                                "type": "text",
                                "text": "Read the text printed in this image and reply "
                                "with it verbatim, nothing else.",
                            },
                        ],
                    }
                ],
            },
            timeout=provider.timeout,
        )
        if resp.status_code != 200:
            return "failed"
        content = (resp.json().get("choices") or [{}])[0].get("message", {}).get("content") or ""
        lowered = content.lower()
        return "ok" if all(tok in lowered for tok in _VISION_TOKENS) else "failed"
    except Exception:  # noqa: BLE001
        return "failed"


# ── the check ───────────────────────────────────────────────────────────────


def collect(profile: str, *, live: bool = False, environment: str | None = None) -> dict[str, Any]:
    """Build the FR-1 capability report for ``profile``. Raises CapabilityError
    with INVALID_CONFIGURATION for config errors; other failures land in the
    report as typed codes with verdict not_ready."""
    from factorylm_ai import network_gate, provider_registry  # noqa: PLC0415

    if profile not in PROFILES:
        raise CapabilityError(INVALID_CONFIGURATION, f"unknown profile {profile!r}")

    errors: list[str] = []
    env_name = environment or os.getenv("PRINT_RECALL_ENV") or os.getenv("MIRA_ENV") or "dev"
    sha, dirty = _git_info()

    # Provider — the profile's required provider from the approved policy,
    # unless PRINT_VISION_PROVIDER explicitly requests another approved one.
    try:
        policy = provider_registry.task_policy("printsense_interpreter")
    except CapabilityError as exc:
        errors.append(exc.code)
        policy = {}
    requested = (os.getenv("PRINT_VISION_PROVIDER") or "").strip().lower() or str(
        policy.get("required_provider") or "together"
    )
    try:
        net_enabled = network_gate.network_enabled()
    except CapabilityError as exc:
        # A split-brain network config is INVALID CONFIG — the exit-2 class.
        raise CapabilityError(INVALID_CONFIGURATION, exc.detail) from exc

    resolved_name: str | None = None
    model: str | None = None
    key_present = False
    try:
        provider = provider_registry.resolve(requested)
        resolved_name = provider.name
        key_present = provider.key_present
        model = os.getenv("PRINT_VISION_MODEL") or provider.vision_model
        if not key_present:
            errors.append(PROVIDER_KEY_MISSING)
    except CapabilityError as exc:
        errors.append(exc.code)
        provider = None
    if not net_enabled:
        errors.append("NETWORK_DISABLED")

    text_probe = vision_probe = "skipped"
    if live and provider is not None and key_present and net_enabled:
        text_probe = _live_text_probe(provider)
        vision_probe = _live_vision_probe(provider, model or provider.vision_model)
        if vision_probe == "failed":
            errors.append(VISION_PROBE_FAILED)

    # OCR floor
    ocr_required = (os.getenv("OCR_REQUIRE_TESSERACT") or "").strip() == "1" or (
        os.getenv("OCR_EXPECT_TESSERACT") or ""
    ).strip() == "1"
    tess_version, pyt_version = _tesseract_versions()
    ocr_available = tess_version is not None
    if ocr_required and not ocr_available:
        errors.append(TESSERACT_MISSING)

    # Judge: the approved free cascade is configured when any cascade key is
    # present AND the network gate is open.
    judge_configured = net_enabled and any(
        provider_registry.resolve(name).key_present for name in provider_registry.cascade_order()
    )

    verdict = "ready" if not errors else "not_ready"
    if not errors and not ocr_required and not ocr_available:
        verdict = "degraded"  # dev without OCR — allowed, but labeled

    return {
        "schema": "factorylm.runtime-capabilities.v1",
        "environment": env_name,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "git_sha": sha,
        "git_dirty": dirty,
        "image_digest": os.getenv("IMAGE_DIGEST") or None,
        "provider": {
            "requested": requested,
            "resolved": resolved_name,
            "model": model,
            "key_present": key_present,
            "network_enabled": net_enabled,
            "text_probe": text_probe,
            "vision_probe": vision_probe,
        },
        "ocr": {
            "required": ocr_required,
            "available": ocr_available,
            "tesseract_version": tess_version,
            "pytesseract_version": pyt_version,
        },
        "judge": {"provider_policy": "approved_free", "configured": judge_configured},
        "errors": errors,
        "verdict": verdict,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="factorylm_ai.readiness")
    parser.add_argument("--profile", required=True, choices=PROFILES)
    parser.add_argument("--live", action="store_true", help="run live provider probes")
    parser.add_argument("--environment", default=None)
    parser.add_argument("--out", default=None, help="also write the report to this path")
    args = parser.parse_args(argv)

    try:
        report = collect(args.profile, live=args.live, environment=args.environment)
    except CapabilityError as exc:
        print(json.dumps({"error": exc.code, "detail": exc.detail}))
        return _EXIT_INVALID_CONFIG if exc.code == INVALID_CONFIGURATION else _EXIT_NOT_READY
    except Exception as exc:  # noqa: BLE001 — the probe itself broke
        print(json.dumps({"error": "PROBE_INFRASTRUCTURE", "detail": str(exc)[:300]}))
        return _EXIT_PROBE_FAILURE

    # Self-validate against the frozen schema before emitting — a malformed
    # report must never masquerade as a capability statement.
    try:
        from factorylm_ai.schemas.validate import load_schema, validate_or_raise  # noqa: PLC0415

        validate_or_raise(report, load_schema("runtime_capabilities"))
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": "PROBE_INFRASTRUCTURE", "detail": f"report invalid: {exc}"}))
        return _EXIT_PROBE_FAILURE

    payload = json.dumps(report, indent=2)
    print(payload)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(payload)
    return _EXIT_READY if report["verdict"] in {"ready", "degraded"} else _EXIT_NOT_READY


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
