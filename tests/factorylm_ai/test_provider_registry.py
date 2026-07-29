"""PR 2 tests — provider registry + canonical network gate (ADR-0031).

Hermetic ($0, no network). The centerpiece is the ROUTER PARITY suite: the
bot cascade router stays self-contained (it ships in images without
factorylm_ai), so single-source-of-truth is enforced by pinning the router's
actual _build_providers() output to this registry — config drift between the
two is CI-red, per the ADR's migration-adapter decision.
"""

from __future__ import annotations

import importlib
import logging
import os
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "mira-bots"))

from factorylm_ai import network_gate, provider_registry  # noqa: E402
from factorylm_ai.capability_codes import CapabilityError  # noqa: E402

_ENV_VARS = (
    "GROQ_API_KEY",
    "GROQ_MODEL",
    "GROQ_VISION_MODEL",
    "CEREBRAS_API_KEY",
    "CEREBRAS_MODEL",
    "TOGETHERAI_API_KEY",
    "TOGETHERAI_MODEL",
    "TOGETHERAI_VISION_MODEL",
    "TOGETHERAI_TIMEOUT",
    "FACTORYLM_NETWORK_MODE",
    "INFERENCE_BACKEND",
    "FACTORYLM_AI_ALLOW_NETWORK",
)


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch):
    for var in _ENV_VARS:
        monkeypatch.delenv(var, raising=False)
    yield


# ── Router parity (the anti-drift contract) ────────────────────────────────


def _router_providers(monkeypatch: pytest.MonkeyPatch) -> dict:
    """The cascade router's real provider set with all three keys present."""
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setenv("CEREBRAS_API_KEY", "k")
    monkeypatch.setenv("TOGETHERAI_API_KEY", "k")
    router = importlib.import_module("shared.inference.router")
    return {p.name: p for p in router._build_providers()}


def test_registry_matches_router_defaults_exactly(monkeypatch: pytest.MonkeyPatch) -> None:
    built = _router_providers(monkeypatch)
    assert list(built) == list(provider_registry.cascade_order())
    for name, router_provider in built.items():
        spec = provider_registry.PROVIDERS[name]
        resolved = provider_registry.resolve(name)
        assert router_provider.api_url == spec.cascade_url, name
        assert router_provider.model == resolved.text_model, name
        assert router_provider.vision_model == resolved.vision_model, name
        assert router_provider.timeout == resolved.timeout, name


def test_registry_matches_router_env_overrides(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TOGETHERAI_MODEL", "some/other-model")
    monkeypatch.setenv("TOGETHERAI_VISION_MODEL", "MiniMaxAI/MiniMax-M3")
    monkeypatch.setenv("TOGETHERAI_TIMEOUT", "42.5")
    built = _router_providers(monkeypatch)
    resolved = provider_registry.resolve("together")
    assert built["together"].model == resolved.text_model == "some/other-model"
    assert built["together"].vision_model == resolved.vision_model == "MiniMaxAI/MiniMax-M3"
    assert built["together"].timeout == resolved.timeout == 42.5


def test_registry_or_form_empty_strings_fall_back(monkeypatch: pytest.MonkeyPatch) -> None:
    # compose ${VAR:-} delivers EMPTY strings in-container — must not crash,
    # must fall back to defaults (the twice-bitten trap).
    monkeypatch.setenv("TOGETHERAI_MODEL", "")
    monkeypatch.setenv("TOGETHERAI_VISION_MODEL", "")
    monkeypatch.setenv("TOGETHERAI_TIMEOUT", "")
    resolved = provider_registry.resolve("together")
    assert resolved.text_model == "meta-llama/Llama-3.3-70B-Instruct-Turbo"
    assert resolved.vision_model == "google/gemma-3n-E4B-it"
    assert resolved.timeout == 90.0


# ── Registry semantics ─────────────────────────────────────────────────────


def test_resolution_is_call_time_not_import_time(monkeypatch: pytest.MonkeyPatch) -> None:
    assert provider_registry.resolve("together").key_present is False
    monkeypatch.setenv("TOGETHERAI_API_KEY", "now-set")
    assert provider_registry.resolve("together").key_present is True  # no reload


def test_two_together_hosts_are_explicit_data() -> None:
    spec = provider_registry.PROVIDERS["together"]
    assert spec.cascade_url.startswith("https://api.together.xyz/")
    assert spec.canonical_url.startswith("https://api.together.ai/")


def test_require_key_raises_typed_code() -> None:
    with pytest.raises(CapabilityError) as exc:
        provider_registry.require_key("together")
    assert exc.value.code == "PROVIDER_KEY_MISSING"


def test_unknown_provider_is_typed_not_keyerror() -> None:
    with pytest.raises(CapabilityError) as exc:
        provider_registry.resolve("openrouter")
    assert exc.value.code == "PROVIDER_NOT_APPROVED"


def test_registry_report_is_redacted(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TOGETHERAI_API_KEY", "tgp_v1_SECRETSECRETSECRET")
    report = provider_registry.registry_report()
    assert report["providers"]["together"]["key_present"] is True
    assert "SECRET" not in str(report)


# ── Approved policy consumption ────────────────────────────────────────────


def test_model_approved_from_policy() -> None:
    assert provider_registry.model_approved(
        "printsense_interpreter", "together", "MiniMaxAI/MiniMax-M3"
    )
    assert not provider_registry.model_approved(
        "printsense_interpreter", "together", "some/random-model"
    )
    assert provider_registry.model_approved("printsense_judge", "cerebras", "anything")


def test_missing_policy_fails_closed(tmp_path: Path) -> None:
    with pytest.raises(CapabilityError) as exc:
        provider_registry.approved_policy(tmp_path / "nope.yml")
    assert exc.value.code == "PROVIDER_NOT_APPROVED"


# ── Network gate ───────────────────────────────────────────────────────────


def test_default_is_disabled_for_tests_and_ci() -> None:
    assert network_gate.network_enabled() is False


def test_canonical_mode_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FACTORYLM_NETWORK_MODE", "disabled")
    monkeypatch.setenv("INFERENCE_BACKEND", "cloud")
    monkeypatch.setenv("FACTORYLM_AI_ALLOW_NETWORK", "true")
    assert network_gate.network_enabled() is False
    monkeypatch.setenv("FACTORYLM_NETWORK_MODE", "enabled")
    assert network_gate.network_enabled() is True


def test_legacy_backend_cloud_enables(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INFERENCE_BACKEND", "cloud")
    assert network_gate.network_enabled() is True
    monkeypatch.setenv("INFERENCE_BACKEND", "local")
    assert network_gate.network_enabled() is False


def test_legacy_allow_network_enables(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FACTORYLM_AI_ALLOW_NETWORK", "1")
    assert network_gate.network_enabled() is True


def test_conflicting_legacy_flags_fail_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INFERENCE_BACKEND", "cloud")
    monkeypatch.setenv("FACTORYLM_AI_ALLOW_NETWORK", "false")
    with pytest.raises(CapabilityError) as exc:
        network_gate.network_enabled()
    assert exc.value.code == "INVALID_CONFIGURATION"


def test_invalid_canonical_value_fails_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FACTORYLM_NETWORK_MODE", "maybe")
    with pytest.raises(CapabilityError) as exc:
        network_gate.network_enabled()
    assert exc.value.code == "INVALID_CONFIGURATION"


def test_legacy_use_logs_deprecation_once(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(network_gate, "_deprecation_logged", False)
    monkeypatch.setenv("INFERENCE_BACKEND", "cloud")
    with caplog.at_level(logging.INFO, logger="factorylm-ai"):
        network_gate.network_enabled()
        network_gate.network_enabled()
    assert sum("NETWORK_GATE legacy flag" in r.message for r in caplog.records) == 1


# ── together.py consumes the registry ──────────────────────────────────────


def test_together_provider_uses_canonical_host_and_gate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    together = importlib.import_module("factorylm_ai.providers.together")
    assert together._BASE_URL == provider_registry.PROVIDERS["together"].canonical_url
    assert together._DEFAULT_CHAT_MODEL == (
        provider_registry.PROVIDERS["together"].text_model_default
    )
    # The lab gate now honors the canonical variable too.
    assert together._network_allowed() is False
    monkeypatch.setenv("FACTORYLM_NETWORK_MODE", "enabled")
    assert together._network_allowed() is True


def _unused(*_a: object) -> None:  # keep os import honest for linters
    _ = os.environ
