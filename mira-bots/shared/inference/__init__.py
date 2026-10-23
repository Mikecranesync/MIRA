"""Customer-path :free guard for the inference cascade.

Extends ``router._openrouter_model_refused`` and post-filters ``_build_providers``
so a primary or pool member pointed at an OpenRouter ``:free`` id is dropped.
Imported as part of ``shared.inference`` so every ``from shared.inference.router
import _build_providers`` sees the guarded builders.
"""

from __future__ import annotations

from . import router as _router

_orig_refused = _router._openrouter_model_refused
_orig_build = _router._build_providers


def _openrouter_model_refused(model: str) -> bool:
    """True for a model OpenRouter could serve as Claude, or a ``:free`` id.

    Anthropic is banned from this cascade (PR #610). OpenRouter serves it as
    ``anthropic/...``, through ``~anthropic/...-latest`` aliases, and through its
    ``openrouter/...`` auto-routers, which pick a model per request. A preset
    reference (``@preset/x``, alone or as ``model@preset/x``) is refused too: the
    preset chooses its models remotely and can be switched to Claude without any
    change here (Codex r1 F1 on #4436).

    A model id ending in ``:free`` is also refused on the customer path. Those
    are unpaid OpenRouter community hosts, not a production SLA; the same
    suffix is honoured if a primary or pool provider is pointed at one.
    """
    return _orig_refused(model) or model.strip().lower().endswith(":free")


def _build_providers():
    providers = _orig_build()
    kept = []
    for provider in providers:
        free_ids = [
            m
            for m in (provider.model, provider.vision_model)
            if m
            and _openrouter_model_refused(m)
            and m.strip().lower().endswith(":free")
        ]
        if free_ids:
            _router.logger.error(
                "OPENROUTER_MODEL_REFUSED models=%s — provider left out", free_ids
            )
            continue
        kept.append(provider)
    return kept


_router._openrouter_model_refused = _openrouter_model_refused
_router._build_providers = _build_providers
