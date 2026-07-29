"""Canonical provider configuration registry — ADR-0031 (PR 2).

ONE place that owns provider names, key-env names, base URLs, default
models, timeouts, and redacted diagnostics for every PrintSense-adjacent
runtime (typed interpreter, judge, canary, Print of the Day, factorylm_ai
lab providers).

Design rules (see ADR-0031):

* **Call-time resolution.** Nothing here reads env at import; ``resolve()``
  reads the environment on every call, so a changed key/model/timeout is
  visible without a process restart (the import-freeze defect this program
  exists to fix).
* **Two Together hosts are data, not drift.** ``cascade_url`` is the free
  cascade's proven legacy endpoint (``api.together.xyz``, used by
  mira-bots/shared/inference/router.py); ``canonical_url`` is the current
  host (``api.together.ai``, used by typed/lab calls). Host unification is
  a deliberate Phase-E change with its own soak — never a refactor side
  effect.
* **Router parity is contract-tested, not runtime-imported.** The bot/
  pipeline cascade router stays self-contained (it ships in images that do
  not carry this package); ``tests/factorylm_ai/test_provider_registry.py``
  pins the router's inline defaults to this registry so drift is CI-red.
  Full import-consumption happens with the Phase-E unification.
* **Or-form parsing law.** Compose maps ``${VAR:-}`` to an EMPTY STRING
  in-container; every env read here uses ``os.getenv(...) or default`` so
  an empty value falls back instead of crash-looping (this trap has bitten
  the repo twice).
* **No secrets in output.** ``registry_report()`` exposes ``key_present``
  booleans only.

Authorization (which providers a task MAY use) lives in
``config/providers/approved.yml``; qualification (which provider has PROVEN
a capability) lives in ``printsense/providers/capabilities.json``. This
module is configuration only — see ADR-0031 for the three-way boundary.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from factorylm_ai.capability_codes import (
    PROVIDER_KEY_MISSING,
    PROVIDER_NOT_APPROVED,
    CapabilityError,
)

_REPO_ROOT = Path(__file__).resolve().parent.parent
APPROVED_POLICY_PATH = _REPO_ROOT / "config" / "providers" / "approved.yml"


@dataclass(frozen=True)
class ProviderSpec:
    """Static facts about one provider (no env, no secrets)."""

    name: str
    key_env: str
    # The free cascade's endpoint (router.py behavior — legacy host for
    # together, kept verbatim until the Phase-E unification).
    cascade_url: str
    # The canonical endpoint for typed/lab calls (interpret.py PR 3,
    # factorylm_ai providers).
    canonical_url: str
    text_model_env: str
    text_model_default: str
    vision_model_env: str
    # "" = provider has no usable vision model (image turns skip it).
    vision_model_default: str
    timeout_env: str
    timeout_default: float


@dataclass(frozen=True)
class ResolvedProvider:
    """A provider with its call-time environment applied. Never carries the
    key value itself beyond ``api_key`` (which callers must not log —
    ``registry_report()`` is the loggable surface)."""

    spec: ProviderSpec
    api_key: str
    text_model: str
    vision_model: str
    timeout: float

    @property
    def name(self) -> str:
        return self.spec.name

    @property
    def key_present(self) -> bool:
        return bool(self.api_key)


# The registry. Values MUST stay byte-identical to the router's inline
# defaults (mira-bots/shared/inference/router.py _build_providers) — pinned
# by tests/factorylm_ai/test_provider_registry.py.
PROVIDERS: dict[str, ProviderSpec] = {
    "groq": ProviderSpec(
        name="groq",
        key_env="GROQ_API_KEY",
        cascade_url="https://api.groq.com/openai/v1/chat/completions",
        canonical_url="https://api.groq.com/openai/v1",
        text_model_env="GROQ_MODEL",
        text_model_default="llama-3.3-70b-versatile",
        vision_model_env="GROQ_VISION_MODEL",
        # Groq delisted all vision models 2026-07-18 — empty on purpose so
        # image turns skip Groq instead of 404ing.
        vision_model_default="",
        timeout_env="",  # hardcoded in the cascade
        timeout_default=30.0,
    ),
    "cerebras": ProviderSpec(
        name="cerebras",
        key_env="CEREBRAS_API_KEY",
        cascade_url="https://api.cerebras.ai/v1/chat/completions",
        canonical_url="https://api.cerebras.ai/v1",
        text_model_env="CEREBRAS_MODEL",
        text_model_default="gpt-oss-120b",
        vision_model_env="",
        vision_model_default="",
        timeout_env="",
        timeout_default=30.0,
    ),
    "together": ProviderSpec(
        name="together",
        key_env="TOGETHERAI_API_KEY",
        # Legacy host — the cascade's proven endpoint (router.py).
        cascade_url="https://api.together.xyz/v1/chat/completions",
        # Current host — typed interpreter + factorylm_ai lab calls.
        canonical_url="https://api.together.ai/v1",
        text_model_env="TOGETHERAI_MODEL",
        text_model_default="meta-llama/Llama-3.3-70B-Instruct-Turbo",
        vision_model_env="TOGETHERAI_VISION_MODEL",
        # Only serverless vision model verified on this account (v3.162.2);
        # MiniMax-M3 is selected via env / approved policy, not hardcoded.
        vision_model_default="google/gemma-3n-E4B-it",
        timeout_env="TOGETHERAI_TIMEOUT",
        timeout_default=90.0,
    ),
}

# Fixed cascade order — key-gated at call time, order never changes.
CASCADE_ORDER: tuple[str, ...] = ("groq", "cerebras", "together")


def cascade_order() -> tuple[str, ...]:
    return CASCADE_ORDER


def resolve(name: str) -> ResolvedProvider:
    """Resolve one provider against the CURRENT environment (call-time)."""
    spec = PROVIDERS.get(name)
    if spec is None:
        raise CapabilityError(PROVIDER_NOT_APPROVED, f"unknown provider: {name!r}")
    api_key = os.getenv(spec.key_env) or "" if spec.key_env else ""
    text_model = (
        os.getenv(spec.text_model_env) or "" if spec.text_model_env else ""
    ) or spec.text_model_default
    vision_model = (
        os.getenv(spec.vision_model_env) or "" if spec.vision_model_env else ""
    ) or spec.vision_model_default
    if spec.timeout_env:
        try:
            timeout = float(os.getenv(spec.timeout_env) or spec.timeout_default)
        except ValueError:
            timeout = spec.timeout_default
    else:
        timeout = spec.timeout_default
    return ResolvedProvider(
        spec=spec,
        api_key=api_key,
        text_model=text_model,
        vision_model=vision_model,
        timeout=timeout,
    )


def require_key(name: str) -> ResolvedProvider:
    """resolve(), but raise ``PROVIDER_KEY_MISSING`` when the key is absent."""
    provider = resolve(name)
    if not provider.key_present:
        raise CapabilityError(
            PROVIDER_KEY_MISSING, f"{provider.spec.key_env} not set for provider {name!r}"
        )
    return provider


def approved_policy(path: Path | None = None) -> dict[str, Any]:
    """Load the repo-controlled authorization policy (FR-9).

    Raises ``CapabilityError(PROVIDER_NOT_APPROVED)`` when the file is
    missing or malformed — a controlled surface without its policy must
    fail closed, not assume permissiveness.
    """
    import yaml

    policy_path = path or APPROVED_POLICY_PATH
    try:
        with policy_path.open(encoding="utf-8") as fh:
            policy = yaml.safe_load(fh)
    except FileNotFoundError as exc:
        raise CapabilityError(
            PROVIDER_NOT_APPROVED, f"approved-provider policy missing: {policy_path}"
        ) from exc
    if not isinstance(policy, dict) or policy.get("schema") != "factorylm.approved-providers.v1":
        raise CapabilityError(
            PROVIDER_NOT_APPROVED, f"approved-provider policy invalid: {policy_path}"
        )
    return policy


def task_policy(task: str, path: Path | None = None) -> dict[str, Any]:
    """The approved policy block for one task, fail-closed on absence."""
    policy = approved_policy(path)
    block = policy.get(task)
    if not isinstance(block, dict):
        raise CapabilityError(PROVIDER_NOT_APPROVED, f"no approved policy for task {task!r}")
    return block


def model_approved(task: str, provider: str, model: str, path: Path | None = None) -> bool:
    """Is ``model`` on ``provider`` authorized for ``task``?"""
    block = task_policy(task, path)
    allowed = block.get("allowed_models")
    if isinstance(allowed, dict):
        return model in (allowed.get(provider) or [])
    providers = block.get("allowed_providers")
    if isinstance(providers, list):
        return provider in providers
    return False


def registry_report() -> dict[str, Any]:
    """Redacted, loggable snapshot of every provider's resolved state."""
    report: dict[str, Any] = {"cascade_order": list(CASCADE_ORDER), "providers": {}}
    for name in PROVIDERS:
        provider = resolve(name)
        report["providers"][name] = {
            "key_env": provider.spec.key_env,
            "key_present": provider.key_present,
            "cascade_url": provider.spec.cascade_url,
            "canonical_url": provider.spec.canonical_url,
            "text_model": provider.text_model,
            "vision_model": provider.vision_model or None,
            "timeout": provider.timeout,
        }
    return report
