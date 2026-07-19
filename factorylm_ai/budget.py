"""Spend guard — the seam every network-touching call in the lab goes through.

ZTA role: this is ZTA Hard Rule 1 made mechanical. Any code path that could
spend money (a live Together call, a fine-tune job, a proofpack ``--live``
run) declares a dollar budget up front via :class:`BudgetGuard`, calls
:meth:`BudgetGuard.precheck` with the estimated cost BEFORE making the call,
and calls :meth:`BudgetGuard.record` with the actual cost AFTER. Dry-run
(the mock provider, $0.0 everywhere) is the default; a guard is only ever
exercised by ``--live`` proofpack runs. The guard holds no global state — a
fresh instance starts at ``spent_usd == 0.0`` — so callers own its lifetime
(typically one guard per proofpack invocation).
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger("factorylm-ai")

_DEFAULT_CAP_USD = "1.00"


class BudgetExceeded(Exception):
    """Raised by :meth:`BudgetGuard.precheck` when a call would exceed the cap."""


class BudgetGuard:
    """Tracks spend against a hard dollar cap for one lab session/run.

    ``cap_usd=None`` resolves ``float(os.getenv("FACTORYLM_AI_BUDGET_USD") or "1.00")``
    at construction time — the or-form is mandatory (a compose-mapped
    ``${FACTORYLM_AI_BUDGET_USD:-}`` delivers an empty string, and a bare
    ``float(os.getenv(...))`` on ``""`` raises).
    """

    def __init__(self, cap_usd: float | None = None) -> None:
        resolved_cap = (
            cap_usd
            if cap_usd is not None
            else float(os.getenv("FACTORYLM_AI_BUDGET_USD") or _DEFAULT_CAP_USD)
        )
        if resolved_cap < 0:
            raise ValueError(f"cap_usd must be >= 0, got {resolved_cap}")
        self._cap_usd = resolved_cap
        self._spent_usd = 0.0

    @property
    def cap_usd(self) -> float:
        return self._cap_usd

    @property
    def spent_usd(self) -> float:
        return self._spent_usd

    def precheck(self, estimated_usd: float) -> None:
        """Raise :class:`BudgetExceeded` if ``spent_usd + estimated_usd > cap_usd``.

        Call this BEFORE making the call the estimate is for — it is the
        hard-stop the spend law requires. A passing precheck does not record
        anything; call :meth:`record` after the call completes with the
        actual cost.
        """
        projected = self._spent_usd + estimated_usd
        if projected > self._cap_usd:
            raise BudgetExceeded(
                f"budget exceeded: spent=${self._spent_usd:.4f} + "
                f"estimated=${estimated_usd:.4f} = ${projected:.4f} > "
                f"cap=${self._cap_usd:.4f}"
            )

    def record(self, actual_usd: float) -> None:
        """Accumulate an actual spend after a call completes."""
        self._spent_usd += actual_usd
        logger.info(
            "BUDGET_RECORD actual_usd=%.5f spent_usd=%.5f cap_usd=%.5f",
            actual_usd,
            self._spent_usd,
            self._cap_usd,
        )
