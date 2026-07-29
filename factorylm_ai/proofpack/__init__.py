"""factorylm_ai.proofpack -- the Together experiments CLI (handoff §10).

ZTA role: proofpack is how a human proves a task's real-model behavior
before anything graduates toward the artifact registry / promotion gate. It
runs four experiments -- e01 (M01 vision intake), e02 (M05 intent routing),
e03 (M07 retrieval), e04 (M09 tool selection) -- either dry-run (default:
the mock provider, $0, fully deterministic -- the only path CI ever
exercises) or ``--live`` (the together provider, budget-capped by
:class:`~factorylm_ai.budget.BudgetGuard`, gated on ``TOGETHERAI_API_KEY``
+ ``FACTORYLM_AI_ALLOW_NETWORK``). Every run writes exactly one markdown
report plus telemetry JSONL -- see ``run.py`` for the CLI contract and
``report.py`` for what the report contains.

Nothing in this package (or anything else under ``factorylm_ai/``) is wired
into a customer-facing surface. The production chat path stays
``mira-bots/shared/inference/router.py`` and ``printsense/interpret.py`` --
see the top-level ``factorylm_ai`` package docstring for the full graduation
story.

Run it as ``python -m factorylm_ai.proofpack`` (see ``__main__.py``), or call
:func:`factorylm_ai.proofpack.run.main` directly (its signature --
``main(argv: list[str] | None = None) -> int`` -- exists specifically for
that kind of in-process testability).
"""

from __future__ import annotations
