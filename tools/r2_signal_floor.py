#!/usr/bin/env python3
"""R2 signal floor — the narrow mechanical companion to the lifecycle guard.

SDLC v1 §2.3 (docs/architecture/mira-sdlc-v1.md): ``effective_risk = max(declared,
trusted_path_floor, reviewer_findings)``. Until Part B step 5 the only mechanical
floor was the lifecycle guard's R3 control-path list; the R2 signal floor for
tenant / safety / migration / retrieval paths was DOCTRINE, so an under-classified
change outside the guarded list was caught only by a reviewer. This is that floor.

It reads the PR's changed-file list and body as DATA (the lifecycle guard's shape:
``--changes-json-file`` is the ``pulls/{n}/files`` JSON-lines the workflow writes),
computes the floor class from the path signals in §2.1, parses the mandatory
``Risk: R<n> — reason`` line, and reports:

* ``PASS``  — no signal path touched, or the declared class is >= the floor;
* ``FAIL``  — a signal path is touched and the declared class is below the floor,
  or the ``Risk:`` line is missing/malformed while a floor applies.

Advisory status first (§2.3 / B.3 step 5), then required. A FAIL is never
silently downgraded; a declared class can never LOWER the floor. Lowering is an
owner decision recorded as a PR comment — outside this tool, by design. The
signal lists are narrow and explicit: a path must match a listed prefix or
exact file. Anything else is out of this floor's scope (reviewer territory),
never a guess. stdlib only — runs on a bare runner in isolated mode.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

# §2.1 signal paths. Each entry is (kind, floor_class, prefix-or-exact-path).
# A prefix ends with "/"; anything else is an exact path. Narrow by design.
_R3_SIGNALS: tuple[tuple[str, str], ...] = (
    # Safety — what is said about hazards
    ("safety", "mira-bots/shared/guardrails.py"),
    ("safety", "mira-hub/src/lib/safety-classifier.ts"),
    ("safety", "mira-hub/src/capabilities/answer-validation.ts"),
    # Migrations (listed before the broader ingest-db tenant prefix so a migration
    # file is labelled as one; both are R3 either way)
    ("migration", "mira-hub/db/migrations/"),
    ("migration", "mira-core/mira-ingest/db/migrations/"),
    # Tenant — who may see what
    ("tenant", "mira-hub/src/lib/session.ts"),
    ("tenant", "mira-hub/src/lib/tenant-context.ts"),
    ("tenant", "mira-bots/shared/neon_recall.py"),
    ("tenant", "mira-hub/src/app/api/documents/"),
    ("tenant", "mira-core/mira-ingest/db/"),
)
_R2_SIGNALS: tuple[tuple[str, str], ...] = (
    # Retrieval / answer path
    ("retrieval", "mira-bots/shared/engine.py"),
    ("retrieval", "mira-bots/shared/inference/"),
    ("retrieval", "mira-bots/shared/workers/rag_worker.py"),
    ("retrieval", "mira-hub/src/lib/manual-rag.ts"),
    ("retrieval", "mira-hub/src/lib/agents/"),
    ("retrieval", "mira-crawler/ingest/"),
    ("retrieval", "tests/golden_factorylm.csv"),
    ("retrieval", "tests/golden_hybrid.csv"),
    ("retrieval", "tests/eval/"),
)
_CLASS_RANK = {"R0": 0, "R1": 1, "R2": 2, "R3": 3}
_RISK_LINE_RE = re.compile(r"^\s*Risk:\s*(R[0-3])\b", re.MULTILINE)


@dataclass(frozen=True)
class Signal:
    path: str
    kind: str
    floor: str


@dataclass(frozen=True)
class FloorVerdict:
    status: str  # PASS | FAIL
    floor: str | None  # highest floor class among the signals, or None
    declared: str | None  # the parsed Risk: class, or None
    signals: tuple[Signal, ...]
    reason: str


def _matches(path: str, pattern: str) -> bool:
    if pattern.endswith("/"):
        return path.startswith(pattern)
    return path == pattern


def classify_paths(paths: list[str]) -> tuple[Signal, ...]:
    """Pure: the signal hits for a list of changed paths (R3 first, then R2)."""
    hits: list[Signal] = []
    for path in paths:
        for kind, pattern in _R3_SIGNALS:
            if _matches(path, pattern):
                hits.append(Signal(path, kind, "R3"))
                break
        else:
            for kind, pattern in _R2_SIGNALS:
                if _matches(path, pattern):
                    hits.append(Signal(path, kind, "R2"))
                    break
    return tuple(hits)


def parse_declared_risk(pr_body: str) -> str | None:
    """The class on the FIRST ``Risk: R<n>`` line, or None when absent/malformed."""
    m = _RISK_LINE_RE.search(pr_body or "")
    return m.group(1) if m else None


def evaluate(paths: list[str], pr_body: str) -> FloorVerdict:
    """Pure: PASS unless a signal path is touched and the declaration is below the floor."""
    signals = classify_paths(paths)
    declared = parse_declared_risk(pr_body)
    if not signals:
        return FloorVerdict("PASS", None, declared, signals, "no R2/R3 signal path changed")
    floor = max((s.floor for s in signals), key=lambda c: _CLASS_RANK[c])
    if declared is None:
        return FloorVerdict(
            "FAIL",
            floor,
            None,
            signals,
            f"signal paths changed (floor {floor}) but the PR body has no `Risk: R<n>` line",
        )
    if _CLASS_RANK[declared] < _CLASS_RANK[floor]:
        return FloorVerdict(
            "FAIL",
            floor,
            declared,
            signals,
            f"declared {declared} is below the mechanical floor {floor}; a declared class never lowers the floor (§2.3)",
        )
    return FloorVerdict("PASS", floor, declared, signals, f"declared {declared} >= floor {floor}")


def load_changed_paths(changes_json_file: Path) -> list[str]:
    """Read the lifecycle guard's changed-files JSON-lines (filename, status, previous_filename).

    Fail-closed: a line that is not an object with a string ``filename`` is an error,
    not a skip. A rename contributes both its new and previous paths.
    """
    paths: list[str] = []
    text = changes_json_file.read_text(encoding="utf-8")
    for n, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        if not isinstance(row, dict) or not isinstance(row.get("filename"), str):
            raise ValueError(f"changed-files line {n}: not an object with a string filename")
        paths.append(row["filename"])
        prev = row.get("previous_filename")
        if isinstance(prev, str) and prev:
            paths.append(prev)
    return paths


def render(verdict: FloorVerdict) -> str:
    lines = [f"R2 signal floor: {verdict.status} — {verdict.reason}"]
    for s in verdict.signals:
        lines.append(f"  {s.floor} {s.kind:<9} {s.path}")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="R2/R3 signal-path floor vs the declared Risk line"
    )
    parser.add_argument("--changes-json-file", required=True, type=Path)
    parser.add_argument("--pr-body-file", required=True, type=Path)
    parser.add_argument(
        "--summary-file", type=Path, default=None, help="append the rendered verdict here"
    )
    args = parser.parse_args(argv)
    try:
        paths = load_changed_paths(args.changes_json_file)
        body = args.pr_body_file.read_text(encoding="utf-8")
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"::error::r2 signal floor: {exc}", file=sys.stderr)
        return 2
    verdict = evaluate(paths, body)
    out = render(verdict)
    print(out, end="")
    if args.summary_file is not None:
        with args.summary_file.open("a", encoding="utf-8") as fh:
            fh.write("```\n" + out + "```\n")
    if verdict.status != "PASS":
        print(f"::error::{verdict.reason}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
