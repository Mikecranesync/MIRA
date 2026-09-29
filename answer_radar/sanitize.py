"""Pseudonymize staging identifiers in Answer Radar run artifacts before they are committed.

Run artifacts carry the Turn Evidence Packet, which names the staging tenant, user,
notebook, turn, trace, request and response ids. Those are not secrets, but they
identify a (throwaway) staging account and link to server logs, so they do not belong
in git history. Each id is replaced by a stable one-way pseudonym, `anon-<16 hex>`,
so rows that shared an id still share it (joins survive) and nothing is lost for
scoring: `score.answer_identity` never reads an id field.

The runners keep writing raw ids locally, because later steps (diagnostics lookup by
trace id) need them. Sanitize before `git add`; `--map` records raw → pseudonym in a
private file (default `.planning/answer-radar-id-map.json`, gitignored) so a trace can
still be found. `tests/answer_radar/test_run_artifacts_sanitized.py` fails any commit
that forgets.

Order matters: sanitize a run's batch BEFORE building its grader packet and grading
it. A rewrite that would change a graded answer's identity is refused.

Usage: python -m answer_radar.sanitize answer_radar/runs/<run-dir> [...]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

# A UUID, or a bare 32-hex id (trace ids). Content hashes are 64 hex and git SHAs 40,
# so the word boundaries keep those intact.
RAW_ID = re.compile(
    r"\b(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})\b"
)
PREFIX = "anon-"
DEFAULT_MAP = Path(".planning/answer-radar-id-map.json")


def pseudonym(raw: str) -> str:
    return PREFIX + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def scrub(obj: Any, seen: dict[str, str]) -> Any:
    """Return a copy of `obj` with every raw id in every string replaced."""
    if isinstance(obj, dict):
        return {scrub(k, seen): scrub(v, seen) for k, v in obj.items()}
    if isinstance(obj, list):
        return [scrub(v, seen) for v in obj]
    if isinstance(obj, str):

        def _swap(m: re.Match[str]) -> str:
            seen[m.group(0)] = pseudonym(m.group(0))
            return seen[m.group(0)]

        return RAW_ID.sub(_swap, obj)
    return obj


def raw_ids(obj: Any) -> list[str]:
    """Every raw id still present anywhere in `obj` (keys and values)."""
    found: list[str] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            found += raw_ids(k) + raw_ids(v)
    elif isinstance(obj, list):
        for v in obj:
            found += raw_ids(v)
    elif isinstance(obj, str):
        found += RAW_ID.findall(obj)
    return found


def load(path: Path) -> list[Any] | Any:
    text = path.read_text(encoding="utf-8")
    if path.suffix == ".jsonl":
        return [json.loads(line) for line in text.splitlines() if line.strip()]
    return json.loads(text)


def artifact_files(root: Path) -> list[Path]:
    if root.is_file():
        return [root]
    return sorted(p for p in root.rglob("*") if p.suffix in (".json", ".jsonl"))


def sanitize_paths(paths: list[Path], seen: dict[str, str]) -> list[Path]:
    """Rewrite each artifact in place; return the files that changed.

    Substitutes in the raw text rather than re-serializing, so every other byte of the
    file (key order, escaping, indentation) is untouched and the diff shows only ids.
    Ids only ever occur inside JSON strings, so a text substitution cannot break syntax.
    """
    planned: list[tuple[Path, str]] = []
    local: dict[str, str] = {}

    def _swap(m: re.Match[str]) -> str:
        local[m.group(0)] = pseudonym(m.group(0))
        return local[m.group(0)]

    for root in paths:
        for f in artifact_files(root):
            text = f.read_text(encoding="utf-8")
            if not RAW_ID.search(text):
                continue
            new = RAW_ID.sub(_swap, text)
            _refuse_if_grading_changes(f, text, new, paths)
            planned.append((f, new))
    # Check every file before writing any: a refusal leaves the run untouched.
    for f, new in planned:
        f.write_text(new, encoding="utf-8")
        load(f)  # still valid JSON / JSONL
    seen.update(local)
    return [f for f, _ in planned]


def _bound_hashes(roots: list[Path]) -> set[str]:
    """Every answer_sha256 a grade or grader-packet entry records under `roots`."""
    found: set[str] = set()
    for root in roots:
        for f in artifact_files(root):
            try:
                data = load(f)
            except (OSError, json.JSONDecodeError):
                continue
            items = data if isinstance(data, list) else [data]
            for item in items:
                if not isinstance(item, dict):
                    continue
                if isinstance(item.get("answer_sha256"), str):
                    found.add(item["answer_sha256"])
                for v in item.values():  # a grader packet: {key: entry}
                    if isinstance(v, dict) and isinstance(v.get("answer_sha256"), str):
                        found.add(v["answer_sha256"])
    return found


def _refuse_if_grading_changes(path: Path, before: str, after: str, roots: list[Path]) -> None:
    """Sanitizing must never move what a grade is, or will be, bound to (#4100).

    Grades and grader packets bind an answer by `answer_sha256`, computed from the
    batch row (plus reference notes, for packets built with them). Rather than
    re-deriving that identity here, which is how F1, F3 and F4 each escaped, the
    rule is structural:

    - a file that itself records `answer_sha256` (a grade or a packet) is never
      rewritten: its binding would silently point at different evidence (F5);
    - a batch is never rewritten while any grade or packet exists in scope
      (the paths given, plus the batch's own run directory): sanitize first,
      then build packets and grade (F1/F4).

    A fresh, ungraded batch is sanitized freely.
    """
    del after  # the decision depends only on what is already bound
    if "answer_sha256" in before:
        raise SystemExit(
            f"{path}: a grade or grader packet carries a raw id; rebuild it from a "
            "sanitized batch instead of rewriting it"
        )
    old = json.loads(before) if path.suffix == ".json" else None
    is_batch = (
        isinstance(old, list)
        and old
        and all(isinstance(r, dict) and "evaluation" in r for r in old)
    )
    if is_batch and _bound_hashes([*roots, path.parent]):
        raise SystemExit(
            f"{path}: this run already has grades or grader packets; sanitize the "
            "batch before building grader packets and grading"
        )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("paths", nargs="+", type=Path)
    ap.add_argument("--map", type=Path, default=DEFAULT_MAP, help="private raw→pseudonym map")
    args = ap.parse_args(argv)
    seen: dict[str, str] = {}
    changed = sanitize_paths(args.paths, seen)
    if seen:
        prior = json.loads(args.map.read_text(encoding="utf-8")) if args.map.exists() else {}
        prior.update(seen)
        args.map.parent.mkdir(parents=True, exist_ok=True)
        args.map.write_text(json.dumps(prior, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"{len(changed)} file(s) sanitized, {len(seen)} id(s) pseudonymized; map: {args.map}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
