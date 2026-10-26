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


def developer_export(cases: list[BenchmarkCase]) -> list[dict]:
    return [asdict(c) for c in cases if not c.holdout and c.exposed_to_developers]
