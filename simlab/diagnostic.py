"""Evidence-packet assembler and rubric grader for SimLab scenarios.

This module is an evidence-packet assembler + rubric grader — NOT an answer engine.
It surfaces WHAT is abnormal; it does NOT name the root cause.

``assemble_evidence`` is the grounding context fed to the real Supervisor.
``grade`` checks a free-text MIRA reply against the scenario's ground truth.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from simlab.uns import tag_path

if TYPE_CHECKING:
    from simlab.engine import SimEngine
    from simlab.scenarios import Scenario

logger = logging.getLogger("simlab.diagnostic")


# ---------------------------------------------------------------------------
# EvidencePacket
# ---------------------------------------------------------------------------


@dataclass
class EvidencePacket:
    """The grounding evidence assembled from live tag state + alarms."""

    asset_id: str
    abnormal_tags: list[dict]
    """Each dict: {uns_path, value, baseline, delta, why}."""
    active_alarms: list[dict]
    candidate_docs: list[str]
    """Doc filenames relevant to the abnormal signature."""
    uns_subtree: str
    """Canonical UNS subtree path for the primary asset."""


# ---------------------------------------------------------------------------
# assemble_evidence
# ---------------------------------------------------------------------------


def assemble_evidence(engine: "SimEngine", scenario: "Scenario") -> EvidencePacket:
    """Assemble an evidence packet from LIVE tag state and active alarms.

    This is a pure function of the engine's live state — it does NOT peek at
    ``scenario.expected_evidence_tags`` or ``scenario.expected_root_cause``.
    The abnormal tag detection compares current values against the tag's default
    (the healthy baseline defined in the asset model).

    Scanning strategy
    -----------------
    1. Always scan the **primary asset** (``scenario.asset_id``) in full — every
       float/int tag and every bool tag.
    2. Scan **all other line assets** for secondary symptoms.  This surfaces
       cross-machine evidence (e.g. a low-plant-air scenario whose primary asset
       is ``airsystem01`` but whose symptoms also appear on downstream machines).
       Secondary-asset abnormals are added to ``abnormal_tags`` exactly like
       primary-asset abnormals — the grader and Supervisor see them all.

    Parameters
    ----------
    engine:
        The running ``SimEngine`` (post-advance).
    scenario:
        The loaded scenario (used only for asset_id + candidate_docs lookup).
    """
    from simlab.models import ValueType

    line = engine._line  # noqa: SLF001 — diagnostic is a first-class simlab module
    asset_id = scenario.asset_id
    asset = line.asset(asset_id)

    abnormal_tags: list[dict] = []
    snap = engine.snapshot_dict()

    def _scan_asset_tags(scan_asset: "Any") -> None:
        """Scan one asset's tags and append abnormal entries to ``abnormal_tags``."""
        seen_uns: set[str] = {e["uns_path"] for e in abnormal_tags}

        for tag_name, tag_def in scan_asset.tags.items():
            uns = tag_path(scan_asset.asset_id, tag_def.category.value, tag_name)
            if uns in seen_uns:
                continue  # already reported (primary scan always runs first)
            current = snap.get(uns)
            baseline = tag_def.default
            if current is None:
                continue

            if tag_def.value_type is ValueType.BOOL:
                if current != baseline:
                    abnormal_tags.append(
                        {
                            "uns_path": uns,
                            "value": current,
                            "baseline": baseline,
                            "delta": None,
                            "why": f"{tag_name} is {current!r} (baseline: {baseline!r})",
                        }
                    )
            else:
                delta = _compute_delta(current, baseline, tag_def)
                if delta is None:
                    continue
                why = _why_abnormal(tag_name, current, baseline, delta)
                if why:
                    abnormal_tags.append(
                        {
                            "uns_path": uns,
                            "value": current,
                            "baseline": baseline,
                            "delta": delta,
                            "why": why,
                        }
                    )

    # --- Pass 1: primary asset (always first) ---
    _scan_asset_tags(asset)

    # --- Pass 2: all other line assets (cross-machine secondary symptoms) ---
    for other_asset in line.all_assets():
        if other_asset.asset_id == asset_id:
            continue
        _scan_asset_tags(other_asset)

    # Candidate docs: deduplicate from primary asset model
    candidate_docs = list(dict.fromkeys(asset.docs))

    from simlab.uns import asset_path

    return EvidencePacket(
        asset_id=asset_id,
        abnormal_tags=abnormal_tags,
        active_alarms=engine.active_alarms(),
        candidate_docs=candidate_docs,
        uns_subtree=asset_path(asset_id),
    )


def _compute_delta(current: Any, baseline: Any, tag_def: Any) -> Any:
    """Return numeric delta for float/int tags; None for non-numeric."""
    from simlab.models import ValueType

    if tag_def.value_type in (ValueType.FLOAT, ValueType.INT):
        try:
            return round(float(current) - float(baseline), 4)
        except (TypeError, ValueError):
            return None
    return None


def _why_abnormal(tag_name: str, current: Any, baseline: Any, delta: float) -> str:
    """Return a human-readable reason if the tag is abnormal, else empty string."""
    if delta is None:
        return ""
    # Threshold: >10% deviation from baseline (or absolute >0.5 for small values)
    if baseline == 0:
        if abs(delta) > 0.5:
            return f"{tag_name} = {current} (baseline 0, delta {delta:+.3f})"
        return ""
    pct = abs(delta / baseline)
    if pct > 0.10:
        direction = "high" if delta > 0 else "low"
        return f"{tag_name} is {current} ({pct*100:.0f}% {direction} of baseline {baseline})"
    return ""


# ---------------------------------------------------------------------------
# RubricResult + grade()
# ---------------------------------------------------------------------------


@dataclass
class RubricResult:
    """Result of grading a MIRA free-text reply against a scenario rubric."""

    root_cause_hit: bool
    asset_hit: bool
    evidence_tags_hit: list[str]
    evidence_recall: float
    citations_hit: list[str]
    actions_hit: list[str]
    passed: bool
    detail: str


def grade(reply_text: str, scenario: "Scenario") -> RubricResult:
    """Grade a free-text MIRA reply against the scenario's ground truth.

    Scoring:
    - root_cause_hit: reply contains the key phrase from expected_root_cause
    - asset_hit: reply mentions the expected_asset id or display name
    - evidence_tags_hit: which expected_evidence_tags appear (by uns_path or tag name)
    - evidence_recall: len(evidence_tags_hit) / len(expected_evidence_tags)
    - citations_hit: which expected_citations are mentioned (by filename)
    - actions_hit: which expected_actions appear (keyword containment)
    - passed: root_cause_hit AND asset_hit AND evidence_recall >= 0.5

    This uses simple keyword/substring containment — good enough for CI rubric
    checks and acceptance tests.  The real quality bar is the 5-regime eval harness.
    """
    lower = reply_text.lower()

    root_cause_hit = _phrase_hit(scenario.expected_root_cause, lower)
    asset_hit = scenario.expected_asset.lower() in lower

    evidence_tags_hit = [
        uns for uns in scenario.expected_evidence_tags
        if _tag_in_reply(uns, lower)
    ]
    evidence_recall = (
        len(evidence_tags_hit) / len(scenario.expected_evidence_tags)
        if scenario.expected_evidence_tags
        else 1.0
    )

    citations_hit = [
        c for c in scenario.expected_citations
        if c.replace(".md", "").replace("_", " ").lower() in lower
        or c.lower() in lower
    ]

    actions_hit = [
        a for a in scenario.expected_actions
        if _phrase_hit(a, lower)
    ]

    passed = root_cause_hit and asset_hit and evidence_recall >= 0.5

    detail_parts = [
        f"root_cause={'✓' if root_cause_hit else '✗'}",
        f"asset={'✓' if asset_hit else '✗'}",
        f"evidence_recall={evidence_recall:.0%}",
        f"citations_hit={len(citations_hit)}/{len(scenario.expected_citations)}",
        f"actions_hit={len(actions_hit)}/{len(scenario.expected_actions)}",
    ]

    return RubricResult(
        root_cause_hit=root_cause_hit,
        asset_hit=asset_hit,
        evidence_tags_hit=evidence_tags_hit,
        evidence_recall=evidence_recall,
        citations_hit=citations_hit,
        actions_hit=actions_hit,
        passed=passed,
        detail=" | ".join(detail_parts),
    )


def _phrase_hit(phrase: str, haystack: str) -> bool:
    """True if the key words of phrase appear in haystack (order-insensitive)."""
    # Split phrase into significant tokens (≥4 chars), check all present
    tokens = [t.lower() for t in phrase.split() if len(t) >= 4]
    if not tokens:
        return False
    return all(t in haystack for t in tokens)


def _tag_in_reply(uns_path: str, lower: str) -> bool:
    """True if the uns_path or its bare tag name appears in the reply."""
    # bare tag name = last segment
    bare = uns_path.split(".")[-1]
    # Also try tag with underscores replaced by spaces
    bare_spaced = bare.replace("_", " ")
    return uns_path in lower or bare in lower or bare_spaced in lower
