"""Prove the knowledge base is reachable BEFORE grading anything.

Why this exists
---------------
The 2026-09-05 day-one run reported **VCAD 0/6 with zero retrieved chunks on every
question**. Chasing that, I twice attributed it to the wrong cause — first a broken
harness accessor, then an unreachable corpus. Both were wrong: the corpus is reachable
and `recall_knowledge` returns hits for the same text. The real defect is that the
engine does not reliably *invoke* retrieval.

This module exists anyway, because the investigation exposed a genuine hole: the
harness could not have told the difference.

`LocalPipeline(neon_fallback=True)` — which the runner passed — is documented to
"continue without NeonDB recall (RAGWorker returns empty chunks → honesty directive
fires)" when `NEON_DATABASE_URL` is missing or unusable. It emits a `logger.warning`
the batch suppressed, and records nothing on the result. So a run where the benchmark
could not reach the corpus is indistinguishable, in the artefact, from a run where
MIRA genuinely knew nothing.

Both look like: no citations, honesty directive, low score. One is a product finding;
the other is a broken measurement, and the artefact cannot distinguish them. That
ambiguity is what let me spend two rounds on the wrong cause.

The rule this module enforces
-----------------------------
**A benchmark may not score a run it cannot attribute.** Before any question is asked,
prove the corpus answers a known-good probe. If it does not, abort loudly — never
produce a scorecard.

This is the same discipline `.claude/rules/debugging-conventions.md` §2 states for
diagnosis ("a MISSING result against an unverified path is inconclusive, not a
finding"), applied to measurement.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

#: A question the shared OEM corpus demonstrably answers. Deliberately a different
#: vendor and shape from any seed, so a seed-specific corpus gap can never mask a
#: dead connection — and so this probe keeps working if the seed set changes.
PROBE_QUERY = "PowerFlex 525 drive fault code"

#: Below this, treat the corpus as unreachable rather than merely thin. One row could
#: be a fluke; zero is certainly wrong for a 95k-row corpus and this query.
MIN_PROBE_ROWS = 1


@dataclass(frozen=True)
class KBHealth:
    """Whether the benchmark may attribute its results to MIRA."""

    reachable: bool
    rows: int
    tenant_id: str
    detail: str

    def __bool__(self) -> bool:
        return self.reachable


def check_kb_health(*, tenant_id: str | None = None, query: str = PROBE_QUERY) -> KBHealth:
    """Ask the production recall path for a known-good result.

    Uses `recall_knowledge` directly — the same function the engine's RAG worker calls
    — rather than a harness wrapper, per `.claude/skills/retrieval-diagnostics`: a
    result measured through a wrapper is inconclusive about the production mechanism.
    """
    tenant = tenant_id or os.getenv("MIRA_TENANT_ID") or ""
    if not tenant:
        return KBHealth(False, 0, "", "MIRA_TENANT_ID is unset — cannot scope a recall probe")
    if not os.getenv("NEON_DATABASE_URL"):
        return KBHealth(False, 0, tenant, "NEON_DATABASE_URL is unset — the corpus is unreachable")

    root = str(REPO_ROOT)
    bots = str(REPO_ROOT / "mira-bots")
    for p in (bots, root):  # root last so it wins index 0 (see runner._import_local_pipeline)
        while p in sys.path:
            sys.path.remove(p)
        sys.path.insert(0, p)

    try:
        from shared.neon_recall import recall_knowledge  # noqa: PLC0415
    except ImportError as exc:
        return KBHealth(False, 0, tenant, f"cannot import recall_knowledge: {exc}")

    try:
        rows = recall_knowledge(None, tenant, limit=5, query_text=query) or []
    except Exception as exc:  # noqa: BLE001 - any failure here means "cannot attribute"
        return KBHealth(False, 0, tenant, f"recall_knowledge raised {type(exc).__name__}: {exc}")

    if len(rows) < MIN_PROBE_ROWS:
        return KBHealth(
            False,
            len(rows),
            tenant,
            f"recall returned {len(rows)} rows for {query!r} — the corpus is unreachable or "
            f"empty for this tenant, so a zero-citation answer cannot be attributed to MIRA",
        )
    return KBHealth(True, len(rows), tenant, f"recall returned {len(rows)} rows for {query!r}")


class KBUnreachableError(RuntimeError):
    """Raised instead of producing a scorecard nobody can trust."""


def require_kb(*, tenant_id: str | None = None) -> KBHealth:
    """Abort the batch unless the corpus is provably reachable."""
    health = check_kb_health(tenant_id=tenant_id)
    if not health:
        raise KBUnreachableError(
            f"Knowledge base is not reachable — refusing to run the benchmark.\n"
            f"  {health.detail}\n"
            f"  tenant: {health.tenant_id or '(unset)'}\n\n"
            f"Every answer would be ungrounded and would score as a MIRA failure, which is "
            f"a broken measurement rather than a product finding — indistinguishable, in "
            f"the artefact, from MIRA genuinely knowing nothing."
        )
    return health
