"""Local Liquid (LFM) provider — placeholder for the future edge runtime.

ZTA role: this module reserves the seam for on-device Liquid Foundation
Models (LFM2.5) once the licensing question is resolved and a local runtime
(vLLM / llama.cpp / Ollama on the Bravo node, or true edge hardware) is
wired up. Today it does nothing but exist: ``is_configured()`` is always
``False`` and ``complete()`` always raises ``NotImplementedError``. No LFM
weights ship in this package — see ``docs/zta/together-liquid-model-strategy.md``
for the license verdict (LFM Open License v1.0 is Apache-2.0-derived but
NOT literally Apache/MIT, which conflicts with this repo's "Apache 2.0 or
MIT ONLY" constraint on a literal read) and the edge-runtime economics that
motivate building this seam at all.
"""

from __future__ import annotations

import logging

from .base import ModelProvider, ModelRequest, ModelResponse

logger = logging.getLogger("factorylm-ai")

_DOCTRINE_MESSAGE = (
    "local_liquid is a placeholder for the future edge runtime candidate: "
    "Liquid Foundation Models (LFM2.5) served on-device (vLLM / llama.cpp / "
    "Ollama on the Bravo node, or true edge hardware) once the LFM Open "
    "License v1.0 threshold question is resolved for FactoryLM. No LFM "
    "weights are bundled with this package. See "
    "docs/zta/together-liquid-model-strategy.md for the license verdict, "
    "the edge-performance figures (LFM2.5-1.2B on CPU, LFM2.5-VL for "
    "OCR-free nameplate/keypad extraction), and why LiquidAI/LFM2.5-8B-A1B "
    "on Together serverless is today's proving ground instead."
)


class LocalLiquidProvider(ModelProvider):
    """Edge-runtime placeholder — never configured, never callable (yet)."""

    name = "local_liquid"

    def is_configured(self) -> bool:
        return False

    async def complete(self, req: ModelRequest) -> ModelResponse:
        logger.debug("local_liquid.complete task=%s — not implemented", req.task_id)
        raise NotImplementedError(_DOCTRINE_MESSAGE)
