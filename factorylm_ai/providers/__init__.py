"""Provider factory — the single place callers obtain a ModelProvider.

ZTA role: ``get_provider()`` is the seam every task/proofpack/flywheel caller
uses to get a provider instance. It never hides the choice: ``name=None``
reads ``FACTORYLM_AI_PROVIDER`` (or-form, default ``"mock"`` — CI's
deterministic default), and an unknown name is a hard ``ValueError``, never a
silent fallback to a different provider.
"""

from __future__ import annotations

import os

from . import together as together
from .base import ModelProvider
from .local_liquid import LocalLiquidProvider
from .mock import MockProvider
from .paid_authorization_guard import install_paid_authorization_guard

# Install before exporting TogetherProvider or returning the Together module to
# callers. Paid entry points then construct their verifier from operator-owned
# configuration instead of trusting a caller-supplied verifier object.
install_paid_authorization_guard(together)
TogetherProvider = together.TogetherProvider

__all__ = ["get_provider"]

_PROVIDERS: dict[str, type[ModelProvider]] = {
    "mock": MockProvider,
    "together": TogetherProvider,
    "local_liquid": LocalLiquidProvider,
}


def get_provider(name: str | None = None) -> ModelProvider:
    """Return a provider instance by name.

    ``name=None`` resolves ``os.getenv("FACTORYLM_AI_PROVIDER") or "mock"`` —
    the or-form is load-bearing: a compose-mapped
    ``${FACTORYLM_AI_PROVIDER:-}`` delivers an empty string, which must still
    fall through to ``"mock"``, not to an empty-string lookup miss. An
    explicit, unrecognized name raises ``ValueError`` (fail closed — no
    silent default provider).
    """
    resolved = name if name is not None else (os.getenv("FACTORYLM_AI_PROVIDER") or "mock")
    provider_cls = _PROVIDERS.get(resolved)
    if provider_cls is None:
        raise ValueError(
            f"unknown factorylm_ai provider {resolved!r} — expected one of {sorted(_PROVIDERS)}"
        )
    return provider_cls()
