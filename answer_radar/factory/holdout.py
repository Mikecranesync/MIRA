"""The hidden Live holdout (spec §3 IMIB-Live, §10).

The repository is public and every agent reads it, so Live case text is sealed OUTSIDE any
git work tree; only a manifest of salted opaque ids may be committed. `developer_export` is the only
view implementation agents get, and it omits every holdout case.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
from dataclasses import asdict
from pathlib import Path

from answer_radar.factory.case import BenchmarkCase


class HoldoutLeak(RuntimeError):
    pass


def _inside_git(path: Path) -> bool:
    return any((p / ".git").exists() for p in [path, *path.parents])


def seal_live(cases: list[BenchmarkCase], private_dir: Path) -> list[dict]:
    """Write holdout cases to `private_dir` (must be outside git); return the committable manifest.

    The manifest holds only salted opaque ids. The mapping back to source ids, URLs and hashes
    lives in `private_dir/holdout-index.json`, beside the sealed cases and the salt.
    """
    private_dir = private_dir.resolve()
    if _inside_git(private_dir):
        raise HoldoutLeak(
            f"{private_dir} is inside a git work tree; holdout text would be publishable"
        )
    private_dir.mkdir(parents=True, exist_ok=True)
    salt_path = private_dir / "holdout-salt"
    if not salt_path.is_file():
        salt_path.write_text(secrets.token_hex(32), encoding="utf-8")
    salt = salt_path.read_text(encoding="utf-8").strip()
    manifest, index = [], []
    for c in sorted((c for c in cases if c.holdout), key=lambda c: c.case_id):
        if c.exposed_to_developers:
            raise HoldoutLeak(f"{c.case_id} is marked exposed; it cannot be a holdout")
        # Opaque, salted id: a public manifest must not reveal the source post (case_id embeds
        # source:external_id) or a hash of its public text that could be matched by guessing.
        hid = hmac.new(salt.encode(), c.case_id.encode(), hashlib.sha256).hexdigest()[:24]
        path = private_dir / f"{hid}.json"
        blob = json.dumps(asdict(c), default=str, sort_keys=True)
        if path.is_file():
            old = json.loads(path.read_text(encoding="utf-8"))
            if old["case_id"] != c.case_id:
                raise HoldoutLeak(f"{path} already holds a different case")
            if (old["freeze_hash"], old["provenance"]["text_sha256"]) != (
                c.freeze_hash,
                c.provenance.text_sha256,
            ):
                # Same id, different frozen task: results recorded against the old task would
                # silently re-point. Labels may change (expert import); the task may not.
                raise HoldoutLeak(
                    f"{c.case_id}: frozen task changed; give the edited question a new case_id"
                )
        path.write_text(blob, encoding="utf-8")
        manifest.append({"holdout_id": hid})
        index.append(
            {
                "holdout_id": hid,
                "case_id": c.case_id,
                "freeze_hash": c.freeze_hash,
                "text_sha256": c.provenance.text_sha256,
                "url": c.provenance.url,
            }
        )
    (private_dir / "holdout-index.json").write_text(
        json.dumps(index, indent=2) + "\n", encoding="utf-8"
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


def product_key(lineage_key: str) -> str:
    """Spelling-insensitive split key: "powerflex-525" and "powerflex525" are one product.

    Applied to both live keys and exposure-ledger keys, so a reworded model name can never
    reach Live when the same product was already shown to developers (the evidence resolver
    already matches models space-insensitively).
    """
    return "/".join(re.sub(r"[^a-z0-9]", "", part) for part in lineage_key.lower().split("/"))


def group_key(c: BenchmarkCase) -> str:
    """The unit that moves into Live as a whole.

    A question naming a manufacturer or model groups with every question about that product
    (split-key law). A question naming neither has no product to leak through, so it is its
    own group: otherwise every unidentified question (561 of 587 in the first real Stack
    Exchange capture) would collapse into one all-or-nothing "unknown/unknown" block.
    """
    if c.question.manufacturer or c.question.model:
        return product_key(c.question.lineage_key)
    return product_key(f"lineage/{c.lineage_id}")


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
    key = group_key

    def ineligible(c: BenchmarkCase) -> bool:
        return (
            c.pool not in (Pool.CHALLENGE, Pool.CORE)
            or c.question.split_assignment is not SplitAssignment.FRESH
            or c.exposed_to_developers  # exposure is history: it is never cleared
        )

    # Exposure follows the QUESTION as well as the product: the same text reposted on another
    # source (a different split key) is still a question developers have seen.
    seen_fps = {c.question.dedupe_hash for c in cases if ineligible(c)}
    seen_fps |= {k[3:] for k in exposed_keys if k.startswith("fp:")}
    blocked = {key(c) for c in cases if ineligible(c) or c.question.dedupe_hash in seen_fps}
    blocked |= {product_key(k) for k in exposed_keys if not k.startswith("fp:")}
    out = [
        replace(c, pool=Pool.LIVE, holdout=True, exposed_to_developers=False)
        if key(c) not in blocked and picked(key(c))
        else c
        for c in cases
    ]
    # Fresh duplicates may still straddle Live and visible pools via different split keys;
    # pull every group holding a straddling question back out of Live until none remain.
    # A case that arrived already Live and duplicates a visible question cannot be fixed by
    # demotion (exposure is irreversible): that is contamination, reported loudly. Every other
    # pass demotes at least one newly-moved group, so the loop always terminates.
    while True:
        visible = {c.question.dedupe_hash for c in out if c.pool is not Pool.LIVE}
        clash = {key(c) for c in out if c.pool is Pool.LIVE and c.question.dedupe_hash in visible}
        if not clash:
            return out
        stuck = [
            o
            for o in cases
            if o.pool is Pool.LIVE and key(o) in clash and o.question.dedupe_hash in visible
        ]
        if stuck:
            raise HoldoutLeak(
                f"{stuck[0].case_id} is already Live but duplicates a developer-visible question"
            )
        out = [orig if key(c) in clash else c for orig, c in zip(cases, out)]
