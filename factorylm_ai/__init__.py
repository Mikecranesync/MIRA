"""factorylm_ai — the ZTA model lab: a provider-agnostic AI runtime + artifact factory.

Mission: prove model behaviors against Together AI as the hosted serverless
proving ground (behind explicit env flags, budget-capped, dry-run by
default) and Liquid/local as a future edge-runtime candidate, then convert
successful interactions into reusable artifacts — schemas, eval cases,
training records (Together fine-tuning JSONL), a ZTA artifact registry, and
a benchmark-before-assist promotion gate. Technicians never see any of this
directly; it is a lab, not a customer-facing surface.

Relationship to the rest of MIRA (verbatim intent — do not soften this):
``factorylm_ai`` is the proving ground and artifact factory. The production
chat path stays ``mira-bots/shared/inference/router.py`` (the Groq -> Cerebras
-> Together cascade) and ``printsense/interpret.py`` (the paid print
interpreter). Nothing in this package runs in a customer-facing container
until it graduates: benchmark pass -> promotion gate -> explicit follow-up
PR wiring it into an existing seam. Together = model factory; Liquid/local =
future edge runtime; FactoryLM = the product.

See ``docs/zta/factorylm-ai-model-lab.md`` for the architecture and how to
run it, and ``docs/zta/together-liquid-model-strategy.md`` for the pricing /
fine-tuning-economics / Liquid-license recon this package is built on.
"""

from __future__ import annotations

FACTORYLM_AI_VERSION = "0.1.0"

__all__ = ["FACTORYLM_AI_VERSION"]
