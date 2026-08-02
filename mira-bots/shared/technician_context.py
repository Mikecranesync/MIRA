"""Turn → `TechnicianContext` assembly (WS1 adoption, ADR-0033 / PRD G1+G6).

The contract and its adapters shipped in Phase 3
(`materialized_evidence/context_contract.py`) and then sat unused: before this
module, `evidence_from_prior_decisions()` had **zero production call sites** —
it was referenced only from `tests/test_context_contract.py`. That gap is what
put eval slice 13 ("blocked on runtime adoption") on the critical path to any
training spend. This module closes it for one evidence family on one serving
path.

What it does, and deliberately does not do:

- **Assembles ONE context object per turn** from what the engine already has
  (resolved UNS identity, the question, the tenant) plus prior grounded
  decisions recalled from `decision_traces`. It never invents a second context
  schema (ADR-0029 rule 15 / ADR-0033 rejected alternatives).
- **Validates it** with the contract's own `validate_context`. A contract you
  do not validate is not adopted. Violations are logged and the block is
  DROPPED (fail-closed on the prompt) while the turn proceeds untouched
  (fail-open on the answer).
- **Renders only the prior-decision projection into the prompt.** Retrieved
  manual chunks are already rendered by `rag_worker._build_prompt_with_chunks`
  as "RETRIEVED REFERENCE DOCUMENTS"; rendering the contract's full block on
  top would double-render the same evidence at a different trust label. So the
  prompt gets exactly the evidence family that is genuinely NEW this slice.
  Unifying retrieval's prompt rendering onto the contract is the next slice —
  see the PR body; do not read this module as claiming it already happened.
- **Emits the manifest the audit row records** (`context_manifest` +
  `context_manifest_sha256`, migration 071) so the trace preserves the same
  evidence object the prompt was built from rather than re-deriving evidence at
  trace time. The trace writer sanitizes the non-rendered question field at its
  persistence boundary and hashes that safe audit projection; it never alters
  or re-derives the evidence that G6 protects.

`materialized_evidence` is imported lazily and defensively — the same posture
`print_recall.py` established, because not every image that ships
`mira-bots/shared/` also ships the package (mira-pipeline did not until this
change). A missing import disables the block; it never breaks a turn.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from typing import Any

logger = logging.getLogger("mira-gsd.technician_context")

# Adoption flag. Default OFF: turning the contract on changes prompt bytes, and
# the golden/eval regimes must measure that change deliberately rather than
# inherit it. Promotion trigger (stated in the PR body, not folded in silently):
# flip to on-by-default once eval slice 13 exists and the regimes show no
# regression against the flag-off baseline.
#
# Read per call, NOT captured at import: eval slice 13 has to be able to run the
# same process both ways (`monkeypatch.setenv`), and a module-level constant
# would freeze whatever the environment happened to be when the engine module
# first got imported.
_FLAG_ENV = "MIRA_CONTEXT_CONTRACT"

_PROMPT_PREAMBLE = (
    "\n\n--- PRIOR MIRA DECISIONS (UNVERIFIED HYPOTHESES) ---\n"
    "These are earlier answers MIRA gave on this equipment. They are CANDIDATE "
    "context, not verified truth, and carry no citation authority: weigh them, "
    "state when you disagree, and never cite one as a source.\n"
)
_PROMPT_EPILOGUE = "\n--- END PRIOR DECISIONS ---\n"

_imports_ok_cache: bool | None = None
_unavailable_warned = False


def contract_enabled() -> bool:
    """True when WS1 context-contract assembly is switched on for this turn."""
    return os.getenv(_FLAG_ENV, "").strip().lower() in ("1", "true", "yes", "on")


def _imports_ok() -> bool:
    """True when the contract package is importable. Cached; warns once."""
    global _imports_ok_cache, _unavailable_warned
    if _imports_ok_cache is None:
        try:
            import materialized_evidence.context_contract  # noqa: F401,PLC0415
        except Exception:  # noqa: BLE001 — any import failure disables cleanly
            _imports_ok_cache = False
            if not _unavailable_warned:
                _unavailable_warned = True
                logger.warning("CONTEXT_CONTRACT_UNAVAILABLE reason=import_error")
        else:
            _imports_ok_cache = True
    return _imports_ok_cache


def manifest_of(ctx: Any) -> tuple[dict[str, Any], str]:
    """``(serialized context, sha256 over its canonical JSON)``.

    The hash is over `json.dumps(..., sort_keys=True)` so two structurally
    identical contexts hash identically regardless of dict ordering — that is
    what makes a prompt/trace divergence detectable by comparing one column.
    """
    payload = ctx.to_dict()
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)
    return payload, hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def build_turn_context(
    *,
    tenant_id: str,
    question: str,
    uns_context: dict[str, Any] | None,
    prior_decisions: list[dict[str, Any]],
    recall_error: str | None = None,
    environment: str | None = None,
    task_mode_value: str | None = None,
) -> tuple[Any | None, list[str]]:
    """Assemble + validate one turn's context. Returns ``(ctx | None, violations)``.

    ``ctx`` is None when the contract package is unavailable or validation
    failed — both of which mean "no prompt block this turn", never "fail the
    turn". ``recall_error`` (from `prior_decisions.fetch_prior_decisions`) is
    recorded as an explicit `unknowns` entry so a failed lookup is observable
    in the prompt AND in the audit row, instead of being indistinguishable from
    a tenant that genuinely has no history.
    """
    if not _imports_ok():
        return None, ["contract_unavailable"]
    from materialized_evidence.context_contract import (  # noqa: PLC0415
        CONTEXT_CONTRACT_VERSION,
        AssetIdentity,
        TaskMode,
        TechnicianContext,
        asset_from_uns_context,
        evidence_from_prior_decisions,
        validate_context,
    )

    try:
        asset = asset_from_uns_context(uns_context or {})
    except Exception as exc:  # noqa: BLE001 — a malformed legacy dict must not fail the turn
        logger.debug("asset_from_uns_context skipped: %s", exc)
        asset = AssetIdentity()

    try:
        task_mode = (
            TaskMode(task_mode_value) if task_mode_value else TaskMode.GENERAL_TROUBLESHOOTING
        )
    except ValueError:
        logger.debug(
            "unknown task_mode %r — defaulting to general_troubleshooting", task_mode_value
        )
        task_mode = TaskMode.GENERAL_TROUBLESHOOTING

    evidence = evidence_from_prior_decisions(prior_decisions or [])

    unknowns: list[str] = []
    if recall_error:
        unknowns.append(recall_error)

    ctx = TechnicianContext(
        contract_version=CONTEXT_CONTRACT_VERSION,
        task_mode=task_mode,
        tenant_id=tenant_id,
        environment=environment or os.getenv("MIRA_ENV", "dev"),
        asset=asset,
        question=question or "",
        evidence=evidence,
        unknowns=unknowns,
    )

    violations = validate_context(ctx)
    if violations:
        # Fail-closed on the prompt (no block), fail-open on the turn.
        logger.warning("CONTEXT_CONTRACT_INVALID violations=%s", violations)
        return None, violations
    return ctx, []


def augment_with_retrieval(ctx: Any, chunks: list[dict[str, Any]]) -> tuple[Any | None, list[str]]:
    """Add the RETRIEVAL (MANUAL_CHUNK) family to an existing turn context (G6).

    ``ctx`` is the prior-decision context ``build_turn_context`` produced at the
    engine seam BEFORE the RAG call (retrieval chunks don't exist yet there).
    ``chunks`` are this turn's retrieved rows, available AFTER the RAG call. The
    two families are merged into ONE re-validated context so a single manifest —
    not two derivations — reaches the decision trace (PRD G6). Returns
    ``(combined_ctx | None, violations)``; None means "keep the prior-only
    manifest" (contract unavailable / bad chunk row / validation failed), never
    "fail the turn".

    This is AUDIT enrichment only: the manual chunks still reach the *prompt*
    through the RAG worker's ``[Source: label]`` reference block, and
    ``prompt_block`` still renders PRIOR_DECISION only — so no chunk is labelled
    under two trust levels. A citation-preserving retrieval *render* is the next
    slice.
    """
    if ctx is None:
        return None, ["no_base_context"]
    if not _imports_ok():
        return None, ["contract_unavailable"]
    from dataclasses import replace  # noqa: PLC0415

    from materialized_evidence.context_contract import (  # noqa: PLC0415
        evidence_from_recall_chunks,
        validate_context,
    )

    try:
        chunk_evidence = evidence_from_recall_chunks(chunks or [])
    except Exception as exc:  # noqa: BLE001 — never fail the turn on a malformed chunk row
        logger.debug("evidence_from_recall_chunks skipped: %s", exc)
        return None, ["retrieval_adapter_error"]

    if not chunk_evidence:
        # Nothing new to add — the prior-only manifest already covers this turn.
        return None, []

    combined = replace(ctx, evidence=list(ctx.evidence) + chunk_evidence)
    violations = validate_context(combined)
    if violations:
        logger.warning("RETRIEVAL_AUGMENT_INVALID violations=%s", violations)
        return None, violations
    return combined, []


def augment_with_live(ctx: Any, snapshot: Any) -> tuple[Any | None, list[str]]:
    """Add the LIVE-STATE family to an existing turn context (ADR-0033, PRD #3048).

    ``ctx`` is the turn context ``build_turn_context`` produced. ``snapshot`` is a
    ``factorylm.machine-snapshot.v1`` envelope (a dict) OR an already-built
    ``LiveStateOverlay``; either becomes ``TechnicianContext.live`` on the SAME
    context, re-validated, so ONE manifest carries it (same shape as
    ``augment_with_retrieval``; no second assembly site). Returns
    ``(combined_ctx | None, violations)``; None means "no live overlay this turn"
    (contract unavailable / invalid snapshot / validation failed), never "fail the
    turn". Read-only: a snapshot is observation data; no command is ever executed.
    """
    if ctx is None:
        return None, ["no_base_context"]
    if not _imports_ok():
        return None, ["contract_unavailable"]
    from dataclasses import replace  # noqa: PLC0415

    from materialized_evidence.context_contract import (  # noqa: PLC0415
        LiveStateOverlay,
        overlay_from_factorylm_snapshot,
        validate_context,
    )

    if isinstance(snapshot, LiveStateOverlay):
        overlay: Any = snapshot
    else:
        overlay, violations = overlay_from_factorylm_snapshot(snapshot)
        if overlay is None:
            logger.debug("LIVE_OVERLAY skipped: %s", violations)
            return None, violations

    combined = replace(ctx, live=overlay)
    violations = validate_context(combined)
    if violations:
        logger.warning("LIVE_AUGMENT_INVALID violations=%s", violations)
        return None, violations
    return combined, []


def prompt_block(ctx: Any) -> str:
    """Render the PRIOR_DECISION projection of ``ctx`` for prompt injection.

    A *projection*, not the whole context: only `PRIOR_DECISION` evidence is
    rendered, because manual chunks reach the prompt through the RAG worker's
    own reference block and rendering them twice would present one piece of
    evidence under two trust labels. The unknowns ride along — a failed recall
    must be visible to the model, not merely logged.

    Returns "" when there is nothing new to say (no priors, no unknowns), so an
    empty projection costs zero prompt bytes.
    """
    if ctx is None:
        return ""
    from dataclasses import replace  # noqa: PLC0415

    from materialized_evidence.context_contract import (  # noqa: PLC0415
        EvidenceKind,
        to_prompt_block,
    )

    priors = [e for e in ctx.evidence if e.kind == EvidenceKind.PRIOR_DECISION]
    if not priors and not ctx.unknowns:
        return ""
    try:
        projection = replace(ctx, evidence=priors, contradictions=[], live=None)
        body = to_prompt_block(projection)
    except Exception as exc:  # noqa: BLE001 — rendering must never fail a turn
        logger.warning("CONTEXT_CONTRACT_RENDER_FAILED: %s", exc)
        return ""
    return _PROMPT_PREAMBLE + body + _PROMPT_EPILOGUE
