"""The hidden Live holdout (spec §3 IMIB-Live, §10).

The repository is public and every agent reads it, so Live case text is sealed OUTSIDE any
git work tree; only a manifest of hashes may be committed. `developer_export` is the only
view implementation agents get, and it omits every holdout case.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from answer_radar.factory.case import BenchmarkCase


class HoldoutLeak(RuntimeError):
    pass


def _inside_git(path: Path) -> bool:
    return any((p / ".git").exists() for p in [path, *path.parents])


def seal_live(cases: list[BenchmarkCase], private_dir: Path) -> list[dict]:
    """Write holdout cases to `private_dir` (must be outside git); return the committable manifest."""
    private_dir = private_dir.resolve()
    if _inside_git(private_dir):
        raise HoldoutLeak(
            f"{private_dir} is inside a git work tree; holdout text would be publishable"
        )
    private_dir.mkdir(parents=True, exist_ok=True)
    manifest = []
    for c in sorted((c for c in cases if c.holdout), key=lambda c: c.case_id):
        if c.exposed_to_developers:
            raise HoldoutLeak(f"{c.case_id} is marked exposed; it cannot be a holdout")
        blob = json.dumps(asdict(c), default=str, sort_keys=True)
        (private_dir / f"{c.case_id.replace(':', '_').replace('/', '_')}.json").write_text(
            blob, encoding="utf-8"
        )
        manifest.append(
            {
                "case_id": c.case_id,
                "freeze_hash": c.freeze_hash,
                "text_sha256": c.provenance.text_sha256,
            }
        )
    return manifest


def developer_export(cases: list[BenchmarkCase], registry=None) -> list[dict]:
    """Developer view: no holdout cases, and no source text the registry forbids committing.

    Without a registry every question text is redacted (fail closed). Redacted cases keep their
    hashes, entities and evidence, which is what a developer needs to reproduce a score.
    """
    out = []
    for c in cases:
        if c.holdout:
            continue
        d = asdict(c)
        if registry is None or not registry.may_commit_text(c.provenance.source_id):
            d["question"]["normalized_question"] = f"[redacted: {c.provenance.text_sha256[:16]}]"
            d["question"]["raw_text"] = None
        out.append(d)
    return out


def assign_live(
    cases: list[BenchmarkCase],
    *,
    fraction: float,
    seed: str,
    exposed_keys: frozenset[str] = frozenset(),
) -> list[BenchmarkCase]:
    """Move a deterministic fraction of fresh, never-exposed source lineages into the Live pool.

    Whole split-key groups (`QuestionRecord.lineage_key`) move together, so neither a question's
    variants nor its same-product siblings are split across Live and a developer-visible pool. A
    group containing any Red, Safety or already-exposed case never moves, nor does any key in
    `exposed_keys` (the cycle's exposure ledger: everything earlier cycles exported).
    """
    import hashlib
    from dataclasses import replace

    from answer_radar.factory.case import Pool
    from answer_radar.schema import SplitAssignment

    def picked(lineage: str) -> bool:
        return (
            int(hashlib.sha256(f"{seed}:{lineage}".encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
            < fraction
        )

    # Group by the split key (manufacturer/model/platform), not the question: a held-out GS10
    # question is not cold if other GS10 questions from the same source are developer-visible.
    blocked = {
        c.question.lineage_key
        for c in cases
        if c.pool not in (Pool.CHALLENGE, Pool.CORE)
        or c.question.split_assignment is not SplitAssignment.FRESH
        or c.exposed_to_developers  # exposure is history: it is never cleared
    } | set(exposed_keys)
    return [
        replace(c, pool=Pool.LIVE, holdout=True, exposed_to_developers=False)
        if c.question.lineage_key not in blocked and picked(c.question.lineage_key)
        else c
        for c in cases
    ]
