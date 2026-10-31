"""IMIB-Core promotion (spec §3): the stable, expert-reviewed anchor pool.

A case joins Core only on a decisive human expert answer (`GoldStatus.EXPERT_REVIEWED`, which
`validate_case` already refuses without a human label, so AI pre-labels can never qualify).
Variants, Live holdout cases, Safety and Red cases are never promoted, and only one anchor is
taken per lineage. Which provenance origins qualify is the owner's choice (`origins`, default
real captured wording only); "high value" beyond that is not guessed at here.

Core is append-only and versioned. The manifest records each member's gold hash, and a later
expert answer that contradicts it fails closed (`CoreRelabeled`) unless the run passes
`relabel=True`, which bumps the version and records the change: cases are never silently
relabeled. Each member's settled gold (answerability plus source/manual/page, never source
text) is stored in the manifest, so a cycle with no fresh expert answer re-attaches the
recorded expert gold instead of scoring the anchor as unlabeled; such members are reported as
`unverified_this_cycle` (no new answer arrived, the recorded gold stands). Promotion order is a hash of the case id, so the same inputs give the same Core.
Below `min_size` Core is reported not ready rather than padded with weaker cases.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import replace

from answer_radar.factory.case import (
    Answerability,
    BenchmarkCase,
    Evidence,
    GoldStatus,
    Label,
    Pool,
)
from answer_radar.schema import IndependenceClass

CORE_MIN, CORE_MAX = 150, 300
DEFAULT_ORIGINS = frozenset({"captured"})


class CoreRelabeled(Exception):
    """A Core member's gold changed, or the member vanished, without an explicit relabel."""


def gold_sha256(c: BenchmarkCase) -> str:
    gold = {
        "answerability": c.answerability.value,
        "evidence": sorted([e.doc_sha256, e.page] for e in c.gold_evidence),
    }
    return hashlib.sha256(json.dumps(gold, sort_keys=True).encode()).hexdigest()


def _gold_record(c: BenchmarkCase) -> dict:
    return {
        "answerability": c.answerability.value,
        "evidence": sorted([e.source_id, e.doc_sha256, e.page] for e in c.gold_evidence),
    }


def _restore(c: BenchmarkCase, gold: dict) -> BenchmarkCase:
    from answer_radar.factory.labeling import EXPERT_ID

    ans = Answerability(gold["answerability"])
    ev = [Evidence(src, doc, page) for src, doc, page in gold["evidence"]]
    label = Label(EXPERT_ID, IndependenceClass.HUMAN_REVIEW, ans, tuple(e.page for e in ev))
    return replace(
        c,
        answerability=ans,
        gold_status=GoldStatus.EXPERT_REVIEWED,
        gold_evidence=ev,
        labels=[*c.labels, label],
    )


def _order(case_id: str) -> str:
    return hashlib.sha256(case_id.encode()).hexdigest()


def eligible(c: BenchmarkCase, origins: frozenset[str] = DEFAULT_ORIGINS) -> bool:
    return (
        c.gold_status is GoldStatus.EXPERT_REVIEWED
        and not c.is_variant
        and not c.holdout
        and c.pool not in (Pool.SAFETY, Pool.RED, Pool.LIVE)
        and c.provenance.origin in origins
    )


def promote_core(
    cases: list[BenchmarkCase],
    prior: dict | None,
    *,
    review_data_sha256: str | None = None,
    origins: frozenset[str] = DEFAULT_ORIGINS,
    min_size: int = CORE_MIN,
    max_size: int = CORE_MAX,
    relabel: bool = False,
) -> tuple[list[BenchmarkCase], dict]:
    """Return (cases with Core members re-pooled, the new Core manifest)."""
    prior = prior or {"version": 0, "members": [], "history": []}
    by_id = {c.case_id: c for c in cases}
    members, relabeled, removed, unverified = [], [], [], []
    for m in prior["members"]:
        c = by_id.get(m["case_id"])
        if c is None or c.holdout:
            raise CoreRelabeled(f"Core member {m['case_id']} is missing from this cycle's cases")
        if c.freeze_hash != m["freeze_hash"]:
            raise CoreRelabeled(f"Core member {c.case_id}: its frozen question changed")
        if c.gold_status is GoldStatus.PROVISIONAL:
            unverified.append(c.case_id)  # no expert answer this cycle: the recorded gold stands
            by_id[c.case_id] = _restore(c, m["gold"])
            members.append(m)
            continue
        if c.gold_status is GoldStatus.EXPERT_REVIEWED and gold_sha256(c) == m["gold_sha256"]:
            members.append(m)
            continue
        if not relabel:
            raise CoreRelabeled(
                f"Core member {c.case_id}: expert gold changed ({c.gold_status.value}); "
                "rerun with an explicit relabel to version Core"
            )
        if c.gold_status is GoldStatus.EXPERT_REVIEWED:
            members.append({**m, "gold_sha256": gold_sha256(c), "gold": _gold_record(c)})
            if review_data_sha256:
                members[-1]["review_data_sha256"] = review_data_sha256
            relabeled.append(c.case_id)
        else:
            removed.append(c.case_id)  # disputed by the expert: out of Core, on the record
    lineages = {by_id[m["case_id"]].lineage_id for m in members}
    added = []
    for c in sorted((c for c in cases if eligible(c, origins)), key=lambda c: _order(c.case_id)):
        if len(members) >= max_size:
            break
        if c.lineage_id in lineages:
            continue
        lineages.add(c.lineage_id)
        members.append(
            {
                "case_id": c.case_id,
                "lineage_id": c.lineage_id,
                "freeze_hash": c.freeze_hash,
                "gold_sha256": gold_sha256(c),
                "gold": _gold_record(c),
                "review_data_sha256": review_data_sha256,
            }
        )
        added.append(c.case_id)
    history = list(prior["history"])
    version = prior["version"]
    if added or relabeled or removed:
        version += 1
        history.append(
            {"version": version, "added": added, "relabeled": relabeled, "removed": removed}
        )
    manifest = {
        "version": version,
        "ready": len(members) >= min_size,
        "min_size": min_size,
        "max_size": max_size,
        "origins": sorted(origins),
        "members": members,
        "history": history,
        "unverified_this_cycle": unverified,
    }
    core_ids = {m["case_id"] for m in members}
    # Pool membership must match the manifest: a case re-pooled as Core before routing that is no
    # longer a member (removed on an explicit relabel) goes back to Challenge, the default pool.
    out = [
        replace(by_id[c.case_id], pool=Pool.CORE)
        if c.case_id in core_ids
        else (replace(c, pool=Pool.CHALLENGE) if c.pool is Pool.CORE else c)
        for c in cases
    ]
    return out, manifest
