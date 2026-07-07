"""CLI entry point for the drive-pack grading harness.

Wires Layers A-E together, writes ``grading_report.json`` +
``grading_report.md``, prints the trust status, and exits non-zero when the
status is ``rejected`` — the fail-closed CI gate GRADING_SPEC.md's Layer E
requires.

Usage:
    python grade.py --pack powerflex_525 --gold ../gold/powerflex_525/gold.json \\
        [--manual path/to/manual.pdf] [--out grading_out] [--packs-dir DIR]

``--manual`` omitted -> cite-integrity (Layer B) is skipped and the trust
status caps at ``internal_only``.

``--packs-dir`` defaults to ``tools/drive-pack-extract/candidates/`` — the
STAGED CANDIDATE location generators write to (NOT the live served
``mira-bots/shared/drive_packs/packs/`` tree). Grading a pack that has
already been promoted to the live tree still works via an explicit
``--packs-dir .../mira-bots/shared/drive_packs/packs``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import subprocess
import sys
from pathlib import Path
from typing import Any

from cite_check import check_citations
from domain_rules import check_domain
from gold_score import score_against_gold
from report import build_report, write_report
from schema_check import check_schema

logger = logging.getLogger("drive-pack-extract.grading.grade")

_THIS_DIR = Path(__file__).resolve().parent
_TOOL_DIR = _THIS_DIR.parent
# STAGED CANDIDATE location — NOT the live served packs/ tree. Grading runs
# against the candidate a generator just wrote; promotion to the live
# mira-bots/shared/drive_packs/packs/ tree is a separate, human-gated step.
_DEFAULT_PACKS_DIR = _TOOL_DIR / "candidates"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _extractor_commit() -> str | None:
    """Short git SHA of the current checkout — best-effort, never raises."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(_TOOL_DIR),
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        logger.warning("could not determine extractor git commit: %s", exc)
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None


def _load_pack_dict(pack_id: str, packs_dir: Path) -> dict[str, Any]:
    path = packs_dir / pack_id / "pack.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _sanitized_command(argv: list[str]) -> str:
    """Reproducible command string for the committed report: reduce any
    ABSOLUTE local path (the manual, an out dir) to its basename so a
    machine-specific temp path never lands in a committed artifact. Repo-relative
    paths (``grading/grade.py``, ``gold/<family>/gold.json``) are left readable."""
    return " ".join(Path(tok).name if Path(tok).is_absolute() else tok for tok in argv)


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Grade a drive pack against its source PDF.")
    parser.add_argument("--pack", required=True, help="pack_id, e.g. powerflex_525")
    parser.add_argument("--gold", required=True, help="path to gold/<family>/gold.json")
    parser.add_argument("--manual", default=None, help="path to the source manual PDF")
    parser.add_argument(
        "--out", default=None, help="output dir for the report (default: ./grading_out)"
    )
    parser.add_argument(
        "--packs-dir",
        default=None,
        help="override the packs/ directory to load pack_id/pack.json from "
        "(default: the STAGED CANDIDATE dir tools/drive-pack-extract/candidates/ "
        "— NOT the live served mira-bots/shared/drive_packs/packs/)",
    )
    parser.add_argument(
        "--residual",
        action="append",
        default=[],
        help="declare a known residual limitation (repeatable)",
    )
    parser.add_argument(
        "--generated-at", default="unknown", help="timestamp string to embed in the report"
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    args = _parse_args(argv)

    packs_dir = Path(args.packs_dir) if args.packs_dir else _DEFAULT_PACKS_DIR
    out_dir = Path(args.out) if args.out else Path.cwd() / "grading_out"

    gold_path = Path(args.gold)
    gold_dict = json.loads(gold_path.read_text(encoding="utf-8"))

    pack_dict = _load_pack_dict(args.pack, packs_dir)

    manual_path = Path(args.manual) if args.manual else None
    manual_sha256 = _sha256(manual_path) if manual_path and manual_path.is_file() else None

    schema_result = check_schema(args.pack, packs_dir=str(packs_dir))
    cite_result = check_citations(pack_dict, manual_path, gold=gold_dict)
    gold_result = score_against_gold(pack_dict, gold_dict)
    domain_result = check_domain(pack_dict)

    report = build_report(
        pack_id=args.pack,
        pack_dict=pack_dict,
        schema_result=schema_result,
        cite_result=cite_result,
        gold_result=gold_result,
        domain_result=domain_result,
        manual_path=manual_path,
        manual_sha256=manual_sha256,
        extractor_commit=_extractor_commit(),
        extraction_command=_sanitized_command(sys.argv),
        residuals=args.residual,
        generated_at=args.generated_at,
    )

    json_path, md_path = write_report(report, out_dir)

    print(f"trust status: {report['trust_status']}")
    for reason in report["trust_status_reasons"]:
        print(f"  - {reason}")
    print(f"report written: {json_path}")
    print(f"report written: {md_path}")

    return 1 if report["trust_status"] == "rejected" else 0


if __name__ == "__main__":
    raise SystemExit(main())
