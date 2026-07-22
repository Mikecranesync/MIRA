"""PR 1 contract tests — PrintSense Provider & OCR Hardening (ADR-0031).

Two kinds of tests, deliberately in one file so the ladder's state is
readable at a glance:

* PASSING — the contracts PR 1 itself ships (typed codes, approved-provider
  policy, capability-report schema) are well-formed and internally
  consistent.
* XFAIL (strict) — the behavior later PRs must implement. Each is a real
  assertion against the real modules; when its PR lands, the xfail marker is
  REMOVED (strict=True makes an accidentally-passing xfail a hard error, so
  a landed capability can't hide behind a stale marker).

No network, no env mutation leaks, no runtime behavior change (hermetic, $0).
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from factorylm_ai import capability_codes  # noqa: E402
from factorylm_ai.schemas.validate import load_schema, validate_or_raise  # noqa: E402

APPROVED_YML = REPO / "config" / "providers" / "approved.yml"
SCHEMA_FILE = REPO / "factorylm_ai" / "schemas" / "runtime_capabilities.schema.json"


# ── PR 1: typed codes ───────────────────────────────────────────────────────


def test_all_fr10_codes_exist_and_are_unique() -> None:
    required = {
        "PROVIDER_KEY_MISSING",
        "NETWORK_DISABLED",
        "PROVIDER_NOT_APPROVED",
        "MODEL_NOT_AVAILABLE",
        "MODEL_NOT_SERVERLESS",
        "VISION_PROBE_FAILED",
        "EMPTY_MODEL_RESPONSE",
        "INVALID_MODEL_JSON",
        "PRINTSYNTH_VALIDATION_FAILED",
        "TESSERACT_MISSING",
        "OCR_PROBE_FAILED",
        "DIRTY_WORKTREE",
        "REVISION_MISMATCH",
        "DUPLICATE_RUN",
        "MAILER_NOT_READY",
    }
    assert required <= set(capability_codes.ALL_CODES)
    assert len(capability_codes.ALL_CODES) == len(set(capability_codes.ALL_CODES))
    for code in capability_codes.ALL_CODES:
        assert getattr(capability_codes, code) == code


def test_capability_error_carries_code_and_rejects_unknown() -> None:
    err = capability_codes.CapabilityError(
        capability_codes.TESSERACT_MISSING, "tesseract binary not found"
    )
    assert err.code == "TESSERACT_MISSING"
    assert "TESSERACT_MISSING" in str(err)
    with pytest.raises(ValueError):
        capability_codes.CapabilityError("NOT_A_REAL_CODE")


# ── PR 1: approved-provider policy ─────────────────────────────────────────


def _load_approved() -> dict:
    import yaml

    with APPROVED_YML.open(encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def test_approved_policy_parses_and_declares_schema() -> None:
    policy = _load_approved()
    assert policy["schema"] == "factorylm.approved-providers.v1"


def test_interpreter_policy_requires_together_minimax_no_fallback() -> None:
    policy = _load_approved()["printsense_interpreter"]
    assert policy["required_provider"] == "together"
    assert "MiniMaxAI/MiniMax-M3" in policy["allowed_models"]["together"]
    assert policy["fallback"] is False


def test_judge_policy_is_approved_free_cascade_with_recorded_independence() -> None:
    policy = _load_approved()["printsense_judge"]
    assert set(policy["allowed_providers"]) == {"groq", "cerebras", "together"}
    assert policy["independence_required_for_gold"] is False
    assert policy["provisional_only_when_same_model"] is True


def test_potd_policy_is_strict_with_ocr_and_clean_worktree() -> None:
    policy = _load_approved()["print_of_the_day"]
    assert policy["required_provider"] == "together"
    assert policy["fallback"] is False
    assert policy["require_ocr"] is True
    assert policy["require_clean_worktree"] is True


def test_policy_contains_no_secret_shaped_values() -> None:
    text = APPROVED_YML.read_text(encoding="utf-8")
    assert not re.search(r"(sk-[A-Za-z0-9]{8,}|api[_-]?key\s*:\s*\S{16,})", text, re.I)


# ── PR 1: capability-report schema ─────────────────────────────────────────


def test_capability_schema_example_validates() -> None:
    schema = load_schema("runtime_capabilities")
    example = json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))["examples"][0]
    validate_or_raise(example, schema)


def test_capability_schema_rejects_missing_verdict_and_bad_probe() -> None:
    from factorylm_ai.schemas.validate import SchemaError

    schema = load_schema("runtime_capabilities")
    good = json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))["examples"][0]

    missing_verdict = {k: v for k, v in good.items() if k != "verdict"}
    with pytest.raises(SchemaError):
        validate_or_raise(missing_verdict, schema)

    bad_probe = json.loads(json.dumps(good))
    bad_probe["provider"]["vision_probe"] = "maybe"
    with pytest.raises(SchemaError):
        validate_or_raise(bad_probe, schema)


# ── Future ladder behavior (xfail strict — markers removed as PRs land) ────


def test_provider_registry_module_exists() -> None:
    from factorylm_ai import provider_registry  # noqa: F401

    assert hasattr(provider_registry, "resolve")


def test_network_gate_module_exists() -> None:
    from factorylm_ai import network_gate

    assert hasattr(network_gate, "network_enabled")


@pytest.mark.xfail(reason="PR 3: together is a supported PrintSense provider", strict=True)
def test_interpret_supports_together(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PRINT_VISION_PROVIDER", "together")
    monkeypatch.setenv("TOGETHERAI_API_KEY", "unit-test-not-real")
    import importlib

    import printsense.interpret as interpret

    importlib.reload(interpret)
    try:
        assert interpret.is_configured() is True
        assert "together" in getattr(interpret, "_PROVIDER_KEYS", {})
    finally:
        monkeypatch.delenv("PRINT_VISION_PROVIDER")
        importlib.reload(interpret)


@pytest.mark.xfail(
    reason="PR 3: provider resolution is call-time, not frozen at import", strict=True
)
def test_interpret_provider_not_frozen_at_import(monkeypatch: pytest.MonkeyPatch) -> None:
    import importlib

    import printsense.interpret as interpret

    importlib.reload(interpret)
    monkeypatch.setenv("PRINT_VISION_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "unit-test-not-real")
    assert interpret.is_configured() is True
    # Flip the provider WITHOUT reload — a call-time implementation must see it.
    monkeypatch.setenv("PRINT_VISION_PROVIDER", "no_such_provider")
    assert interpret.is_configured() is False


@pytest.mark.xfail(reason="PR 4: readiness command", strict=True)
def test_readiness_module_exists() -> None:
    from factorylm_ai import readiness

    assert hasattr(readiness, "main")
