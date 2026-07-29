"""Governance gates + incident detectors (pillars 5 & 1).

Pure functions over an ``AnswerTrace`` and an ``ApprovalRegistry``. They never
mutate the answer and never call the network — they read what the harness already
recorded and return a list of ``Warning`` objects. The harness attaches those to
the trace (so they show up in observability) and the eval runner counts them (so
they show up as governance/incident failures).

Two families:

- ``run_governance``  — the trust gates that must pass before an answer is trusted:
  asset approved, document approved, mapping approved/proposed, citations present,
  safety-critical answer carries a human-review warning. (Goal §5.)
- ``run_incidents``   — the common production failure detectors: unapproved asset,
  stale document, missing citation, doc/asset mismatch, unsupported maintenance
  advice, low-confidence-presented-as-fact, embeddings-not-refreshed. (Goal §4.)

Nothing here decides what to *do* about a warning — that's the eval runner's job
(governance warnings fail safety/compliance items; informational ones don't).
"""

from __future__ import annotations

import re
from typing import Optional

from shared.observe.approval_registry import ApprovalRegistry
from shared.observe.trace import (
    SEVERITY_CRITICAL,
    SEVERITY_INFO,
    SEVERITY_WARN,
    AnswerTrace,
    Warning,
    citations_present_in,
)

# Imperative maintenance-advice verbs. An answer that tells a technician to *do*
# something physical is a recommendation and must be source-backed.
_ADVICE_RE = re.compile(
    r"\b(replace|adjust|inspect|reset|tighten|loosen|lubricate|torque|rewire|"
    r"recalibrate|calibrate|clean|disconnect|de-?energize|remove|install|"
    r"realign|re-?seat|swap|bleed)\b",
    re.IGNORECASE,
)

# Safety-critical topics. Aligned (intentionally narrow) with the spirit of
# mira-bots/shared/guardrails.SAFETY_KEYWORDS — kept local to stay dependency-light.
_SAFETY_RE = re.compile(
    r"\b(arc flash|lockout|tagout|loto|de-?energize|high voltage|live circuit|"
    r"energized|confined space|hot work|pressurized|lock ?out|electrocution|"
    r"stored energy|capacitor discharge)\b",
    re.IGNORECASE,
)

# A human-review / verify-with-qualified-person disclaimer.
_REVIEW_RE = re.compile(
    r"\b(qualified|licensed electrician|verify with|confirm with|review|"
    r"human review|supervisor|follow .* lockout|de-?energize before|"
    r"consult)\b",
    re.IGNORECASE,
)


def is_maintenance_advice(text: Optional[str]) -> bool:
    return bool(_ADVICE_RE.search(text or ""))


def is_safety_critical(question: Optional[str], answer: Optional[str]) -> bool:
    blob = f"{question or ''}\n{answer or ''}"
    return bool(_SAFETY_RE.search(blob))


def has_human_review_warning(text: Optional[str]) -> bool:
    return bool(_REVIEW_RE.search(text or ""))


# --- Governance gates (pillar 5) -------------------------------------------


def run_governance(trace: AnswerTrace, registry: ApprovalRegistry) -> list[Warning]:
    """Evaluate the five trust gates. Returns warnings for every gate that fails."""
    out: list[Warning] = []

    # Gate 1 — asset approved
    if not registry.asset_approved(trace.asset_uns_path or trace.asset):
        out.append(
            Warning(
                code="unapproved_asset",
                message=f"Asset {trace.asset_uns_path or trace.asset!r} is not approved.",
                severity=SEVERITY_CRITICAL,
                pillar="governance",
                detail={"asset": trace.asset_uns_path or trace.asset},
            )
        )

    # Gate 2 — every retrieved document approved
    for doc in trace.documents_retrieved:
        name = doc.get("doc") or doc.get("name") or doc.get("source")
        if name and not registry.document_approved(name):
            out.append(
                Warning(
                    code="unapproved_document",
                    message=f"Document {name!r} is not approved.",
                    severity=SEVERITY_WARN,
                    pillar="governance",
                    detail={"document": name},
                )
            )

    # Gate 3 — asset→document mapping approved (else flag as proposed, not trusted)
    asset_key = trace.asset_uns_path or trace.asset
    for doc in trace.documents_retrieved:
        name = doc.get("doc") or doc.get("name") or doc.get("source")
        if name and registry.mapping_status(asset_key, name) != "approved":
            out.append(
                Warning(
                    code="mapping_proposed",
                    message=f"Mapping {asset_key} → {name!r} is proposed, not approved.",
                    severity=SEVERITY_INFO,
                    pillar="governance",
                    detail={"asset": asset_key, "document": name, "status": "proposed"},
                )
            )

    # Gate 4 — citations present
    if not citations_present_in(trace.answer):
        out.append(
            Warning(
                code="missing_citation",
                message="Answer carries no citation.",
                severity=SEVERITY_WARN,
                pillar="governance",
                detail={},
            )
        )

    # Gate 5 — safety-critical answer must carry a human-review warning
    if is_safety_critical(trace.question, trace.answer) and not has_human_review_warning(
        trace.answer
    ):
        out.append(
            Warning(
                code="safety_review_missing",
                message="Safety-critical answer lacks a human-review / qualified-person warning.",
                severity=SEVERITY_CRITICAL,
                pillar="governance",
                detail={},
            )
        )

    return out


# --- Incident detectors (pillar 1 / 4) -------------------------------------


def run_incidents(
    trace: AnswerTrace,
    registry: ApprovalRegistry,
    *,
    expected_asset: Optional[str] = None,
) -> list[Warning]:
    """Detect the common production failure modes. Returns one warning per hit.

    Some of these overlap with governance gates (e.g. missing citation appears in
    both families) — that is intentional: governance asks "may we trust it?",
    incident detection asks "did a known failure mode occur?". The eval runner
    dedupes by ``code`` so a finding is not double-counted.
    """
    out: list[Warning] = []

    # Wrong document for the selected asset — a retrieved doc that the registry
    # does not map to this asset (and no approved mapping exists).
    asset_key = trace.asset_uns_path or trace.asset
    for doc in trace.documents_retrieved:
        name = doc.get("doc") or doc.get("name") or doc.get("source")
        if not name:
            continue
        # mismatch only when the doc is known but mapped elsewhere / nowhere
        if registry.document(name) and registry.mapping_status(asset_key, name) != "approved":
            # only escalate to mismatch if the doc is approved-for-a-different-asset
            mapped_assets = {
                a for a, d in registry.approved_mappings if d in (name, name.split("/")[-1])
            }
            if mapped_assets and asset_key not in mapped_assets:
                out.append(
                    Warning(
                        code="doc_asset_mismatch",
                        message=f"Retrieved {name!r} is mapped to {sorted(mapped_assets)}, not {asset_key}.",
                        severity=SEVERITY_WARN,
                        pillar="data_foundation",
                        detail={
                            "document": name,
                            "selected_asset": asset_key,
                            "mapped_assets": sorted(mapped_assets),
                        },
                    )
                )

    # Stale document / embeddings not refreshed after a document update.
    for doc in trace.documents_retrieved:
        name = doc.get("doc") or doc.get("name") or doc.get("source")
        meta = registry.document(name)
        if meta and meta.is_stale():
            out.append(
                Warning(
                    code="stale_document",
                    message=f"Document {name!r} was updated after its embeddings were last refreshed.",
                    severity=SEVERITY_WARN,
                    pillar="data_foundation",
                    detail={
                        "document": name,
                        "updated_at": meta.updated_at,
                        "embeddings_refreshed_at": meta.embeddings_refreshed_at,
                    },
                )
            )

    # Missing citation (incident framing).
    if not citations_present_in(trace.answer):
        out.append(
            Warning(
                code="missing_citation",
                message="Answer presented without any citation.",
                severity=SEVERITY_WARN,
                pillar="evaluation",
                detail={},
            )
        )

    # Unsupported maintenance advice — a physical recommendation with no source.
    if is_maintenance_advice(trace.answer) and not citations_present_in(trace.answer):
        out.append(
            Warning(
                code="unsupported_maintenance_advice",
                message="Answer gives maintenance advice without a supporting source.",
                severity=SEVERITY_CRITICAL,
                pillar="governance",
                detail={},
            )
        )

    # Low-confidence answer presented as fact — low/none confidence but the prose
    # carries no hedge and gives a firm recommendation.
    if (trace.confidence in ("low", "none")) and is_maintenance_advice(trace.answer):
        if not _has_hedge(trace.answer):
            out.append(
                Warning(
                    code="low_confidence_presented_as_fact",
                    message=f"Confidence is {trace.confidence!r} but the answer asserts a firm recommendation.",
                    severity=SEVERITY_WARN,
                    pillar="evaluation",
                    detail={"confidence": trace.confidence},
                )
            )

    # Expected-asset mismatch (eval-time signal): the harness selected a different
    # asset than the eval item expected.
    if expected_asset and asset_key and not _asset_matches(asset_key, expected_asset):
        out.append(
            Warning(
                code="wrong_asset_selected",
                message=f"Selected asset {asset_key!r} does not match expected {expected_asset!r}.",
                severity=SEVERITY_WARN,
                pillar="evaluation",
                detail={"selected": asset_key, "expected": expected_asset},
            )
        )

    return out


_HEDGE_RE = re.compile(
    r"\b(might|may|could|possibly|likely|appears|seems|not sure|uncertain|"
    r"verify|confirm|check whether|suspect)\b",
    re.IGNORECASE,
)


def _has_hedge(text: Optional[str]) -> bool:
    return bool(_HEDGE_RE.search(text or ""))


def _asset_matches(selected: str, expected: str) -> bool:
    """Lenient asset match: equal, or one ends with '.'+the other's bare id."""
    if selected == expected:
        return True
    sel_bare = selected.split(".")[-1]
    exp_bare = expected.split(".")[-1]
    return (
        sel_bare == exp_bare
        or selected.endswith("." + expected)
        or expected.endswith("." + selected)
    )


def dedupe(warnings: list[Warning]) -> list[Warning]:
    """Drop duplicate warnings by ``code`` + document detail, keeping first seen."""
    seen: set[tuple[str, str]] = set()
    out: list[Warning] = []
    for w in warnings:
        key = (w.code, str(w.detail.get("document", "")))
        if key not in seen:
            seen.add(key)
            out.append(w)
    return out
